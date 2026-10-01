# API

## Purpose

Self-hosted backend for Autowascenter. It will take over all database access and business logic that the frontend currently performs directly against Supabase.

**Current scope (phases 3–6B):**

- Health endpoints.
- Read-only public endpoints for services, gallery, reviews, vehicle types and the bookable options per vehicle type.
- **Server-side booking engine**: `GET /api/availability` and `POST /api/bookings`. Pricing, duration, opening hours, blocked periods and overlap protection all run on the server, in one transaction. See `docs/API-V1.md` and `docs/BOOKING-BUSINESS-LOGIC.md`.
- **Auth0 authentication and authorization** (phase 5): JWT validation against the Auth0 JWKS plus RBAC permission checks. See `docs/AUTH0-MIGRATION.md` and `docs/AUTH0-SETUP.md`.
- **Admin read API** (phase 6A): dashboard, bookings (paginated) and booking detail, agenda, services, vehicle types with the pricing matrix, blocked periods, settings, gallery. All require `admin:access`. See `docs/ADMIN-API.md`.
- **Admin write API** (phase 6B): booking create/update/delete (same pricing engine as the public flow; moves exclude the booking itself), services with package contents, vehicle types with an atomic pricing matrix, blocked periods, settings, gallery metadata. Multi-table mutations are single transactions. See `docs/ADMIN-API.md` (_Writes_) and `docs/ADMIN-WRITE-MIGRATION-MAP.md`.

**Not included yet:** uploads/storage (phase 6C), cancellation link, e-mail notifications.

**The frontend does not use this API yet.** It still talks to Supabase directly.

This is a standalone npm package (its own `package.json` and `package-lock.json`). It is not a workspace of the repository root.

## Architecture

```
HTTP request
  → route (src/routes)            Zod validates params/query (invalid → 400)
  → service (src/services)        explicit-column Drizzle queries, row → contract mapping
  → database (src/db)             one shared pg pool per process (Drizzle, parameterized SQL)
  → response `{ "data": [...] }`  or `{ "error": { "code", "message" } }`
```

```
src/
  server.ts          startServer(): config → pool → createApp() → listen, graceful shutdown
  app.ts             createApp(): builds Fastify (logger, errors, CORS, routes); never listens
  config/env.ts      loadConfig(): validated environment variables
  db/                createDb() (pg pool + Drizzle), pingDatabase(), schema/
  contracts/         Zod contracts of the catalogue endpoints
  lib/               business-time (Europe/Brussels), validate (Zod → 400)
  routes/health.ts   /health, /health/db
  routes/public/     index.ts: catalogue GETs; bookings.ts: /availability, /bookings
  routes/admin/      /api/admin/*: every route requires admin:access (index.ts hooks);
                     read.ts: admin reads; bookings-write.ts, catalog-write.ts,
                     content-write.ts: admin writes
  services/admin/    dashboard, bookings (list/detail/agenda), catalog (services,
                     vehicle types, gallery, blocked periods, settings);
                     *-write.service.ts: mutations (db.transaction visible per service)
  contracts/admin-write.ts strict Zod contracts of the admin writes
  contracts/admin.ts strict Zod contracts of the admin responses
  auth/              verifier (jose, JWKS, RS256), principal, plugin
                     (authenticate + requirePermission)
  services/          catalog, gallery, reviews; pricing, schedule (pure slot rules),
                     availability, booking (transaction)
  errors/            AppError + central error handler
  plugins/           db (app.db), clock (app.clock), CORS, rate limit
drizzle/             SQL migrations (see "Database")
test/                node:test suites (PGlite)
```

- **Booking and availability contracts** (request schemas and response shapes) live in `packages/shared`. It is linked as `"@autowascenter/shared": "file:../../packages/shared"`, so there are no root workspaces. Validation uses `safeParse` (`lib/validate.ts`), so it does not depend on which zod copy a schema comes from.
- **Dependencies** (versions pinned exactly, locked in `package-lock.json`): `fastify` 5.12.5, `@fastify/cors` 11.3.0, `@fastify/rate-limit` 11.2.0, `jose` 6.2.12, `zod` 4.6.5, `drizzle-orm` 0.45.3, `pg` 8.23.0.
- **Dev dependencies**: `drizzle-kit`, `typescript`, `@electric-sql/pglite`, `@types/*`.
- **Execution**: Node ≥ 22.18 runs the TypeScript sources directly (built-in type stripping). There is no build step. `tsc --noEmit` does the type checking, and `erasableSyntaxOnly` keeps the code strippable.

