# Admin API

Read-side of the admin API (phase 6A), served from the self-hosted PostgreSQL.

- There are **no write endpoints** yet (phase 6B).
- The admin frontend is **not connected** yet and still uses Supabase.
- Mapping to the current frontend queries: `docs/ADMIN-MIGRATION-MAP.md`. Contracts (strict Zod): `apps/api/src/contracts/admin.ts`.

## Authentication

Every endpoint under `/api/admin/*` requires `Authorization: Bearer <access token>`: an Auth0 **access token** for the API audience, never an ID token.

The API verifies:

- the RS256 signature against the cached Auth0 JWKS;
- `iss`, `aud`, `exp`/`nbf`;
- that `sub` is present.

Details: `docs/AUTH0-MIGRATION.md`.

## Authorization

- **Required permission**: `admin:access` in the token's RBAC `permissions` claim.
- **Where it is enforced**: the two `preHandler` hooks (`authenticate`, then `requirePermission("admin:access")`) sit in the parent plugin `routes/admin/index.ts`, so they apply to **every** admin route. A route cannot opt out.
- **Never used for authorization**: e-mail addresses, `sub` values, role names (`roles` claims are ignored), Supabase `user_roles`, or any request parameter. Unknown query parameters are rejected with 400 anyway.
- **Outcomes**: no or invalid token → **401**; valid token without `admin:access` → **403**.

## Conventions

| Topic         | Convention                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| Single object | `{ "data": { … } }`                                                                                        |
| Collection    | `{ "data": [ … ], "meta": { "total": n } }`                                                                |
| Paginated     | `{ "data": [ … ], "meta": { "page", "limit", "total", "total_pages" } }`                                   |
| Fields        | `snake_case`, the same names as the database and the current frontend                                      |
| Money         | JSON numbers in euros, exact (via integer cents); `total_price` is **excl. VAT**                           |
| Hidden        | `bookings.cancel_token` is never returned. There are no tokens, passwords or Auth0 claims in any response. |

## Dashboard

|                 |                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| METHOD / PATH   | `GET /api/admin/dashboard`                                                                                   |
| AUTH            | `admin:access`                                                                                               |
| PARAMETERS      | none (unknown parameters → 400)                                                                              |
| RESPONSE        | See the fields below                                                                                         |
| ERRORS          | 400, 401, 403, 500, 503                                                                                      |
| DATABASE TABLES | `services`, `gallery_items`, `vehicle_types` (`COUNT`), `bookings` (`COUNT`/`SUM` `GROUP BY preferred_date`) |

The response is `{ data: { today, week_start, week_end, counts: { active_services, gallery_items, active_vehicle_types }, week: { booking_count, revenue_excl_vat, days: [{ date, booking_count, revenue_excl_vat } ×7] }, today_bookings: [{ id, customer_name, service_title, preferred_time, status }], next_booking: { id, customer_name, service_title, preferred_date, preferred_time, start_at, status } | null } }`.

The meaning is the same as in `src/routes/admin/index.tsx`:

- "This week" is Monday–Sunday around today (Europe/Brussels).
- Only non-cancelled bookings count, grouped by `preferred_date`.
- **Revenue** is the sum of `total_price` (excl. VAT), computed exactly in SQL.
- **Today** lists today's appointments by time.
- **Next** is the first appointment of this week whose `start_at` ≥ now.

## Bookings

|                 | List                                                                                                               | Detail                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| METHOD / PATH   | `GET /api/admin/bookings`                                                                                          | `GET /api/admin/bookings/:id`                                                                         |
| AUTH            | `admin:access`                                                                                                     | `admin:access`                                                                                        |
| PARAMETERS      | `page` (≥ 1, default 1), `limit` (1–100, default 50). Nothing else (the current UI has no search or status filter) | `id`: UUID                                                                                            |
| RESPONSE        | `{ data: AdminBooking[], meta: { page, limit, total, total_pages } }`                                              | `{ data: AdminBooking & { services: [{ id, service_id, service_title, price, duration_minutes }] } }` |
| ORDER           | `preferred_date` desc, `preferred_time` desc, `id` desc (as `admin/reservaties.tsx`)                               | —                                                                                                     |
| ERRORS          | 400, 401, 403, 500, 503                                                                                            | 400 (malformed id), 401, 403, **404 `RESOURCE_NOT_FOUND`**, 500, 503                                  |
| DATABASE TABLES | `bookings` ⟕ `vehicle_types`                                                                                       | `bookings` ⟕ `vehicle_types`, `booking_services`                                                      |

**`AdminBooking` fields**:

- **Identity and status**: `id`, `status`
- **Customer**: `customer_name`, `customer_email`, `customer_phone`, `company_name`, `vat_number`, `notes`
- **Vehicle**:
  - `vehicle_type` (`{ id, slug, title }` or null), `vehicle_brand`, `vehicle_model`
  - `vehicle_info` (legacy)
- **Services, legacy**: `service_id`, `service_title`
- **Scheduling**:
  - `preferred_date`, `preferred_time` (local)
  - `start_at`, `end_at` (ISO)
  - `pickup_date`, `pickup_time`: local end, replacing the old `end_time` text
  - `total_duration_minutes`
