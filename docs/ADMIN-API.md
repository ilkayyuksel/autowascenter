# Admin API

Admin API on the self-hosted PostgreSQL: the read side (phase 6A) and the write side (phase 6B, see [Writes](#writes)).

- The admin frontend is **not connected** yet and still uses Supabase.
- File uploads and storage come in phase 6C.
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

| Status | Code                            | When                                                                                      |
| ------ | ------------------------------- | ----------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`              | Malformed or unknown parameters or body fields, bad UUID, invalid range or business value |
| 401    | `AUTHENTICATION_REQUIRED`       | No `Authorization` header                                                                 |
| 401    | `AUTHENTICATION_INVALID`        | Token invalid, expired, wrong issuer, audience or signature                               |
| 403    | `AUTHORIZATION_REQUIRED`        | Token without `admin:access`                                                              |
| 404    | `RESOURCE_NOT_FOUND`            | Unknown booking, service, vehicle type, blocked period or gallery item                    |
| 404    | `VEHICLE_TYPE_NOT_FOUND`        | Booking writes: unknown or inactive vehicle type                                          |
| 404    | `SERVICE_NOT_FOUND`             | Booking writes: a service is not bookable for the vehicle type                            |
| 404    | `NOT_FOUND`                     | Unknown route                                                                             |
| 409    | `BOOKING_SLOT_UNAVAILABLE`      | Overlap with another booking or a blocked period (exclusion constraint included)          |
| 409    | `RESOURCE_CONFLICT`             | Unique value already taken (vehicle type slug)                                            |
| 409    | `RESOURCE_IN_USE`               | Vehicle type still referenced by bookings (`ON DELETE RESTRICT`)                          |
| 422    | `BOOKING_OUTSIDE_OPENING_HOURS` | Start before opening, work not fitting the window, or off the slot grid                   |
| 422    | `BOOKING_IN_PAST`               | New date/time before "now" (Europe/Brussels)                                              |
| 500    | `SETTINGS_NOT_CONFIGURED`       | No `site_settings` row                                                                    |
| 500    | `INTERNAL_ERROR`                | Unexpected error, including a failed transaction (details only in the server log)         |
| 503    | `DATABASE_UNAVAILABLE`          | Database unreachable                                                                      |
| 503    | `AUTHENTICATION_UNAVAILABLE`    | Auth0 keys unreachable or Auth0 not configured                                            |

Constraint violations that a service did not translate itself are mapped centrally, with a generic message and no SQL:

- `23P01` → 409 `BOOKING_SLOT_UNAVAILABLE`
- `23505` and `23503` → 409 `RESOURCE_CONFLICT`
- `23001` → 409 `RESOURCE_IN_USE`
- `23514` and `23502` → 400 `VALIDATION_ERROR`

## Writes

All writes (phase 6B) share these rules:

- **Authorization**: the same parent-plugin hooks, Auth0 `admin:access`.
- **Validation**: a **strict** Zod body or query; unknown fields → 400.
- **Queries**: parameterized Drizzle only.
- **Responses**:
  - create: **201** `{ data }`, in the same resource shape as the read endpoints;
  - update: **200** `{ data }`;
  - delete: **204** with no body.
- **Transactions**: every multi-table mutation is **one transaction** (`db.transaction(...)`, visible in the service function). Any error rolls everything back. See the atomicity matrix in `docs/ADMIN-WRITE-MIGRATION-MAP.md`.
- **Never trusted from the client**: price, total, duration, location fee, cancel token, `start_at`/`end_at`. Booking amounts come from the **same pricing engine** as `POST /api/bookings`.

### Bookings

| METHOD / PATH                                                                         | BODY / PARAMS                                                                                                                                                                                                                                                       | RESPONSE                                                                      | ERRORS             | TABLES                                         | TRANSACTION                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------ | ---------------------------------------------- | ----------------------------- |
| `POST /api/admin/bookings`                                                            | `vehicle_type_id`, `service_ids` (1–50, unique), `preferred_date`, `preferred_time` (`HH:mm`), `customer_name`, `customer_email`, `customer_phone`, optional `vehicle_brand`, `vehicle_model`, `notes`, and `status` (`nieuw`, `bevestigd` (default) or `voltooid`) | 201 `{ data: AdminBookingDetail & { pricing } }`                              | 400, 404, 409, 422 | `bookings`, `booking_services`                 | Yes                           |
| `PATCH /api/admin/bookings/:id`                                                       | At least one of `preferred_date`, `preferred_time`, `status` (all 4), `notes`, `vehicle_type_id`, `service_ids`                                                                                                                                                     | 200 `{ data: AdminBookingDetail & { pricing } }`                              | 400, 404, 409, 422 | `bookings`, `booking_services`                 | Yes (row locked `FOR UPDATE`) |
| `DELETE /api/admin/bookings/:id`                                                      | —                                                                                                                                                                                                                                                                   | 204                                                                           | 400, 404           | `bookings` (+ CASCADE lines)                   | One statement                 |
| `GET /api/admin/availability?date=&exclude_booking_id=&vehicle_type_id=&service_ids=` | `date` plus either `vehicle_type_id` + `service_ids`, or `exclude_booking_id` (then that booking's duration is used)                                                                                                                                                | 200 `{ data: { date, total_duration_minutes, exclude_booking_id, slots[] } }` | 400, 404           | `bookings`, `blocked_periods`, `site_settings` | — (read)                      |

**Booking create** follows the same steps as the public flow: resolve and price the services for the vehicle type, then check opening hours, slot grid, "not in the past", blocked periods and overlap, then insert the booking and its `booking_services` snapshots. Differences from the public flow:

- The admin chooses the status.
- An extra on its own is allowed, because the agenda dialog lists all kinds.
- There are no on-location fields; the location fee stays 0.

**Booking update**:

- **`service_ids` / `vehicle_type_id`**: re-priced and re-timed from the database. `booking_services` is replaced, and `total_price`, `total_duration_minutes`, `service_id` and `service_title` (legacy) are recomputed.
- **Date and time only**: the stored price and duration are **kept**, so a move does not re-price the booking. The new slot is checked for opening hours, grid, past and overlap.
- **Duration and `service_title`** can no longer be set freely (**CHANGED** versus the old UI).
- **`exclude_booking_id`**: every overlap check during an update **excludes the booking itself**, so moving 10:00–12:00 to 11:00–13:00 works, while all other bookings and blocked periods still count. The PostgreSQL exclusion constraint stays the final guard. A client with a stale availability result can never force an occupied slot.
- **Status**:
  - all four values are allowed, as in the UI;
  - `→ geannuleerd` sets `cancelled_at` (frees the slot);
  - leaving `geannuleerd` clears it and **re-checks overlap** (409 if the slot was taken meanwhile).

### Services and package contents

| METHOD / PATH                                 | BODY                                                                                                                                                                   | RESPONSE                     | ERRORS   | TABLES                              | TRANSACTION   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------- | ----------------------------------- | ------------- |
| `POST /api/admin/services`                    | `kind` (required); optional `title`, `description`, `icon`, `category`, `badge`, `image_url`, `bookable`, `active`, `sort_order`, `price`, `duration_minutes` (legacy) | 201 `{ data: AdminService }` | 400      | `services`, `vehicle_type_services` | Yes           |
| `PATCH /api/admin/services/:id`               | At least one of the fields above                                                                                                                                       | 200 `{ data: AdminService }` | 400, 404 | `services`                          | One statement |
| `PUT /api/admin/services/:id/package-content` | `{ service_ids: uuid[] }` (0–100, unique): the **complete** contents                                                                                                   | 200 `{ data: AdminService }` | 400, 404 | `package_services`                  | Yes           |
| `DELETE /api/admin/services/:id`              | —                                                                                                                                                                      | 204                          | 400, 404 | `services` (+ FK actions)           | One statement |

- **Create defaults** (from `diensten.tsx`):
  - title `Nieuw pakket`, `Nieuwe dienst` or `Nieuwe extra dienst`;
  - icon `sparkles`, `sort_order` = number of services;
  - plus a pricing row (price **0**, duration **60**, available) for **every** vehicle type.
- **Package contents**: the target must be `kind = 'pakket'`. The ids must exist, must not include the package itself, and must not be packages; otherwise 400 and nothing changes. The old rows are deleted and the new ones inserted in one transaction.
- **Delete**: pricing rows and package rows cascade. `booking_services.service_id` and `bookings.service_id` become NULL, so booking snapshots are kept.

### Vehicle types and pricing matrix

| METHOD / PATH                              | BODY                                                                                                                      | RESPONSE                         | ERRORS                              | TABLES                                   | TRANSACTION   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------- | ---------------------------------------- | ------------- |
| `POST /api/admin/vehicle-types`            | Optional `slug` (`a-z0-9-`), `title`, `description`, `image_url`, `active`, `sort_order`                                  | 201 `{ data: AdminVehicleType }` | 400, 409                            | `vehicle_types`, `vehicle_type_services` | Yes           |
| `PATCH /api/admin/vehicle-types/:id`       | At least one of the fields above                                                                                          | 200 `{ data: AdminVehicleType }` | 400, 404, 409                       | `vehicle_types`                          | One statement |
| `DELETE /api/admin/vehicle-types/:id`      | —                                                                                                                         | 204                              | 400, 404, **409 `RESOURCE_IN_USE`** | `vehicle_types` (+ CASCADE rows)         | One statement |
| `PUT /api/admin/vehicle-types/:id/pricing` | `{ rows: [{ service_id, available, price (≥ 0, 2 decimals), duration_minutes (1–10080) }] }` (1–500, unique `service_id`) | 200 `{ data: AdminVehicleType }` | 400, 404                            | `vehicle_type_services`                  | **Yes**       |

- **Create defaults** (from `voertuigen.tsx`):
  - slug `nieuw-<timestamp>`, title `Nieuw voertuigtype`, `sort_order` = number of types × 10;
  - plus a row (price **30**, duration **60**, available) for every **active, bookable** service.
- A duplicate slug → 409 `RESOURCE_CONFLICT`.
- **Pricing matrix**: every row is upserted per (vehicle type, service) inside one transaction, with the vehicle type locked. Any invalid or failing row → **no** row is saved. Rows not in the request are left unchanged. Inactive or non-bookable services are allowed, because the UI also saves those hidden rows.

### Blocked periods, settings, gallery

| METHOD / PATH                           | BODY                                                                                                                                                                   | RESPONSE                           | ERRORS   | TABLES            | TRANSACTION             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------- | ----------------- | ----------------------- |
| `POST /api/admin/blocked-periods`       | `start_date`, `end_date` (`start ≤ end`), optional `start_time`, `end_time` (`HH:mm`, `start < end` when both are set), `reason`                                       | 201 `{ data: AdminBlockedPeriod }` | 400      | `blocked_periods` | One statement           |
| `DELETE /api/admin/blocked-periods/:id` | —                                                                                                                                                                      | 204                                | 400, 404 | `blocked_periods` | One statement           |
| `PATCH /api/admin/settings`             | At least one of `km_fee`, `free_km`, `base_address`, `base_city`, `opening_hour`, `closing_hour`, `slot_interval_minutes` (1–1440), `notification_email` (`""` → null) | 200 `{ data: settings }`           | 400, 500 | `site_settings`   | Yes (row lock + update) |
| `POST /api/admin/gallery`               | `image_url` (absolute path or http(s) URL), optional `title`, `description`, `sort_order` (default: number of items)                                                   | 201 `{ data: AdminGalleryItem }`   | 400      | `gallery_items`   | One statement           |
| `PATCH /api/admin/gallery/:id`          | At least one of `title`, `description`, `sort_order` (the fields the UI edits)                                                                                         | 200 `{ data: AdminGalleryItem }`   | 400, 404 | `gallery_items`   | One statement           |
| `DELETE /api/admin/gallery/:id`         | —                                                                                                                                                                      | 204                                | 400, 404 | `gallery_items`   | One statement           |

- **Blocked periods**: there is no PATCH, because the current UI cannot edit them.
- **Settings**: the merged result must keep `opening_hour < closing_hour`. The single row is updated in place.
- **Gallery**: metadata only. **No upload, and no deletion of stored files** (phase 6C).

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