## Environment variables

See `.env.example`. `npm run dev` loads `.env` automatically (`--env-file-if-exists`); `npm start` reads only the real environment.

| Variable                       | Required              | Default                                      | Notes                                                                                                                      |
| ------------------------------ | --------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | yes                   | —                                            | Self-hosted PostgreSQL, **not** Supabase. Secret: never logged, never returned, never included in config error messages.   |
| `NODE_ENV`                     | no                    | `development`                                | `development`, `test` or `production`                                                                                      |
| `HOST`                         | no                    | `127.0.0.1`                                  | Use `0.0.0.0` inside a container                                                                                           |
| `PORT`                         | no                    | `3001`                                       |                                                                                                                            |
| `CORS_ORIGIN`                  | **yes in production** | `http://localhost:8080` (outside production) | Comma-separated list of allowed browser origins. `*` is rejected in production.                                            |
| `LOG_LEVEL`                    | no                    | `info`                                       | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`                                                             |
| `BOOKING_RATE_LIMIT_MAX`       | no                    | `10`                                         | Max `POST /api/bookings` requests per client IP per window                                                                 |
| `BOOKING_RATE_LIMIT_WINDOW_MS` | no                    | `60000`                                      | Rate-limit window in ms (≥ 1000)                                                                                           |
| `AUTH0_DOMAIN`                 | **yes in production** | —                                            | Auth0 tenant host (no `https://`). The JWKS URL `https://<domain>/.well-known/jwks.json` is derived from it. Not a secret. |
| `AUTH0_AUDIENCE`               | **yes in production** | —                                            | Auth0 API identifier; must equal the frontend's `VITE_AUTH0_AUDIENCE`. Must be set together with `AUTH0_DOMAIN`.           |
| `AUTH0_ISSUER`                 | no                    | `https://<AUTH0_DOMAIN>/`                    | Only needed with an Auth0 custom domain                                                                                    |

Without `AUTH0_*` (only allowed outside production), `/api/admin/*` answers **503 `AUTHENTICATION_UNAVAILABLE`**. It is never open. The API needs **no** Auth0 client secret.

Invalid configuration stops the process at startup with exit code 1 and names the invalid variables only.

## Running locally

```sh
cd apps/api
npm ci
cp .env.example .env        # point DATABASE_URL to a local PostgreSQL
npm run db:migrate          # apply drizzle/*.sql to DATABASE_URL
npm run dev                 # node --watch, loads .env
```

| Script                | What it does                                   |
| --------------------- | ---------------------------------------------- |
| `npm run dev`         | Development server with file watching          |
| `npm start`           | Production-style start (`node src/server.ts`)  |
| `npm test`            | All tests (PGlite; no database needed)         |
| `npm run typecheck`   | `tsc --noEmit`                                 |
| `npm run db:generate` | New migration after changing `src/db/schema/*` |
| `npm run db:check`    | drizzle-kit consistency check of `drizzle/`    |
| `npm run db:migrate`  | Apply migrations to `DATABASE_URL`             |

No local PostgreSQL has been used so far. Everything was verified with PGlite (see Testing).

## Health endpoints

| Endpoint         | Purpose                                        | 200                                    | Failure                                                                   |
| ---------------- | ---------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| `GET /health`    | **Liveness**: the process is up                | `{ "status": "ok" }`                   | none: it never touches the database                                       |
| `GET /health/db` | **Readiness**: the database answers `select 1` | `{ "status": "ok", "database": "ok" }` | **503** `{ "error": { "code": "DATABASE_UNAVAILABLE", "message": "…" } }` |

**Why two endpoints**: a database outage should take the API out of the load balancer (readiness). It should not make the orchestrator restart a healthy process (liveness). The responses contain no host names, versions or error details; the cause is only logged server-side.

## Public endpoints

All are under `/api` and public (no authentication). The catalogue endpoints are below. **`GET /api/availability` and `POST /api/bookings` are specified in `docs/API-V1.md`**, and their rules in `docs/BOOKING-BUSINESS-LOGIC.md`.

**Conventions**

