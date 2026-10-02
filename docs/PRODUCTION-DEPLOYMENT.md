# Production Deployment

Deploying the Docker stack from `deploy/` on a Linux server, in order. The stack itself is
described in `deploy/README.md`; the architecture in `docs/SELF-HOSTED-ARCHITECTURE.md`.

> **DNS and the live domain are the next phase.** The steps below work with the real domain
> once it points at the server, and can be rehearsed beforehand with `DOMAIN=localhost`
> (step 5). Nothing here changes DNS, the firewall or the Auth0 tenant automatically.
>
> **Not yet executed.** The phase-8 machine had no running Docker engine, so steps 6–16 have
> not been run. They are the acceptance test of the deployment.

## 1. Server requirements

| Item    | Minimum                                                                   |
| ------- | ------------------------------------------------------------------------- |
| OS      | Linux with a current kernel (Debian 12 / Ubuntu 24.04 LTS or newer)       |
| CPU/RAM | 2 vCPU, 2 GB RAM (web + API + PostgreSQL are modest; builds need the RAM) |
| Disk    | 20 GB (images, database, uploads, 14 days of dumps)                       |
| Network | Public IPv4 (and IPv6 if available), **ports 80 and 443 open inbound**    |
| Access  | SSH with a non-root user that can use Docker                              |
| Time    | NTP synchronised (certificates and booking times depend on it)            |

Port 80 must stay open: Caddy uses it for the ACME HTTP-01 challenge and the HTTP→HTTPS
redirect. No other port needs to be reachable; PostgreSQL has no published port at all.

## 2. Install Docker

Docker Engine with the Compose plugin (not the old `docker-compose` binary):

```sh
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # log out and back in
docker version
docker compose version            # v2.x
```

## 3. Clone the repository

```sh
sudo mkdir -p /srv && sudo chown "$USER" /srv
cd /srv
git clone <repository-url> autowascenter
cd autowascenter
git checkout migration/self-hosted
```

## 4. Create the environment file

```sh
cd deploy
cp .env.example .env
chmod 600 .env
openssl rand -base64 32          # use as POSTGRES_PASSWORD
$EDITOR .env
```

Fill in at least:

- `DOMAIN`
- `POSTGRES_PASSWORD` (long and random; it only lives in this file)
- `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` and the matching `VITE_AUTH0_DOMAIN`,
  `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE` (from `docs/AUTH0-SETUP.md`)

Leave `VITE_API_BASE_URL` **empty**: the browser then calls `/api/...` on the site's own
origin, which Caddy forwards to the API. `CORS_ORIGIN`, `PUBLIC_UPLOAD_URL` and
`DATABASE_URL` may stay empty; they are derived from `DOMAIN` and the `POSTGRES_*` values.

`deploy/.env` is in `.gitignore` and in `.dockerignore`: it is never committed and never
ends up in an image.

## 5. Configure the domain

- Point the DNS A/AAAA record of `DOMAIN` (and `www`, if used) at the server. **This is the
  next phase**; without it, Caddy cannot obtain a certificate.
- Add the production URLs in the Auth0 Dashboard (`docs/AUTH0-SETUP.md`, section 3):
  callback `https://<DOMAIN>/admin-login`, logout and web origin `https://<DOMAIN>`.
- A local rehearsal without DNS: set `DOMAIN=localhost` in `.env`. Caddy then issues a
  certificate from its own internal CA, and the checks below work with `curl -k`.

## 6. Pull the external images

```sh
cd /srv/autowascenter/deploy
docker compose pull postgres caddy
```

(Only these two come from a registry; `web`, `api` and `backup` are built locally, so a
plain `docker compose pull` would try to fetch images that do not exist.)

## 7. Build the images

```sh
docker compose build
docker image ls | grep autowascenter
```

The `VITE_*` values from `.env` are compiled into the browser bundle here. After changing
one, run `docker compose build web` again.

