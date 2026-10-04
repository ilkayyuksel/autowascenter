# Docker stack

Production stack for Autowascenter: the web app, the API, PostgreSQL, Caddy and a backup
job. Everything in this directory is infrastructure; the application itself is unchanged.

> **Verification status.** The stack was built and started on a local Docker host on
> 2026-10-03 (Docker 29.8.1, `DOMAIN=localhost`) and passed the full gate: migrations and
> schema on real PostgreSQL 18.6, 12 integration tests including parallel bookings, routing
> through Caddy, upload and database persistence, the backup job with retention, and the
> restore rehearsal. Details and the remaining server-specific steps (Hostinger VPS, DNS,
> the public certificate, the Auth0 browser flow) are in `docs/HOSTINGER-DEPLOYMENT.md`.

## Architecture

```
                 Internet
                    │  :80 / :443
              ┌─────▼─────┐
              │   caddy   │  automatic HTTPS, the only published ports
              └─────┬─────┘
       /api/*, /uploads/*   everything else
              │                  │
         ┌────▼────┐        ┌────▼────┐
         │   api   │        │   web   │   SSR, no database access
         └────┬────┘        └─────────┘
              │ internal network (no host ports)
     ┌────────┴──────────┐
┌────▼────┐        ┌─────▼──────┐
│ postgres│        │uploads_data│  gallery files
└────┬────┘        └────────────┘
     │
┌────▼────┐
│ backup  │  daily pg_dump → backup_data (private)
└─────────┘
```

The browser only ever talks to Caddy. Because `/api/*` is served from the same origin as
the site, the frontend is built with an **empty** `VITE_API_BASE_URL` and requests
`/api/...` relatively: no API host, no extra public port and no cross-origin requests.
`/uploads/*` goes to the API, which serves the gallery files from the uploads volume with
its own cache and security headers.

## Services

| Service    | Image                           | Role                                                 | User                                 |
| ---------- | ------------------------------- | ---------------------------------------------------- | ------------------------------------ |
| `caddy`    | `caddy:2.11.4-alpine`           | Reverse proxy, automatic TLS, HTTP/3, gzip/zstd      | image default (root, needs :80/:443) |
| `web`      | built, `node:22.18.0-alpine`    | TanStack Start SSR (`node .output/server/index.mjs`) | `node` (non-root)                    |
| `api`      | built, `node:22.18.0-alpine`    | Fastify API (`node src/server.ts`)                   | `node` (non-root)                    |
| `postgres` | `postgres:18.6-alpine`          | The only database                                    | image default (`postgres`)           |
| `backup`   | built on `postgres:18.6-alpine` | Daily `pg_dump`, gzip, retention                     | `postgres` (non-root)                |

All images are pinned to an exact version; `:latest` is never used. Node 22.18.0 matches the
version the repository is developed and tested on.

**Why the API runs TypeScript directly.** `node src/server.ts` uses Node's built-in type
stripping (`process.features.typescript === "strip"` since Node 22.18) — the same `node`
binary as any other production process, with no transpiler, loader, watcher or extra
dependency at runtime. The repository is built for it: `erasableSyntaxOnly` in
`tsconfig.json`, explicit `.ts` import specifiers, and `tsc --noEmit` type-checks every
change. A separate `tsc` build step would add a second toolchain (including compiling the
`packages/shared` dependency) without making the running code safer, so it was deliberately
not added.

## Ports

| Port        | Where    | Published?                                                                  |
| ----------- | -------- | --------------------------------------------------------------------------- |
| 80/tcp      | caddy    | **yes** (needed for the ACME HTTP-01 challenge and the HTTP→HTTPS redirect) |
| 443/tcp+udp | caddy    | **yes** (HTTPS, HTTP/3)                                                     |
| 3000/tcp    | web      | no, internal network only                                                   |
| 3001/tcp    | api      | no, internal network only                                                   |
| 5432/tcp    | postgres | no, internal network only                                                   |

The database is unreachable from the internet, and neither the API nor the web app needs a
host port because Caddy reaches them over the private `internal` network.

## Volumes