- **Pricing**: `total_price` (excl. VAT), `location_fee`
- **Location**: `on_location`, `location_in_sint_niklaas`, `location_address`, `location_distance_km`
- **Timestamps**: `cancelled_at`, `created_at`, `updated_at`

## Agenda

|                 |                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| METHOD / PATH   | `GET /api/admin/agenda?start=YYYY-MM-DD&end=YYYY-MM-DD`                                                                                                                    |
| AUTH            | `admin:access`                                                                                                                                                             |
| PARAMETERS      | `start`, `end`: real calendar dates (local Europe/Brussels), inclusive, `start ≤ end`, at most **62 days**. The frontend week view asks for 7 days and the day view for 1. |
| RESPONSE        | `{ data: { start, end, bookings: AdminBooking[], blocked_periods: AdminBlockedPeriod[] } }`                                                                                |
| ERRORS          | 400, 401, 403, 500, 503                                                                                                                                                    |
| DATABASE TABLES | `bookings` ⟕ `vehicle_types`, `blocked_periods`                                                                                                                            |

**Bookings**:

- All statuses are included; the agenda shows cancelled bookings struck through.
- A booking is included when its `[start_at, end_at)` **overlaps** `[start 00:00, end+1 00:00)` local time, so multi-day bookings also appear on their later days.
- They are ordered by `start_at`.

**Blocked periods**: included when `start_date ≤ end` and `end_date ≥ start`, compared in SQL on `date`. They are ordered by `start_date`.

Vehicle types and bookable services for the create dialog come from `GET /api/admin/vehicle-types` and the existing public `GET /api/vehicle-types/:id/services`; free slots come from `GET /api/availability`. The admin slot check for moving a booking (`exclude_booking_id`) belongs to phase 6B.

## Services

|                 |                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| METHOD / PATH   | `GET /api/admin/services`                                                                                                                                                                              |
| AUTH            | `admin:access`                                                                                                                                                                                         |
| PARAMETERS      | none                                                                                                                                                                                                   |
| RESPONSE        | `{ data: [{ id, title, description, kind, category, badge, icon, image_url, bookable, active, sort_order, price, duration_minutes, included_service_ids, created_at, updated_at }], meta: { total } }` |
| ERRORS          | 400, 401, 403, 500, 503                                                                                                                                                                                |
| DATABASE TABLES | `services`, `package_services`                                                                                                                                                                         |

- The list covers **all** services (inactive too) of every kind (`dienst`, `pakket`, `extra`), ordered by `sort_order`.
- `price` and `duration_minutes` are the **LEGACY** base values.
- **Package contents**: `included_service_ids` lists the ids of the contained services (from `package_services`); it is empty for services that are not packages. There is no separate packages table or endpoint.
- The per-vehicle pricing matrix is under Vehicle Types, where the current UI edits it.

## Vehicle Types

|                 |                                                                                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| METHOD / PATH   | `GET /api/admin/vehicle-types`                                                                                                                                                                                                                  |
| AUTH            | `admin:access`                                                                                                                                                                                                                                  |
| PARAMETERS      | none                                                                                                                                                                                                                                            |
| RESPONSE        | `{ data: [{ id, slug, title, description, image_url, icon, sort_order, active, created_at, updated_at, services: [{ id, service_id, title, kind, service_active, service_bookable, available, price, duration_minutes }] }], meta: { total } }` |
| ERRORS          | 400, 401, 403, 500, 503                                                                                                                                                                                                                         |
| DATABASE TABLES | `vehicle_types`, `vehicle_type_services` ⋈ `services`                                                                                                                                                                                           |

- The list covers all vehicle types, inactive too, ordered by `sort_order`, each with its **complete** pricing matrix.
- `services[].id` is the `vehicle_type_services` id.
- The current UI only shows rows of active and bookable services; the flags `service_active` and `service_bookable` let it keep that filter.
- One endpoint serves both the list and the matrix, so there is no separate pricing endpoint and no duplication.

## Blocked Periods

|                 |                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| METHOD / PATH   | `GET /api/admin/blocked-periods`                                                                                  |
| AUTH            | `admin:access`                                                                                                    |
| PARAMETERS      | none (the current page has no filters; range queries go through the agenda)                                       |
| RESPONSE        | `{ data: [{ id, start_date, end_date, start_time, end_time, reason, created_at, updated_at }], meta: { total } }` |
| ERRORS          | 400, 401, 403, 500, 503                                                                                           |
| DATABASE TABLES | `blocked_periods`                                                                                                 |

Ordered by `start_date` desc. A `start_time` of `null` means 00:00; an `end_time` of `null` means 24:00.

## Settings