Check that no secret ended up in the web image:

```sh
docker run --rm --entrypoint sh autowascenter-web:local -c \
  'grep -rl "POSTGRES_PASSWORD\|DATABASE_URL" / 2>/dev/null | head'   # expect: nothing
docker run --rm --entrypoint sh autowascenter-web:local -c 'ls -a /app'  # only .output
docker run --rm --entrypoint sh autowascenter-api:local -c \
  'ls -a /repo/apps/api; test -e /repo/apps/api/.env && echo "UNEXPECTED .env" || echo "no .env"'
```

## 8. Start PostgreSQL

```sh
docker compose up -d postgres
docker compose ps                      # wait for "healthy"
docker compose logs --tail 20 postgres
```

The first start initialises an empty database in the `postgres_data` volume. The healthcheck
uses `pg_isready` with the configured user and database.

## 9. Run the migrations

Explicitly, never automatically:

```sh
docker compose run --rm api node src/scripts/migrate.ts
```

Expected: `Applying migrations from /repo/apps/api/drizzle` followed by `Migrations up to
date.` Verify the schema:

```sh
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT conname FROM pg_constraint WHERE conname = 'bookings_no_overlap_excl'"
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT extname FROM pg_extension WHERE extname = 'btree_gist'"
```

Expected: 10 tables, the exclusion constraint and the `btree_gist` extension.

**Optional but recommended once:** run the real-PostgreSQL integration tests against a
_disposable_ database (never production). They cover the migration path, the schema
objects, truly parallel bookings and transaction rollback:

```sh
docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=autowascenter_test --name awc-test-db postgres:18.6-alpine
cd /srv/autowascenter/apps/api && npm ci
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/autowascenter_test npm test
docker rm -f awc-test-db
```

## 10. Start the whole stack

```sh
cd /srv/autowascenter/deploy
docker compose up -d
docker compose ps
```

Expected: `postgres`, `api` and `web` healthy, `caddy` and `backup` running.

## 11. Verify health

```sh
docker compose ps                                   # health column
docker compose logs --tail 30 api                   # "api started", no errors
docker compose exec api node -e \
  "fetch('http://127.0.0.1:3001/health/db').then(async r=>console.log(r.status, await r.text()))"
```

Expected: `200 {"status":"ok","database":"ok"}`. If `/health/db` fails, the API cannot reach
the database and the container stays unhealthy on purpose.

## 12. Verify the web app

```sh
curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" https://<DOMAIN>/
for p in / /diensten /galerij /over-ons /contact /reservatie /admin-login; do
  printf "%-14s %s\n" "$p" "$(curl -sS -o /dev/null -w '%{http_code}' https://<DOMAIN>$p)"
done
curl -sS https://<DOMAIN>/ | grep -o "<title>[^<]*</title>"
```

Expected: all 200, and the title of the site. With `DOMAIN=localhost` add `-k`.

## 13. Verify the API through Caddy

```sh
curl -sS https://<DOMAIN>/api/services | head -c 200
curl -sS https://<DOMAIN>/api/vehicle-types | head -c 200
curl -sS https://<DOMAIN>/api/site-settings
# availability needs a vehicle type and its services:
VT=$(curl -sS https://<DOMAIN>/api/vehicle-types | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
SVC=$(curl -sS "https://<DOMAIN>/api/vehicle-types/$VT/services" | sed -n 's/.*"service_id":"\([^"]*\)".*/\1/p' | head -1)
curl -sS "https://<DOMAIN>/api/availability?date=$(date -u -d '+3 days' +%F)&vehicle_type_id=$VT&service_ids=$SVC"
# the admin API must refuse an anonymous request:
curl -sS -o /dev/null -w "%{http_code}\n" https://<DOMAIN>/api/admin/bookings   # expect 401
```

Also confirm the database is not reachable from outside:

```sh
nc -z -w3 <server-ip> 5432 && echo "PROBLEM: database is public" || echo "database not public"
```