| Volume          | Mount                          | Content                                            | Backed up?              |
| --------------- | ------------------------------ | -------------------------------------------------- | ----------------------- |
| `postgres_data` | postgres `/var/lib/postgresql` | Database files (`PGDATA=/var/lib/postgresql/data`) | by the backup job       |
| `uploads_data`  | api `/app/uploads`             | Gallery images (`gallery/`, private `.staging/`)   | **manually, see below** |
| `backup_data`   | backup `/backups`              | `*.sql.gz` dumps                                   | n/a                     |
| `caddy_data`    | caddy `/data`                  | Certificates and ACME state                        | not needed (reissued)   |
| `caddy_config`  | caddy `/config`                | Caddy's autosave config                            | not needed              |

Only the backup job mounts `backup_data`: the API, the web app and Caddy cannot read the
dumps, and Caddy never serves them.

The database dump does **not** include the uploaded images. Restoring the database alone
would leave gallery rows pointing at missing files, so back up the uploads volume at the
same moment, for example:

```sh
docker run --rm -v autowascenter_uploads_data:/data:ro -v "$PWD":/out alpine:3.21 \
  tar czf /out/uploads-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C /data .
```

## Which Compose, and which `.env`

**Docker Compose V2 is required**: `docker compose` (the plugin). The legacy standalone
`docker-compose` (Python, 1.x) cannot read this stack -- it rejects the `name:` key with
`'name' does not match any of the regexes: '^x-'`. Check which one you have:

```sh
docker compose version      # expect v2.x or later
```

**Run Compose from `deploy/`.** Compose reads `.env` from the directory of the compose
file, so from the repository root it would read the root `.env` (the frontend's development
values) and every server variable would silently become a blank string. From the root, pass
both paths:

```sh
docker compose --env-file deploy/.env -f deploy/docker-compose.yml config
```

Required variables are written as `${VAR:?...}` in the compose file, so a missing one is
named and refuses to start instead of becoming an empty value. `docker compose config` is
the quickest check -- but its output contains the database password in cleartext, so do not
paste or pipe it anywhere.

## Environment variables

Copy `.env.example` to `.env` and fill it in; `chmod 600 .env`. It is never committed
(`.gitignore`) and never copied into an image (`.dockerignore`). `.env.example` marks every
variable `[REQUIRED]` or `[OPTIONAL]` with its default, so it is usable on its own.

| Variable                                           | Where it is used                                              | Req. | Notes                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| `DOMAIN`                                           | caddy, and the defaults for `CORS_ORIGIN`/`PUBLIC_UPLOAD_URL` | yes  | The canonical domain. `localhost` for a local test.                              |
| `POSTGRES_DB`, `POSTGRES_USER`                     | postgres, api, backup                                         | yes  | Created on first start of an empty data volume.                                  |
| `POSTGRES_PASSWORD`                                | postgres, api, backup                                         | yes  | **Secret.** Only in `.env`; `openssl rand -base64 32`.                           |
| `DATABASE_URL`                                     | api                                                           | no   | **Secret.** Empty = derived from the `POSTGRES_*` values with host `postgres`.   |
| `LOG_LEVEL`                                        | api                                                           | no   | Default `info` (JSON to stdout).                                                 |
| `TRUST_PROXY`                                      | api                                                           | no   | Default `true` behind Caddy, so the rate limits see the real client IP.          |
| `CORS_ORIGIN`                                      | api                                                           | no   | Default `https://$DOMAIN`. Never `*`.                                            |
| `PUBLIC_UPLOAD_URL`                                | api                                                           | no   | Default `https://$DOMAIN/uploads`. Determines the stored image URLs.             |
| `MAX_UPLOAD_BYTES`, `*_RATE_LIMIT_*`               | api                                                           | no   | Upload size and rate limits; defaults in `.env.example`.                         |
| `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`                   | api                                                           | yes  | Public values; token verification only, **no client secret**.                    |
| `AUTH0_ISSUER`                                     | api                                                           | no   | Default `https://$AUTH0_DOMAIN/`. Only for an Auth0 custom domain.               |
| `VITE_API_BASE_URL`                                | web **build**                                                 | no   | Empty = same origin. Not `/api`: the API already serves its routes under `/api`. |
| `VITE_AUTH0_DOMAIN`, `_CLIENT_ID`, `_AUDIENCE`     | web **build**                                                 | yes  | **Public**: compiled into the browser bundle.                                    |
| `BACKUP_RETENTION_DAYS`, `BACKUP_INTERVAL_SECONDS` | backup                                                        | no   | Default 14 days, every 24 h.                                                     |

