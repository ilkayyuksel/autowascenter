# Backup & Restore

How the backups of the self-hosted stack are made, inspected and restored. The stack and the
variable names are described in `deploy/README.md`.

**A backup is only proven once a restore has been tested.** Do the rehearsal in step 4
(restore into a temporary database) before relying on these backups, and repeat it after
every schema change.

Run the commands from `deploy/`, where `.env` is, and **load the environment first**. The
commands below use `$POSTGRES_USER`, `$POSTGRES_DB` and `$POSTGRES_PASSWORD`; Compose reads
`deploy/.env` for its own interpolation but does **not** put those values in your shell:

```sh
cd /opt/autowascenter/deploy
set -a; . ./.env; set +a
echo "$POSTGRES_USER / $POSTGRES_DB"     # check: both filled in
```

(Without this, every `psql`/`createdb` call below fails with an empty user name.)

## What is backed up

| Data                          | By                                | Where                            |
| ----------------------------- | --------------------------------- | -------------------------------- |
| Database (schema + all rows)  | `backup` service, daily `pg_dump` | `backup_data` volume, `*.sql.gz` |
| Gallery images (`UPLOAD_DIR`) | **manually** (see below)          | wherever the tar file is written |
| Certificates (`caddy_data`)   | not backed up                     | Caddy requests new ones          |
| `deploy/.env`                 | **manually**, outside the server  | password manager / secret store  |

The database dump does not contain the images. Restoring only the database leaves gallery
rows pointing at files that are gone, so back up both at the same moment:

```sh
docker run --rm -v autowascenter_uploads_data:/data:ro -v "$PWD":/out alpine:3.21 \
  tar czf /out/uploads-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C /data .
```

(The volume is called `<compose project>_uploads_data`; the project name is
`autowascenter`, set in `docker-compose.yml`. `docker volume ls` shows the exact names.)

## 1. Make a backup

The scheduled job runs by itself. To force one now, outside the schedule:

```sh
docker compose exec -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
  | gzip -9 > before-restore-test-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
```

Check that the scheduled job is working:

```sh
docker compose logs --tail 20 backup
docker compose exec backup ls -lh /backups
```

## 2. Copy a backup off the volume

```sh
# newest dump in the volume
docker compose exec backup sh -c 'ls -1t /backups/*.sql.gz | head -1'
docker compose cp backup:/backups/<file>.sql.gz ./<file>.sql.gz
```

Keep a copy **off this server** (another machine or offline storage): a server failure must
not take the backups with it.

## 3. Inspect a backup

Never restore a dump you have not looked at:

```sh
gzip -t <file>.sql.gz && echo "archive intact"
zcat <file>.sql.gz | head -40                      # header, PostgreSQL version
zcat <file>.sql.gz | grep -c "^COPY "              # number of data blocks
zcat <file>.sql.gz | grep -E "^(CREATE TABLE|COPY) (public\.)?(bookings|services)" | head
zcat <file>.sql.gz | wc -l
```

A complete dump ends with the marker `-- PostgreSQL database dump complete`. Grep for it
instead of looking at the last lines: PostgreSQL 18 writes an extra `\unrestrict …` line
after the marker, so `tail -3` misses it.

```sh
zcat <file>.sql.gz | grep -c "PostgreSQL database dump complete"   # expect 1
zcat <file>.sql.gz | tail -6                                       # marker + \unrestrict
```

## 4. Restore into a temporary database (the rehearsal)

This proves the backup without touching production. It creates an extra database on the
same server and removes it afterwards.

