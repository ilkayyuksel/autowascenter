# Admin Frontend Migration

Phase 6D-1: the **read side** of every admin page now comes from the self-hosted API. Writes still use Supabase until phase 6D-2 (and 6D-3 for gallery uploads). The public frontend is unchanged and still uses Supabase.

## Migration matrix

| PAGE                                    | READ SOURCE                                                  | WRITE SOURCE                                             | STATUS                                     |
| --------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------ |
| Dashboard (`admin/index.tsx`)           | API `GET /api/admin/dashboard`                               | N/A (no writes)                                          | **MIGRATED**                               |
| Agenda (`admin/agenda.tsx`)             | API `GET /api/admin/agenda`, `GET /api/admin/vehicle-types`  | SUPABASE (create, move, cancel, delete + slot pre-check) | **PARTIAL MIGRATION — READ SIDE COMPLETE** |
| Reservations (`admin/reservaties.tsx`)  | API `GET /api/admin/bookings`, `GET /api/admin/bookings/:id` | SUPABASE (status, delete, create)                        | **PARTIAL MIGRATION — READ SIDE COMPLETE** |
| Services (`admin/diensten.tsx`)         | API `GET /api/admin/services`                                | SUPABASE                                                 | **PARTIAL MIGRATION — READ SIDE COMPLETE** |
| Vehicles (`admin/voertuigen.tsx`)       | API `GET /api/admin/vehicle-types`                           | SUPABASE                                                 | **PARTIAL MIGRATION — READ SIDE COMPLETE** |
| Blocked periods (`admin/blokkades.tsx`) | API `GET /api/admin/blocked-periods`                         | SUPABASE                                                 | **PARTIAL MIGRATION — READ SIDE COMPLETE** |
| Settings (`admin/instellingen.tsx`)     | API `GET /api/admin/settings`                                | SUPABASE                                                 | **PARTIAL MIGRATION — READ SIDE COMPLETE** |
| Gallery (`admin/galerij.tsx`)           | API `GET /api/admin/gallery`                                 | SUPABASE (upload, save, delete; storage too)             | **PARTIAL MIGRATION — READ SIDE COMPLETE** |
| Reviews (`admin/reviews.tsx`)           | none (redirects to `/admin`)                                 | N/A                                                      | UNCHANGED                                  |

No migrated page reads the same data from Supabase any more: there is no fallback and no double read.

**Known intermediate state**: since phase 5 the admin has no Supabase session, so Supabase RLS rejects the admin **writes** that are still on Supabase. The pages now show the real data, but saving fails until phase 6D-2. This branch must not be deployed in this state.

## Read mapping

CURRENT SUPABASE READ → NEW API ENDPOINT → RESPONSE MAPPING (`src/lib/api/admin-reads.ts`) → UI COMPONENT

| Current Supabase read                                                         | New API endpoint                         | Response mapping                                                                                                    | UI component          |
| ----------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 3 counts + week bookings, aggregated in the browser                           | `GET /api/admin/dashboard`               | `loadDashboard`: response used as is (`counts`, `week.days`, `today_bookings`, `next_booking`, `week_start/end`)    | `AdminHome`           |
| `bookings` in range (all statuses) + `blocked_periods` overlapping            | `GET /api/admin/agenda?start=&end=`      | `loadAgenda` → `AgendaBooking` (`same_day_end_time`/`ends_later` from `pickup_date`/`pickup_time`), `AgendaBlocked` | `AgendaPage`          |
| `vehicle_types` (active) + `vehicle_type_services ⋈ services` per type        | `GET /api/admin/vehicle-types` (once)    | `loadAgendaVehicleOptions`: active types; per type rows `available && service_active && service_bookable`, by title | `CreateBookingDialog` |
| `bookings *` (all rows, date/time desc)                                       | `GET /api/admin/bookings?page=&limit=50` | `loadBookingsPage` → `BookingRow` (`pickup_label` replaces `end_time`) + `meta`                                     | `BookingsAdmin`       |
| Detail dialog filled from the list row                                        | `GET /api/admin/bookings/:id`            | `loadBookingDetail` → `BookingRow` + `lines` (booking_services snapshots)                                           | `BookingDetailDialog` |
| `services *` + `package_services`                                             | `GET /api/admin/services`                | `loadServices` → `ServiceItem[]` + `contents` from `included_service_ids`                                           | `ServicesAdmin`       |
| `vehicle_types *` + `services` (active, bookable) + `vehicle_type_services *` | `GET /api/admin/vehicle-types` (once)    | `loadVehiclesPage` → `vehicles`, `vts` (flattened matrix), `services` (active + bookable, from the matrix)          | `AdminVehiclesPage`   |
| `blocked_periods *` order `start_date` desc                                   | `GET /api/admin/blocked-periods`         | `loadBlockedPeriods` (API order = newest first)                                                                     | `AdminBlockedPage`    |
| `site_settings *` `.limit(1).single()`                                        | `GET /api/admin/settings`                | `loadSettings` → `SettingsForm` (one object; no client defaults)                                                    | `AdminSettingsPage`   |
| `gallery_items *` order `sort_order`                                          | `GET /api/admin/gallery`                 | `loadGallery` → `GalleryItem` incl. `before_image_url`, `category`                                                  | `GalleryAdmin`        |

