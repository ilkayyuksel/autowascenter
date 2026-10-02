# Self-hosted Architecture

State after phase 7C: the application runs without Supabase, Lovable or Cloudflare Workers.

```
Browser ──► Web  (TanStack Start SSR, Node, .output/server/index.mjs)     port 3000 (prod) / 8080 (dev)
   │
   └──────► API  (Fastify, apps/api, node src/server.ts)                  port 3001
              ├─► PostgreSQL (Drizzle; self-hosted)
              ├─► Local file storage (UPLOAD_DIR; gallery images)
              └─► Auth0 JWKS (verifies admin access tokens)
Browser ──► Auth0 Universal Login (admins only)
```

Web and API are **two separate processes**. The web app never connects to PostgreSQL. The browser talks to the API at `VITE_API_BASE_URL`.

## Web

- **Stack**: React 19, TanStack Start/Router (file-based routes, generated `src/routeTree.gen.ts`), Vite 7, Tailwind v4, shadcn/ui.
- **SSR**: Nitro, preset `node-server`. All data comes from the API through `src/lib/api/*`:
  - public reads/writes via `publicApi` (no token);
  - admin via `getAdmin`/`postAdmin`/… (Auth0 access token).
- **Build config**: an explicit `vite.config.ts` with these plugins:
  - `@tailwindcss/vite`;
  - `vite-tsconfig-paths`;
  - `@tanstack/react-start/plugin/vite` (with `importProtection`: `**/server/**` and `server-only` can never reach the browser);
  - `nitro/vite` (`preset: "node-server"`, build only);
  - `@vitejs/plugin-react`.
- CSS goes through `lightningcss`, as before.

## API

`apps/api`: Fastify 5, Zod contracts (`packages/shared`), Drizzle on PostgreSQL. It handles:

- the public catalogue, availability and bookings;
- the admin read/write API (Auth0 `admin:access`);
- gallery uploads.

It is unchanged in this phase. See `apps/api/README.md`, `docs/API-V1.md` and `docs/ADMIN-API.md`.

## PostgreSQL

- The only database. The schema is in `apps/api/src/db/schema/`, the migrations in `apps/api/drizzle/` (`npm run db:migrate` in `apps/api`).
- The historical Supabase schema is archived in `docs/legacy/supabase/` (**ARCHIVED — NOT USED BY APPLICATION**).

## Auth0

- The only identity provider, used for admins only; customers have no accounts.
- **SPA**: `@auth0/auth0-react`, Authorization Code + PKCE, tokens in memory.
- **API**: verifies RS256 access tokens via JWKS (issuer, audience) and requires the `admin:access` permission.
- Unchanged. See `docs/AUTH0-SETUP.md`.

## Local storage

- Gallery images are stored by the API in `UPLOAD_DIR/gallery/<uuid>.<jpg|png|webp>` and served at `PUBLIC_UPLOAD_URL/gallery/…`.
- In production `UPLOAD_DIR` is a persistent volume that is backed up together with the database.
- See `docs/GALLERY-STORAGE-MIGRATION.md`.

## External dependencies

Intentionally retained:

| Dependency                                                        | Where                                               | Status                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| Auth0                                                             | admin login, API token verification                 | Intended identity provider                                              |
| Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`, Inter) | `src/routes/__root.tsx`                             | External Google Fonts = remaining external dependency (not a blocker)   |
| Google Maps iframe                                                | `src/routes/contact.tsx`, `src/routes/over-ons.tsx` | EXTERNAL EMBED — intentionally retained                                 |
| `wa.me`, `tel:`, `mailto:`, Instagram, Facebook links             | `src/lib/site.ts`, layout                           | Plain links, retained                                                   |
| Old Supabase Storage image URLs in `gallery_items`                | data only (if imported later)                       | Displayed as plain image URLs; nothing is fetched from Supabase by code |

**No longer used**: Supabase (database, auth, storage, SDK), Lovable (Vite preset, sandbox/editor hooks, hosted preview image), Cloudflare Workers (`cloudflare-module` target, Wrangler, `@cloudflare/vite-plugin`).

**Transitive, unused**: the pinned `nitro` (3.0.260603-beta) has an internal dev runner (`env-runner`) with optional peer dependencies `wrangler`, `miniflare` and `workerd`. npm installs them as part of nitro.

- Our config and source never import them.
- The `node-server` build output contains no reference to them, and the server runs from `.output/` alone (verified by copying `.output` outside the repository).
- They disappear only with a future nitro version or a deliberate npm peer policy. Upgrading nitro was not necessary for the Node target, so it was not done.

## Environment variables

**WEB** (root `.env`): build-time, embedded in the browser bundle, **public**.

| Variable               | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `VITE_API_BASE_URL`    | Base URL of the API (e.g. `https://api.autowascenter.be`) |
| `VITE_AUTH0_DOMAIN`    | Auth0 tenant domain                                       |
| `VITE_AUTH0_CLIENT_ID` | Auth0 SPA client id (not a secret)                        |
| `VITE_AUTH0_AUDIENCE`  | Auth0 API identifier (= API `AUTH0_AUDIENCE`)             |

