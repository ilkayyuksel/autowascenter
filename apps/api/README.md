# API

## Purpose

Self-hosted backend for Autowascenter. It will take over all database access and business logic that the frontend currently performs directly against Supabase.

**Current scope (phase 3):**

- Health endpoints.
- Read-only public endpoints for services, gallery, reviews, vehicle types and the bookable options per vehicle type.

**Not included yet:** authentication, admin endpoints, creating bookings, pricing and availability engines.

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
  contracts/         Zod request/response contracts of the public endpoints
  routes/health.ts   /health, /health/db
  routes/public/     /api/* public GET endpoints
  services/          catalog, gallery, reviews: all database queries
  errors/            AppError + central error handler
  plugins/           db decoration (app.db), CORS
drizzle/             SQL migrations (see "Database")
test/                node:test suites (PGlite)
```

- **Dependencies** (versions pinned exactly, locked in `package-lock.json`): `fastify` 5.12.5, `@fastify/cors` 11.3.0, `zod` 4.6.5, `drizzle-orm` 0.45.3, `pg` 8.23.0.
- **Dev dependencies**: `drizzle-kit`, `typescript`, `@electric-sql/pglite`, `@types/*`.
- **Execution**: Node ≥ 22.18 runs the TypeScript sources directly (built-in type stripping). There is no build step. `tsc --noEmit` does the type checking, and `erasableSyntaxOnly` keeps the code strippable.

## Environment variables

See `.env.example`. `npm run dev` loads `.env` automatically (`--env-file-if-exists`); `npm start` reads only the real environment.

| Variable       | Required              | Default                                      | Notes                                                                                                                    |
| -------------- | --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL` | yes                   | —                                            | Self-hosted PostgreSQL, **not** Supabase. Secret: never logged, never returned, never included in config error messages. |
| `NODE_ENV`     | no                    | `development`                                | `development`, `test` or `production`                                                                                    |
| `HOST`         | no                    | `127.0.0.1`                                  | Use `0.0.0.0` inside a container                                                                                         |
| `PORT`         | no                    | `3001`                                       |                                                                                                                          |
| `CORS_ORIGIN`  | **yes in production** | `http://localhost:8080` (outside production) | Comma-separated list of allowed browser origins. `*` is rejected in production.                                          |
| `LOG_LEVEL`    | no                    | `info`                                       | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`                                                           |

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

All are under `/api`, public (no authentication) and read-only.

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

**Packages**: there is no separate packages endpoint, because the frontend does not need package data on its own. The booking flow only shows which services a package contains (`includes`, step 2). That is embedded in the vehicle-type services response, with the same semantics as today: the titles of the **active** contained services. Nothing else about packages is implemented. If later steps need package data (for example pricing validation or preventing double counting of a package plus an included service), that belongs to the booking/pricing phase.

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

| Suite                 | What                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/schema.test.ts` | Migrations, overlap exclusion, FKs, CHECKs, triggers (26 tests)                                                                                                                                                                                                    |
| `test/api.test.ts`    | Every endpoint through `app.inject()`: response shape (strict Zod contract), empty results, filters, ordering, `limit`, 400/404, CORS, **unreachable PostgreSQL** (real `pg` pool on a closed port → 503, no leaked details), unexpected DB error → 500 (19 tests) |
| `test/config.test.ts` | Defaults, CORS rules, production requirements, no secrets in errors (5 tests)                                                                                                                                                                                      |

**PGlite** (`@electric-sql/pglite`, dev only) is the real PostgreSQL engine compiled to WASM, running in-process with `btree_gist`. `test/helpers/test-db.ts` applies all migrations from `drizzle/`, so the tests run against the production schema. No external database, Docker or production data is used. The unreachable-database test is the only one that uses the `pg` driver; it needs no running server.

## Database

- The schema is in `src/db/schema/`. The migrations are in `drizzle/`: `0000_initial_schema.sql` is generated, and `0001_booking_integrity.sql` is hand-written (`btree_gist`, booking overlap exclusion constraint, `updated_at` triggers).
- **One pool per process** is created in `startServer()` (`max` 10, 5 s connection timeout, 30 s idle timeout). It is shared by all requests via `app.db`, closed in Fastify's `onClose` hook on shutdown, and idle-client errors are logged instead of crashing the process.
- All queries use the Drizzle query builder, so they are parameterized. There is no string-built SQL.
- Schema decisions (versus Supabase), LEGACY columns and the DEFERRED BUSINESS DECISION on opening hours are documented in `docs/DATABASE-MIGRATION-MAP.md` and `docs/MIGRATION-STATUS.md`.
- Before importing Supabase data, the export must satisfy the stricter constraints: recompute `start_at`/`end_at`, resolve overlapping bookings, no zero durations, valid times, one `site_settings` row.

## Authentication boundary

**Auth0 is added in a later phase.**

- There is no authentication of any kind yet: no Auth0, no fake or temporary tokens, no hardcoded admin credentials.
- All current endpoints are public reads of data that Supabase RLS already exposes to anonymous users. The API is stricter: it filters inactive and unavailable rows and does not expose `blocked_periods.reason` or `site_settings`.
- **No admin or write endpoints exist.** They will only be added together with Auth0 JWT validation and a role/permission check in the backend.
- CORS only allows `GET`, `HEAD` and `OPTIONS`.

## Production notes

- **Start**: `NODE_ENV=production node src/server.ts` (`npm start`), with the variables from the environment (container env or secrets), not from a committed file. `CORS_ORIGIN` must list the real frontend origins, e.g. `https://autowascenter.be,https://www.autowascenter.be`. In a container, set `HOST=0.0.0.0`.
- **Migrations**: run `npm run db:migrate` as a separate deploy step, not on API startup.
- **Behind the reverse proxy** (Caddy, later phase): TLS terminates at the proxy. Enabling Fastify `trustProxy` for correct client IPs in the logs is still to do. Map `/health` to liveness and `/health/db` to readiness.
- **Logs**: JSON (pino) on stdout. The `authorization` and `cookie` headers are redacted, and `DATABASE_URL` is never logged.
- **Shutdown**: on `SIGTERM`/`SIGINT` the server stops accepting requests, finishes in-flight ones and closes the pool.
- **Not production-ready yet**: no rate limiting, no auth, no Docker image. These are planned phases.