The backend contracts stay authoritative. The admin read schemas moved from `apps/api/src/contracts/admin.ts` to **`packages/shared/src/admin.ts`** (`@autowascenter/shared/admin`), so the backend and the frontend validate with the **same** Zod schemas; `apps/api/src/contracts/admin.ts` re-exports them.

## API client

`src/lib/api/client.ts` — the single place where the frontend calls the API.

- `createApiClient({ baseUrl, getAccessToken, fetchImpl?, timeoutMs? })`; the base URL is `VITE_API_BASE_URL` (via the existing `readApiBaseUrl`, default `http://localhost:3001`).
- `api.get(path, schema, { query, signal })`: **public** request, never asks for or sends a token.
- `api.getAdmin(path, schema, { query, signal })`: **admin** request, adds `Authorization: Bearer <access token>`.
- JSON only; the query string is built centrally (`buildUrl`).
- Every response is validated at runtime with the shared Zod contract (`safeParse`); a mismatch is an error, never `as any`.
- Timeout: 15 s per request (`AbortController`), plus support for a caller's `AbortSignal`.
- Nothing is logged by the client (no URLs, headers, tokens or bodies).
- Writes are not part of the client yet (phase 6D-2 adds them to the same client).

React wiring:

- `AdminApiProvider` (`src/components/admin/AdminApiProvider.tsx`) creates the client once and provides it through `useAdminApi()` (`admin-api-context.ts`). It is rendered by the existing `/admin` guard **only in the authorized state**.
- `useAdminLoad()` (`src/hooks/useAdminLoad.ts`) wraps `createLoadRunner` (`src/lib/api/load-runner.ts`): `run(load, apply)` sets loading → success/error, applies only the latest result, aborts the previous request and ignores results after unmount. The pages keep their `useState`/`useEffect` structure and refresh behaviour (`load()` after their own writes). No React Query.
- `AdminLoadError` shows the error state with fixed Dutch texts and a retry button where useful.

## Auth0 token handling

- The existing `Auth0Provider` (phase 5, `AdminAuthProvider`) is reused; no second provider.
- `AdminApiProvider` passes `() => getAccessTokenSilently({ timeoutInSeconds: 10 })` to the client: an **access token** for `VITE_AUTH0_AUDIENCE`, never the ID token.
- The client does not store, cache or refresh tokens; the SDK holds them in memory (`cacheLocation="memory"`, refresh-token rotation), exactly as in phase 5. No localStorage auth.
- Token failures: Auth0 "login required" errors (`login_required`, `missing_refresh_token`, …) and a missing token → `401 AUTHENTICATION_REQUIRED`; other token failures → `TOKEN_UNAVAILABLE` (temporary). No API request is made without a token.

## Dashboard

`GET /api/admin/dashboard`. Counters, week bookings, week revenue (excl. VAT, as before), revenue per day, today's bookings and the next appointment come from the API (computed in Europe/Brussels). The week shown in the header and the "today" highlight use the API's `week_start`/`week_end`/`today`. While loading, the layout shows zeros as before; on failure an error panel with retry.

## Agenda

`GET /api/admin/agenda?start=&end=` with the visible week or day (inclusive local dates). The response has all bookings (every status, cancelled shown struck through as before) and the overlapping blocked periods.