Runtime of the web server: `PORT` (default 3000) and `HOST` (Nitro also accepts `NITRO_PORT`/`NITRO_HOST`). No secrets.

**API** (`apps/api/.env`): **server-only**, never `VITE_`-prefixed.

| Variable                                                                | Purpose                                              |
| ----------------------------------------------------------------------- | ---------------------------------------------------- |
| `DATABASE_URL`                                                          | PostgreSQL connection (**secret**)                   |
| `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`                                 | Process settings                                     |
| `CORS_ORIGIN`                                                           | Allowed browser origins (the web app's public URL)   |
| `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_ISSUER` (optional)             | Token verification (public values; no client secret) |
| `UPLOAD_DIR`, `PUBLIC_UPLOAD_URL`, `MAX_UPLOAD_BYTES`                   | Gallery storage                                      |
| `BOOKING_RATE_LIMIT_MAX/_WINDOW_MS`, `UPLOAD_RATE_LIMIT_MAX/_WINDOW_MS` | Rate limits                                          |

Rule: every `VITE_*` value is visible to every visitor. Server secrets (`DATABASE_URL`, passwords, any client secret) only exist in the API environment. The frontend source contains none of them; `src/self-hosted-build.test.ts` checks `.env.example`.

## Development

```sh
# API (terminal 1)
cd apps/api && npm ci && npm run db:migrate && npm run dev     # http://localhost:3001

# Web (terminal 2)
npm ci && npm run dev                                          # http://localhost:8080
```

The dev server listens on `::` port 8080, which is the API's default `CORS_ORIGIN`.

## Production runtime

> In production both processes run as containers; see _Docker (production stack)_ below.
> The commands in this section are what the containers run, and what a bare-metal install
> would use.

- **Web**: `npm run build`, then `npm run start` (= `node .output/server/index.mjs`). Set `PORT`/`HOST` as needed. `.output/` is self-contained: it needs Node ≥ 22 and nothing else from the repository.
- **API**: `cd apps/api && npm ci --omit=dev`, `npm run db:migrate` (deploy step), then `npm start` (= `node src/server.ts`; Node ≥ 22.18 runs the TypeScript directly).

## Build

| Item             | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Command          | `npm run build` (`vite build`)                               |
| Nitro preset     | `node-server` (nitro 3.0.260603-beta, unchanged)             |
| Output directory | `.output/` (`nitro.json`, `public/`, `server/`)              |
| Static assets    | `.output/public/` (served by the Node server: `serveStatic`) |
| Server entry     | `.output/server/index.mjs`                                   |

The route tree (`src/routeTree.gen.ts`) is generated by the TanStack Start plugin as before.

## Start

| Command           | What                                                    |
| ----------------- | ------------------------------------------------------- |
| `npm run dev`     | Vite dev server with SSR (development)                  |
| `npm run build`   | Production build (Node target)                          |
| `npm run start`   | `node .output/server/index.mjs` (production web server) |
| `npm run preview` | `vite preview` of the build                             |

**Verified in phase 7C**:

- `npm run start` with `PORT=3456`: `/`, `/diensten`, `/galerij`, `/over-ons`, `/contact`, `/reservatie`, `/admin-login` → 200; `/og-image.jpg`, `/favicon.ico` → 200; unknown route → 404.
- `/health` is an **API** route (`apps/api`), not a web route, and correctly answers 404 on the web server.
- The same `.output` copied to a temporary directory outside the repository also served `/` and `/reservatie`.
- `npm run dev` served `/`, `/diensten`, `/reservatie`, `/admin-login` → 200.

## What was removed

| Removed                                                                                                                      | Replaced by                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `@supabase/supabase-js`, `src/integrations/supabase/*` (client, server client, auth middleware, preview auth storage, types) | Own API (`src/lib/api/*`), Auth0                                |
| `src/lib/slots.ts` (local slot calculation on Supabase data)                                                                 | `GET /api/availability`, `GET /api/admin/availability`          |
| `VITE_SUPABASE_*`, `SUPABASE_*` in `.env.example`                                                                            | —                                                               |
| `supabase/` (moved)                                                                                                          | `docs/legacy/supabase/` (archive)                               |
| `@lovable.dev/vite-tanstack-config` (and its sandbox/editor plugins)                                                         | Explicit `vite.config.ts`                                       |
| Cloudflare Workers target (`cloudflare-module`), `wrangler.jsonc`, `@cloudflare/vite-plugin`, `.wrangler/`                   | Nitro `node-server`                                             |
| `bun.lockb`, `bunfig.toml` (Lovable's bun tooling)                                                                           | npm + `package-lock.json`                                       |
| Lovable/R2-hosted `og:image` / `twitter:image`                                                                               | `public/og-image.jpg` → `https://autowascenter.be/og-image.jpg` |

## What remains external

Auth0, Google Fonts, the Google Maps embed and social/contact links (see _External dependencies_).

## Historical Supabase data

**NOT MIGRATED.** The existing Supabase project (old bookings, gallery files, settings) stays outside this codebase. Old bookings are not imported and old gallery files are not copied; that is a separate data-migration phase after the self-hosted runtime is stable. No data migration scripts exist yet.

## Docker (production stack)

Implemented in phase 8; the files live in `deploy/`. Operations:
`deploy/README.md`, deployment: `docs/PRODUCTION-DEPLOYMENT.md`.

```
Internet ──:80/:443──► caddy ──┬─ /api/*, /uploads/*  ──► api  ──► postgres
                               │                              └──► uploads volume
                               └─ everything else     ──► web
                                                            backup ──► backup volume
```

| Service    | Image                           | Published ports | Runs as               |
| ---------- | ------------------------------- | --------------- | --------------------- |
| `caddy`    | `caddy:2.11.4-alpine`           | 80, 443 (+udp)  | root (binds :80/:443) |
| `web`      | built on `node:22.18.0-alpine`  | none            | `node`                |
| `api`      | built on `node:22.18.0-alpine`  | none            | `node`                |
| `postgres` | `postgres:18.6-alpine`          | none            | `postgres`            |
| `backup`   | built on `postgres:18.6-alpine` | none            | `postgres`            |

- **Same origin.** The web app is built with an **empty** `VITE_API_BASE_URL`, so the
  browser requests `/api/...` on the site's own host and Caddy forwards it to the API. There
  is no second public port, no API host name in the bundle and no cross-origin request. The
  value is not `/api`, because the API already serves its routes under `/api`.
- **Nothing but Caddy is published.** PostgreSQL, the API and the web app are only reachable
  over the private `internal` network.
- **`trustProxy`.** The API gets `TRUST_PROXY=true` so the per-IP rate limits use the real
  client IP from `X-Forwarded-For` instead of Caddy's address. Off by default, so a directly
  exposed API cannot be fooled by a forged header.
- **Volumes**: `postgres_data`, `uploads_data`, `backup_data`, `caddy_data`,
  `caddy_config`. Only the backup job mounts `backup_data`.
- **Migrations** are an explicit step
  (`docker compose run --rm api node src/scripts/migrate.ts`, using `drizzle-orm`'s migrator
  so the production image needs no dev tooling). Starting the stack never migrates.
- **Hardening**: `web` and `api` run non-root with a read-only root filesystem,
  `cap_drop: ALL` and a tmpfs on `/tmp`; every service gets `no-new-privileges`. Images are
  pinned to exact versions, and `.dockerignore` keeps `.env`, `node_modules`, `uploads`,
  `backups` and `.output` out of every build context.
- **Backups**: daily `pg_dump | gzip` with a timestamp, retention
  `BACKUP_RETENTION_DAYS` (default 14), written to the private backup volume. The uploads
  volume and `deploy/.env` are backed up manually; see `docs/BACKUP-RESTORE.md`.
- **Logs** go to stdout/stderr with rotation (10 MB × 5 per container).

The API keeps running its TypeScript sources with Node's built-in type stripping
(`node src/server.ts`). That is the same `node` binary as in any production process, not a
development runner: no transpiler, no loader, no extra dependency. See
`deploy/README.md` for the full reasoning.