```sh
# 1. a scratch database
docker compose exec postgres \
  createdb -U "$POSTGRES_USER" restore_test

# 2. the dump into it (the extension and schema come from the dump)
zcat <file>.sql.gz | docker compose exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d restore_test >/dev/null

# 3. does the data look right?
docker compose exec postgres psql -U "$POSTGRES_USER" -d restore_test -c \
  "SELECT (SELECT count(*) FROM bookings) AS bookings,
          (SELECT count(*) FROM services) AS services,
          (SELECT count(*) FROM gallery_items) AS gallery,
          (SELECT max(created_at) FROM bookings) AS newest_booking"

# 4. is the schema complete? (exclusion constraint, triggers, extension)
docker compose exec postgres psql -U "$POSTGRES_USER" -d restore_test -c \
  "SELECT conname FROM pg_constraint WHERE conname = 'bookings_no_overlap_excl'"
docker compose exec postgres psql -U "$POSTGRES_USER" -d restore_test -c \
  "SELECT count(*) AS triggers FROM information_schema.triggers WHERE trigger_schema='public'"
docker compose exec postgres psql -U "$POSTGRES_USER" -d restore_test -c \
  "SELECT extname FROM pg_extension WHERE extname = 'btree_gist'"

# 5. clean up
docker compose exec postgres dropdb -U "$POSTGRES_USER" restore_test
```

Expected: the row counts match what the site showed, the constraint exists, 8 triggers, and
`btree_gist` is present. `ON_ERROR_STOP=1` makes `psql` stop at the first error, so a broken
dump fails loudly instead of restoring halfway.

## 5. Restore over the production database

Only after step 4 succeeded. **This overwrites the current data.** Plan a short outage.

```sh
# 1. Fresh backup of the CURRENT state first (see step 1), even if it is broken.

# 2. Stop everything that writes; keep the database running.
docker compose stop web api caddy backup

# 3. Restore into a new database and swap, instead of dropping the live one:
docker compose exec postgres createdb -U "$POSTGRES_USER" restore_new
zcat <file>.sql.gz | docker compose exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d restore_new >/dev/null

# 4. Check it (the queries from step 4), then swap the names:
docker compose exec postgres psql -U "$POSTGRES_USER" -d postgres -c \
  "ALTER DATABASE \"$POSTGRES_DB\" RENAME TO ${POSTGRES_DB}_old"
docker compose exec postgres psql -U "$POSTGRES_USER" -d postgres -c \
  "ALTER DATABASE restore_new RENAME TO \"$POSTGRES_DB\""

# 5. Restore the uploads from the same moment, if needed:
docker run --rm -v autowascenter_uploads_data:/data -v "$PWD":/in alpine:3.21 \
  sh -c 'rm -rf /data/* && tar xzf /in/uploads-<timestamp>.tar.gz -C /data'

# 6. Start again and verify.
docker compose up -d
docker compose ps
curl -sf https://<DOMAIN>/api/services >/dev/null && echo "API ok"
```

Renaming instead of dropping keeps the old database (`<db>_old`) available as a fallback
until the restore is confirmed. Remove it afterwards with
`docker compose exec postgres dropdb -U "$POSTGRES_USER" <db>_old`.

A rename fails while connections are open. The API is stopped in step 2; if needed:

```sh
docker compose exec postgres psql -U "$POSTGRES_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
   WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid()"
```

## 6. Migrations after a restore

A dump contains the schema as it was **at that moment**, including the
`drizzle.__drizzle_migrations` table. After restoring an older dump onto a newer release,
run the migrations again:

```sh
docker compose run --rm api node src/scripts/migrate.ts
```

Already applied migrations are skipped; only the missing ones run.

## Limits

- **No point-in-time recovery.** These are daily dumps, so at most 24 hours of changes can
  be lost. WAL archiving is a separate decision.
- **No external copy.** Dumps stay on the server volume; copying them off is a manual step
  (see step 2). Uploading to cloud storage is deliberately not part of this phase.
- **Database migrations are not reversible.** See `docs/PRODUCTION-DEPLOYMENT.md`
  (_Rollback_): a code rollback is simple, a schema rollback usually means restoring a
  backup.

## Status of the rehearsal

The rehearsal (step 4) was executed on 2026-10-03 on a local Docker host and **passed**: a
dump from the running backup job was copied out, inspected, restored into a temporary
database, and the row counts matched the live database exactly (1 booking with 2 service
lines, 4 services, 2 vehicle types, 8 pricing rows, settings, blocked period, gallery item).
The restored database had the complete schema — 10 tables, 25 indexes, 8 triggers,
`btree_gist` — and its exclusion constraint actively rejected an overlapping booking.

Repeat it on the production server before the site goes live, and periodically afterwards:
a backup is only proven on the machine that has to be restored.