- Presentation logic is unchanged (columns per day, bookings on their start day, blocked periods per day).
- The block end uses `pickup_date`/`pickup_time` instead of the legacy `end_time`: same day → ends at the pickup time; multi-day work → fills the rest of the day and is labelled `–+HH:mm`.
- The "new appointment" form loads its vehicle types and per-type services from **one** `GET /api/admin/vehicle-types` call (no request per type).
- **Not moved** (write flow, phase 6D-2): the free-slot list and the pre-save conflict check in the create/edit dialogs still use `fetchSlotData` + `computeAvailableSlots` (`src/lib/slots.ts`, which the public booking page also uses). They are part of the booking write flow and will be replaced by `GET /api/admin/availability` together with the writes. No booking logic was moved in this phase.

## Reservations

- List: `GET /api/admin/bookings?page=&limit=50`, server-side pagination; the API is authoritative for `page`, `limit`, `total`, `total_pages`. Minimal controls (Vorige / Volgende, "Pagina x van y · n reservaties") appear when there is more than one page. Order unchanged (date and time descending).
- Detail (eye icon): `GET /api/admin/bookings/:id`, its own loading/error state, no Supabase fallback and no reuse of list data. The service shows the booking's service lines (snapshots) or the legacy `service_title`.
- "→ end" shows the pickup moment (`pickup_label`) instead of the legacy `end_time`.
- Status change, delete and create are unchanged (Supabase).

## Services

`GET /api/admin/services`: services, packages and extras with `active`, `bookable`, `kind`, `category`, `badge`, `icon`, `sort_order`; package contents from `included_service_ids` (replaces the `package_services` read). Writes unchanged. (`price`/`duration_minutes` are legacy per-service fields the page never showed; prices live in the vehicle matrix.)

## Vehicles

`GET /api/admin/vehicle-types`, one request: vehicle types (`slug`, `active`, `sort_order`, …) and the complete pricing matrix (`price`, `duration_minutes`, `available`, `service_active`, `service_bookable`). The page keeps its filter (only rows of active, bookable services), now derived from the matrix. Note for 6D-2: "Nieuw voertuigtype" creates rows for that derived service list; the API create endpoint already does this server-side.

## Blocked periods

`GET /api/admin/blocked-periods`: list with dates, optional times and reason, newest start date first (as before). Writes unchanged.

## Settings

`GET /api/admin/settings` returns **one object** (no array/`.single()` handling needed). No client-side defaults. `500 SETTINGS_NOT_CONFIGURED` shows "Instellingen ontbreken" (configuration error, no retry). Save unchanged.

## Gallery

`GET /api/admin/gallery`: `image_url`, `before_image_url`, `title`, `description`, `category`, `sort_order`, ordered by `sort_order`. Upload, save and delete stay on Supabase (phase 6D-3 moves them to `POST /api/admin/gallery/upload` etc.). No new upload flow was built.

## Remaining Supabase usage

| Page            | READ     | WRITE                                                                                                                                |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Dashboard       | API      | N/A                                                                                                                                  |
| Agenda          | API      | SUPABASE: `bookings` insert/update/delete, `booking_services` insert, slot pre-check via `fetchSlotData`                             |
| Reservations    | API      | SUPABASE: `bookings` update (status), delete, insert                                                                                 |
| Services        | API      | SUPABASE: `services` insert/update/delete, `package_services`, `vehicle_type_services` insert (+ `vehicle_types` ids for those rows) |
| Vehicles        | API      | SUPABASE: `vehicle_types` insert/update/delete, `vehicle_type_services` insert/update                                                |
| Blocked periods | API      | SUPABASE: `blocked_periods` insert/delete                                                                                            |
| Settings        | API      | SUPABASE: `site_settings` update                                                                                                     |
| Gallery         | API      | SUPABASE: Storage upload/remove, `gallery_items` insert/update/delete                                                                |
| Public pages    | SUPABASE | SUPABASE (`reservatie`, `contact`): unchanged                                                                                        |

`@supabase/supabase-js`, `src/integrations/supabase/` and `supabase/` are kept.

## Error handling

Every failure becomes an `ApiError { status, code, message }`; the UI shows only fixed texts (`describeApiError`, `src/lib/api/errors.ts`):