- Success: `{ "data": [...] }`.
- Errors: `{ "error": { "code": "…", "message": "…" } }`.
- Field names are **snake_case**, identical to the columns the current frontend reads from Supabase, so the frontend can switch later without renaming.
- Money fields are JSON numbers, excl. VAT.
- The health endpoints are the only exception to the `{ data }` envelope.

| Endpoint                                         | Returns                                                                                                                     | Filters and order                                                                                                                               | Used today by (Supabase)                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `GET /api/services?limit=`                       | `id, title, description, category, badge, icon, image_url, bookable, kind, price, duration_minutes`                         | `active = true`; `sort_order`, then `id`                                                                                                        | `ServicesPreview.tsx` (limit 4), `routes/diensten.tsx`    |
| `GET /api/gallery?limit=`                        | `id, title, description, image_url, before_image_url, category`                                                             | all; `sort_order`, then `id`                                                                                                                    | `RealisationsPreview.tsx` (limit 4), `routes/galerij.tsx` |
| `GET /api/reviews?limit=`                        | `id, customer_name, rating, content`                                                                                        | `approved = true`; `created_at` desc, then `id`                                                                                                 | `Testimonials.tsx` (limit 6)                              |
| `GET /api/vehicle-types`                         | `id, slug, title, description, image_url`                                                                                   | `active = true`; `sort_order`, then `id`                                                                                                        | `routes/reservatie.tsx` step 1                            |
| `GET /api/vehicle-types/:vehicleTypeId/services` | `id` (vehicle_type_services id), `service_id, title, description, category, badge, kind, price, duration_minutes, includes` | vehicle type must exist and be active (else **404** `VEHICLE_TYPE_NOT_FOUND`); `available`, service `active` and `bookable`; ordered by `title` | `routes/reservatie.tsx` steps 2–3 (`ServiceOption`)       |

**Notes**

- `?limit` is optional (1–100). Invalid values return **400** `VALIDATION_ERROR`.
- A malformed `vehicleTypeId` (not a UUID) returns **400** `VALIDATION_ERROR`.
- `price` and `duration_minutes` on `/api/services` are the **LEGACY** base values, only shown on the home page. Booking prices come from `/api/vehicle-types/:id/services`.
- The `id` tiebreaks make the order deterministic; Supabase ordered by `sort_order` only.
- The frontend currently filters `bookable && active` **in the browser**. This API applies the same filters in the database. It also returns 404 for inactive vehicle types; today the frontend never asks for those.
- `title` order is PostgreSQL collation order. The frontend used `localeCompare`; results can differ only for accents and case.

**Packages**: there is no separate packages endpoint, because the frontend does not need package data on its own. The booking flow only shows which services a package contains (`includes`, step 2). That is embedded in the vehicle-type services response, with the same semantics as today: the titles of the **active** contained services. For pricing, a package is an ordinary service with its own price (phase 4, `docs/BOOKING-BUSINESS-LOGIC.md` §3).

**Error codes**

| Code                     | Status | When                                                                          |
| ------------------------ | ------ | ----------------------------------------------------------------------------- |
| `VALIDATION_ERROR`       | 400    | Invalid params or query (Zod)                                                 |
| `BAD_REQUEST`            | 4xx    | Rejected by Fastify (malformed request)                                       |
| `NOT_FOUND`              | 404    | Unknown route                                                                 |
| `VEHICLE_TYPE_NOT_FOUND` | 404    | Unknown or inactive vehicle type                                              |
| `DATABASE_UNAVAILABLE`   | 503    | Database unreachable (connection refused or timeout, SQLSTATE 08xxx or 57P0x) |
| `INTERNAL_ERROR`         | 500    | Anything else: generic message; details are only logged                       |

Responses never contain stack traces, SQL or driver messages.

## Testing

```sh
npm test        # node --test "test/**/*.test.ts"
```