`UPLOAD_DIR`, `HOST`, `PORT` and `NODE_ENV` are not configurable through `.env`: the compose
file and the images fix them. `TZ` is not used anywhere; the API converts to
Europe/Brussels in code.

`VITE_*` values are build-time: after changing one, run `docker compose build web` and
recreate the container. The web service receives no database credentials and no Auth0
secret at all.

Auth0 Dashboard values for the production domain (manual, one-off): see
`docs/AUTH0-SETUP.md`, section 3.

## Migrations

Starting the stack never changes the database schema. Migrations are an explicit step:

```sh
docker compose up -d postgres                                  # wait until healthy
docker compose run --rm api node src/scripts/migrate.ts
```

`src/scripts/migrate.ts` applies `apps/api/drizzle/*.sql` in the order of
`drizzle/meta/_journal.json` and records them in `drizzle.__drizzle_migrations`, exactly
like `drizzle-kit migrate` in development. It uses `drizzle-orm`'s migrator, so the
production image needs no dev tooling. Running it twice is harmless: applied migrations are
skipped.

## Backup

The `backup` service runs `pg_dump` once at start and then every `BACKUP_INTERVAL_SECONDS`
(default daily):

- gzip-compressed plain SQL, UTC timestamp in the name: `<db>-20261002T030000Z.sql.gz`;
- written to `<name>.part` first and renamed afterwards, so an interrupted run never leaves
  a file that looks like a valid backup;
- dumps older than `BACKUP_RETENTION_DAYS` are deleted, but only after a successful new dump,
  so a failing job can never remove the last backup;
- no upload to external storage (deliberately out of scope for this phase).

```sh
docker compose logs backup | tail -20       # what the job did
docker compose exec backup ls -lh /backups  # the dumps
```

A one-off backup outside the schedule:

```sh
docker compose exec -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
  | gzip -9 > manual-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
```

## Restore

The full procedure, including a restore into a temporary database first, is in
`docs/BACKUP-RESTORE.md`. **A backup is only proven once a restore has been tested.**

## Logs

All containers log to stdout/stderr (the API logs JSON through Fastify, Caddy logs JSON).
The `json-file` driver rotates at 10 MB × 5 files per container, so logs cannot fill the
disk, and there are no application log files inside the containers.

```sh
docker compose logs -f api        # follow
docker compose logs --since 1h    # everything from the last hour
docker compose ps                 # state + health
df -h /                           # disk on the host
docker system df                  # space used by images, volumes and build cache
```

A fuller operations reference (including the Hostinger firewall and DNS) is in
`docs/HOSTINGER-DEPLOYMENT.md`, section 12.

## Restart

```sh
docker compose restart api        # one service
docker compose up -d              # apply changed configuration
docker compose down               # stop everything, KEEP the volumes
docker compose down -v            # ALSO DELETES the data — never in production
```

All services use `restart: unless-stopped`, so they come back after a reboot or a crash
(including the backup loop) until they are stopped explicitly.

## Update procedure

```sh
git pull
docker compose build                 # new images
# Review the migrations first: are they backwards compatible?
git diff --stat HEAD@{1} -- apps/api/drizzle
docker compose run --rm api node src/scripts/migrate.ts
docker compose up -d                 # recreates only the changed containers
docker compose ps                    # all healthy?
```

Take a backup before a risky migration (see above). Migrations are never run automatically.

Rollback: see `docs/PRODUCTION-DEPLOYMENT.md`.

## Resource limits

No CPU or memory limits are configured. On a single-purpose server there is no noisy
neighbour to protect against, and a wrong limit causes an OOM kill under exactly the load
where the site must keep working. Add limits only after measuring (`docker stats`).