## 14. Verify the uploads

After uploading an image through the admin gallery (step 15), or with the API directly:

```sh
curl -sS https://<DOMAIN>/api/gallery | head -c 300
# the URL from image_url must load through Caddy and come from the API:
curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" "https://<DOMAIN>/uploads/gallery/<file>.jpg"
curl -sSI "https://<DOMAIN>/uploads/gallery/<file>.jpg" | grep -i "cache-control\|x-content-type-options"
docker compose exec api ls -l /app/uploads/gallery      # the file on the volume
```

Expected: 200 with an image content type, `Cache-Control: public, max-age=31536000,
immutable` and `X-Content-Type-Options: nosniff`.

Persistence (the file must survive a container recreation):

```sh
docker compose up -d --force-recreate api
docker compose exec api ls -l /app/uploads/gallery      # same file
```

## 15. Verify Auth0 and the admin (browser)

1. Open `https://<DOMAIN>/admin` → redirected to Auth0.
2. Log in with an account that has the `admin:access` permission.
3. Back on `/admin`: the dashboard shows data.
4. Walk through agenda, reservaties, diensten, voertuigen, blokkades, galerij, instellingen.
5. Create a booking through the public `/reservatie` and find it in the admin reservations.
6. Upload and delete an image in the admin gallery.
7. Log out.

In the browser's network tab: every data request goes to `https://<DOMAIN>/api/...` and
there is no request to `localhost`, to another port or to `supabase.co`.

If the login fails with a callback error, the production URLs in the Auth0 Dashboard do not
match (`docs/AUTH0-SETUP.md`, section 3).

## 16. Test the backup **and the restore**

```sh
docker compose logs --tail 20 backup
docker compose exec backup ls -lh /backups
```

Then do the restore rehearsal from `docs/BACKUP-RESTORE.md` (step 4: restore into a
temporary database and compare the row counts). **The stack is not production-ready until
that rehearsal has succeeded once.**

Also back up the uploads volume and `deploy/.env` outside the server
(`docs/BACKUP-RESTORE.md`).

## 17. Rollback procedure

**Application (code/images) — fast and safe:**

```sh
cd /srv/autowascenter
git log --oneline -5
git checkout <previous-commit>
cd deploy && docker compose build && docker compose up -d
docker compose ps
```

The images are rebuilt from the checked-out source. Keep the previous images around
(`docker image ls`) so `docker compose up -d` can fall back without a rebuild if needed.

**Database — not automatic:**

- Drizzle migrations have **no down migrations**. A schema change cannot be undone with a
  command.
- Backwards-compatible changes (a new nullable column, a new table) need no action: the
  previous code ignores them.
- Breaking changes (a dropped or renamed column, a new NOT NULL) mean: restore the backup
  from before the migration (`docs/BACKUP-RESTORE.md`, step 5) and accept the loss of
  everything written after that moment. So: **take a backup immediately before a breaking
  migration** and keep the outage window short.
- Uploaded files are not versioned; a restore of the uploads volume is a full replacement.

**Order for a full rollback:**

1. `docker compose stop web api caddy backup` (the database keeps running).
2. Restore the database backup (`docs/BACKUP-RESTORE.md`, step 5).
3. Restore the uploads tar from the same moment.
4. Check out the matching code version and `docker compose build`.
5. `docker compose up -d` and run the checks from steps 11–14 again.

## Routine checks

| Interval    | Check                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Daily       | `docker compose ps` (all healthy), `docker compose logs --tail 20 backup`                      |
| Weekly      | `docker compose exec backup ls -lh /backups` (a fresh dump, retention working)                 |
| Monthly     | Restore rehearsal (`docs/BACKUP-RESTORE.md`, step 4), disk usage (`df -h`, `docker system df`) |
| Per release | Review migrations, back up, update (`deploy/README.md`)                                        |