|                 |                                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| METHOD / PATH   | `GET /api/admin/settings`                                                                                                                                                    |
| AUTH            | `admin:access`                                                                                                                                                               |
| PARAMETERS      | none                                                                                                                                                                         |
| RESPONSE        | `{ data: { id, opening_hour, closing_hour, slot_interval_minutes, km_fee, free_km, base_address, base_city, notification_email, created_at, updated_at } }`: a single object |
| ERRORS          | 400, 401, 403, **500 `SETTINGS_NOT_CONFIGURED`** (no row), 503                                                                                                               |
| DATABASE TABLES | `site_settings`                                                                                                                                                              |

The schema allows at most one row. When the row is missing, the API does **not** invent defaults. (The public availability endpoint does fall back to `10:00–21:00`/30, as documented in `docs/BOOKING-BUSINESS-LOGIC.md`.)

## Gallery

|                 |                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| METHOD / PATH   | `GET /api/admin/gallery`                                                                                                             |
| AUTH            | `admin:access`                                                                                                                       |
| PARAMETERS      | none                                                                                                                                 |
| RESPONSE        | `{ data: [{ id, title, description, image_url, before_image_url, category, sort_order, created_at, updated_at }], meta: { total } }` |
| ERRORS          | 400, 401, 403, 500, 503                                                                                                              |
| DATABASE TABLES | `gallery_items`                                                                                                                      |

Ordered by `sort_order`. Uploads and storage are outside this phase.

## Reviews

**There is no endpoint.** `src/routes/admin/reviews.tsx` only redirects to `/admin` and reads no data, so the current admin UI has no review management. None is invented here. `GET /api/admin/reviews` answers 404 `NOT_FOUND`.

## Pagination

- **Paginated**: only `GET /api/admin/bookings`, the only table that grows without bound. The current UI loads it completely.
- **Parameters**: `page` (1-based, default 1, max 100 000) and `limit` (default **50**, max **100**). Other values → 400.
- **In SQL**: `LIMIT`/`OFFSET` with a stable order (including `id`), plus a separate `COUNT(*)` for `meta.total`.
- **Beyond the last page**: `data: []` with the correct `meta`, not a 404.
- **Other collections** (services, vehicle types, blocked periods, gallery) are small, admin-maintained tables. They are returned whole with `meta.total`, as the current UI loads them.

## Errors

The shape is always `{ "error": { "code", "message" } }`. There is never SQL, a stack trace or token details.

| Status | Code                         | When                                                          |
| ------ | ---------------------------- | ------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`           | Malformed or unknown parameters, bad UUID, invalid date range |
| 401    | `AUTHENTICATION_REQUIRED`    | No `Authorization` header                                     |
| 401    | `AUTHENTICATION_INVALID`     | Token invalid, expired, wrong issuer, audience or signature   |
| 403    | `AUTHORIZATION_REQUIRED`     | Token without `admin:access`                                  |
| 404    | `RESOURCE_NOT_FOUND`         | Unknown booking id                                            |
| 404    | `NOT_FOUND`                  | Unknown route                                                 |
| 500    | `SETTINGS_NOT_CONFIGURED`    | No `site_settings` row                                        |
| 500    | `INTERNAL_ERROR`             | Unexpected error (details only in the server log)             |
| 503    | `DATABASE_UNAVAILABLE`       | Database unreachable                                          |
| 503    | `AUTHENTICATION_UNAVAILABLE` | Auth0 keys unreachable or Auth0 not configured                |

## Date/time semantics

| Kind                                                                                                               | Format              | Meaning                                       |
| ------------------------------------------------------------------------------------------------------------------ | ------------------- | --------------------------------------------- |
| `start_at`, `end_at`, `created_at`, `updated_at`, `cancelled_at`                                                   | ISO 8601 UTC (`…Z`) | Absolute instants                             |
| `preferred_date`, `pickup_date`, `start_date`, `end_date`, `today`, `week_start`, `week_end`, agenda `start`/`end` | `YYYY-MM-DD`        | **Business dates** in Europe/Brussels         |
| `preferred_time`, `pickup_time`, `start_time`, `end_time`, `opening_hour`, `closing_hour`                          | `HH:mm`             | **Local wall-clock times** in Europe/Brussels |

- **Today, this week and next**: derived from the server clock in Europe/Brussels, never in the browser's time zone.
- **Agenda range**: a local-date range converted to absolute instants with the correct CET/CEST offset. Midnight always exists in Brussels.
- `pickup_date`/`pickup_time` are `end_at` expressed in local time.

## Performance notes

- **Filtering, sorting, aggregation and pagination** all run in PostgreSQL; there is no full-table fetch followed by JavaScript filtering. The only JavaScript grouping left is attaching already-fetched child rows (package contents, matrix rows) to their parents.
- **Indexes from phase 2**:
  - `bookings_preferred_date_idx`: dashboard week and today.
  - GiST index of `bookings_no_overlap_excl` (range `&&`): the agenda, only for non-cancelled bookings; the agenda also shows cancelled ones, so it can still use a scan.
  - `blocked_periods_dates_idx`.
  - UNIQUE `(vehicle_type_id, service_id)`.
  - `booking_services_booking_id_idx`: detail lines.
- **Query plans** were not measured: the PGlite test data is too small to be meaningful. Measure them on real data after the migration.