| Suite                               | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/schema.test.ts`               | Migrations, overlap exclusion, FKs, CHECKs, triggers (26 tests)                                                                                                                                                                                                                                                                                                                                                                                                            |
| `test/api.test.ts`                  | Every endpoint through `app.inject()`: response shape (strict Zod contract), empty results, filters, ordering, `limit`, 400/404, CORS, **unreachable PostgreSQL** (real `pg` pool on a closed port → 503, no leaked details), unexpected DB error → 500 (19 tests)                                                                                                                                                                                                         |
| `test/config.test.ts`               | Defaults, CORS rules, production requirements, rate-limit settings, no secrets in errors (6 tests)                                                                                                                                                                                                                                                                                                                                                                         |
| `test/business-logic.test.ts`       | Pure rules: Europe/Brussels conversion incl. both DST days, slot grid, multi-day segments, blocked periods, cents and VAT rounding (15 tests)                                                                                                                                                                                                                                                                                                                              |
| `test/booking-engine.test.ts`       | Pricing (single, several, package, package + extra/included, vehicle types, catalogue change/snapshot, invalid/inactive/unavailable), availability (free, booked, cancelled, blocked, opening hours, multi-day, adjacent, overlap start/end/contained, today/past, DST), booking creation, **concurrency** (two simultaneous bookings → 1 success + 1 conflict), exclusion-constraint fallback → 409, rollback (28 tests)                                                  |
| `test/bookings-api.test.ts`         | HTTP: availability and booking contracts, validation, rejected client-supplied totals/status/token, 404/409/422, concurrent POSTs, CORS preflight, rate limit 429, database failure (13 tests)                                                                                                                                                                                                                                                                             |
| `test/auth.test.ts`                 | Auth0 JWT validation without a real tenant (RSA keys generated per run, local and HTTP JWKS): missing, malformed, bad-signature, tampered, wrong-issuer, wrong-audience, expired, not-yet-valid, HS256/`none`, no-`sub` tokens → 401; no permission → 403; `admin:access` → 200 with only `sub`/`permissions`; public endpoints stay public; unconfigured / JWKS down → 503; CORS; **no tokens in logs** (16 tests)                                                        |
| `test/admin-bookings-write.test.ts` | Admin booking writes: server-side pricing/duration/times/snapshots/cancel token, multi-day, client totals rejected, 404/409/422; moves (into another booking → 409, overlapping its own old time → allowed via self-exclusion, date/time, past, off-grid, price kept); service and vehicle-type changes re-priced; statuses incl. cancel (cancelled_at) and reactivation with overlap re-check; delete; admin availability with `exclude_booking_id`; integrity (17 tests) |
| `test/admin-write.test.ts`          | Auth matrix for all 18 write endpoints (401/401/403 with nothing changed, admin success); services (UI defaults + rows for every vehicle type, validation, delete keeps snapshots), package contents (replace, invalid → unchanged), vehicle types (defaults, slug 409, delete in use → 409 `RESOURCE_IN_USE`), pricing matrix (upsert, any invalid row → no change), blocked periods, settings (merge validation, missing → 500), gallery metadata (20 tests)             |
| `test/admin-rollback.test.ts`       | **Forced mid-transaction failures** (test trigger): service + rows, vehicle type + rows, package contents A,B → A,C, booking + lines (admin and public), booking service change, pricing matrix A,B,C → nothing partial (7 tests)                                                                                                                                                                                                                                          |
| `test/admin-read.test.ts`           | Admin read API: auth matrix (no/invalid token → 401, no permission → 403 even with role/e-mail claims, admin → 200) for all 9 endpoints; 400 for bad or unknown parameters; 404 for unknown bookings; strict contracts; data: dashboard aggregates, pagination, detail with snapshots and no `cancel_token`, multi-day agenda, catalogue, pricing matrix, settings (missing → 500), gallery (19 tests)                                                                     |

**PGlite** (`@electric-sql/pglite`, dev only) is the real PostgreSQL engine compiled to WASM, running in-process with `btree_gist`. `test/helpers/test-db.ts` applies all migrations from `drizzle/`, so the tests run against the production schema. No external database, Docker or production data is used. The unreachable-database tests are the only ones that use the `pg` driver; they need no running server.

**Concurrency on PGlite**: PGlite has a single connection, so concurrent transactions run one after the other. The "two simultaneous bookings" tests therefore prove that the second request is rejected, not a true parallel race. The race itself is covered separately: a test inserts a conflicting booking past the pre-check, and the **exclusion constraint** rejects it (SQLSTATE `23P01` → 409). On a real multi-connection PostgreSQL, that constraint is what stops the second of two truly parallel transactions. A parallel test against a real PostgreSQL is still to be added once a test database or container exists.

## Database

- The schema is in `src/db/schema/`. The migrations are in `drizzle/`: `0000_initial_schema.sql` is generated, and `0001_booking_integrity.sql` is hand-written (`btree_gist`, booking overlap exclusion constraint, `updated_at` triggers).
- **One pool per process** is created in `startServer()` (`max` 10, 5 s connection timeout, 30 s idle timeout). It is shared by all requests via `app.db`, closed in Fastify's `onClose` hook on shutdown, and idle-client errors are logged instead of crashing the process.
- All queries use the Drizzle query builder, so they are parameterized. There is no string-built SQL.
- Schema decisions (versus Supabase), LEGACY columns and the DEFERRED BUSINESS DECISION on opening hours are documented in `docs/DATABASE-MIGRATION-MAP.md` and `docs/MIGRATION-STATUS.md`.
- Before importing Supabase data, the export must satisfy the stricter constraints: recompute `start_at`/`end_at`, resolve overlapping bookings, no zero durations, valid times, one `site_settings` row.

## Authentication boundary

**Auth0 is the external identity provider** (since phase 5). The API is authoritative for authorization.

- **Public** (no authentication, ever; customers have no accounts): `/health*`, the catalogue endpoints, `GET /api/availability`, `POST /api/bookings`. These do not read the `Authorization` header.
- **Protected**: everything under `/api/admin/*`. A plugin-wide `preHandler` runs `authenticate` (Bearer token → `jose` verification: RS256 signature against the cached remote JWKS, issuer, audience, exp/nbf) and then `requirePermission("admin:access")`.
  - Authorization uses **only** the RBAC `permissions` claim: no e-mail, `sub` or role-name checks, and no fake or hardcoded tokens.
  - The Auth0 `sub` is an opaque string. No users are stored in PostgreSQL.
- `GET /api/admin/me` returns `{ data: { sub, permissions } }`: no token, no profile claims.
- Errors: 401 `AUTHENTICATION_REQUIRED` / `AUTHENTICATION_INVALID` (with `WWW-Authenticate`), 403 `AUTHORIZATION_REQUIRED`, 503 `AUTHENTICATION_UNAVAILABLE` (JWKS unreachable or Auth0 not configured). Rejection reasons are logged as codes only, never returned.
- `POST /api/bookings` is the only public write: the server computes price, duration, totals, status (`nieuw`), `start_at`/`end_at` and the cancel token. It is rate limited, Zod-validated, transactional and protected by the exclusion constraint.
- CORS allows `GET`, `HEAD`, `POST` and `OPTIONS` with the `Content-Type` and `Authorization` headers, for the configured origins only; no cookies or credentials mode. The Auth0 host is not an API origin.

## Production notes

- **Start**: `NODE_ENV=production node src/server.ts` (`npm start`), with the variables from the environment (container env or secrets), not from a committed file. `CORS_ORIGIN` must list the real frontend origins, e.g. `https://autowascenter.be,https://www.autowascenter.be`. In a container, set `HOST=0.0.0.0`.
- **Migrations**: run `npm run db:migrate` as a separate deploy step, not on API startup.
- **Behind the reverse proxy** (Caddy, later phase): TLS terminates at the proxy. Enabling Fastify `trustProxy` for correct client IPs in the logs is still to do. Map `/health` to liveness and `/health/db` to readiness.
- **Logs**: JSON (pino) on stdout. The `authorization` and `cookie` headers are redacted, and `DATABASE_URL` is never logged.
- **Shutdown**: on `SIGTERM`/`SIGINT` the server stops accepting requests, finishes in-flight ones and closes the pool.
- **Rate limiting**: the limiter keeps its counters in process memory, per client IP.
  - That is fine for one API process. With several replicas every replica counts separately, so a shared store (e.g. Redis) is needed.
  - Behind the proxy, enable `trustProxy`; otherwise all clients share the proxy's IP and the limit applies to everyone together.
- **Auth0**: set `AUTH0_DOMAIN`/`AUTH0_AUDIENCE` (required in production) and complete `docs/AUTH0-SETUP.md`. The API only fetches Auth0's public keys; it needs outbound HTTPS to the Auth0 domain.
- **Not production-ready yet**: no admin CRUD, no Docker image, and no parallel-race test on a real PostgreSQL. These are planned phases.