| Situation                            | UI                                                                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401 (API) or session expired (token) | The existing guard re-checks `/api/admin/me` and shows "Opnieuw inloggen". At most once per 30 s (no loops); the page also shows "Sessie verlopen" with a login button. |
| 403                                  | "Geen toegang"                                                                                                                                                          |
| 503, network error, timeout          | "Server tijdelijk niet bereikbaar" + retry                                                                                                                              |
| 500 `SETTINGS_NOT_CONFIGURED`        | "Instellingen ontbreken" (configuration error)                                                                                                                          |
| 404 (booking detail)                 | "Niet gevonden"                                                                                                                                                         |
| Malformed / contract mismatch        | "Onverwacht antwoord" + retry                                                                                                                                           |
| Other 500 / unknown                  | "Er ging iets mis" + retry                                                                                                                                              |

No page can keep loading forever: every request has a timeout, and every load settles in success or error. Backend messages, SQL or stack traces are never shown.

## Date/time handling

- The API's local fields are already Europe/Brussels: `preferred_date`, `preferred_time`, `pickup_date`, `pickup_time`, dashboard `today`/`week_start`/`week_end`. They are displayed as is (formatted with date-fns `nl`), parsed with `parseISO` (local midnight), never with `new Date("yyyy-MM-dd")` (UTC).
- `start_at`/`end_at` (UTC instants) are not needed for display: their Brussels-local projection is `preferred_*`/`pickup_*`.
- The legacy `end_time` is no longer used anywhere in the admin read side.
- The agenda requests the visible range as local dates (the admin works in Belgium; the browser's calendar day is used for navigation, as before).

## Tests

Root `npm test` (`node --test "src/**/*.test.ts"`), no DOM, no real Auth0 or API:

- `src/lib/api/client.test.ts`: base URL, query building, public call without token, admin call with Bearer, 400/401/403/404/409/500/503 mapping, non-standard error bodies, malformed JSON, contract mismatch, timeout, network error, abort, token failures (no request made), token never in error messages, and **no console output at all**.
- `src/lib/api/errors.test.ts`: UI error mapping and the 401 re-check throttle.
- `src/lib/api/load-runner.test.ts`: loading → success/error, empty data, 401 notifies the guard, stale results ignored, abort ignored, unmount, timeout never leaves "loading".
- `src/lib/api/admin-reads.test.ts`: per page (dashboard, agenda + form options, reservations + detail, services, vehicles, blocked periods, settings, gallery): endpoint and Bearer header, mapping, empty data, 401/403/500/503, malformed responses.

The React components themselves are not rendered in tests: the repository has no DOM test environment, and adding one (jsdom, Testing Library) was out of scope. All page logic that decides what is shown (data mapping, state transitions, error texts) is in the tested modules; the components only render it. Use the manual checklist below for the rendering.

## Manual test checklist

Prerequisites: API running (`apps/api`, `npm run dev`) against a database with data, `VITE_API_BASE_URL` and `VITE_AUTH0_*` set, Auth0 user with `admin:access`. In the browser's network tab, filter on the API host.

1. **Admin login**: open `/admin` → Auth0 login → back on `/admin`; one `GET /api/admin/me` (200).
2. **Dashboard**: counters, week revenue, per-day bars, today's list and next appointment match the database; one `GET /api/admin/dashboard` with `Authorization: Bearer …`; no `supabase.co` request.
3. **Agenda**: week and day view, navigation (each step one `GET /api/admin/agenda?start=&end=`), cancelled bookings struck through, blocked periods hatched, multi-day work labelled `–+HH:mm`. "Nieuwe afspraak": vehicle types and services filled from one `GET /api/admin/vehicle-types`.
4. **Reservations**: list from `GET /api/admin/bookings?page=1&limit=50`; with more than 50 bookings the page buttons load the next page.
5. **Booking detail**: eye icon → `GET /api/admin/bookings/:id`; services listed; closing and reopening fetches again.
6. **Services**: packages/services/extras grouped; package checkboxes reflect the stored contents.
7. **Vehicles**: types listed; "Prijzen / diensten" shows the matrix rows of active, bookable services with prices and durations.
8. **Blocked periods**: list newest first, times and reason shown.
9. **Gallery**: images (Supabase URLs for old items) and titles from `GET /api/admin/gallery`.
10. **Settings**: form filled from `GET /api/admin/settings`.
11. **Logout**: "Uitloggen" → back on the public site; `/admin` asks for login again.

Error checks: stop the API → pages show "Server tijdelijk niet bereikbaar" with retry (no endless "Laden..."); log in with a user without `admin:access` → "Geen toegang". Known: saving (writes) fails until phase 6D-2.
