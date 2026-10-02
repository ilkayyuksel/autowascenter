# Admin Frontend Migration

The admin frontend is fully API-based:

```
ADMIN  → Auth0 (login, access token) → own REST API → PostgreSQL / local file storage
PUBLIC → Supabase (unchanged, migrated in a later phase)
```

- Phase 6D-1 moved every admin **read** to the API.
- Phase 6D-2 moved every admin **write**, including gallery uploads and deletes, to the API.

No admin page, admin component, hook or library module used by the admin calls Supabase any more.

## Migration matrix

| PAGE                                    | READ | WRITE | STORAGE     | STATUS        |
| --------------------------------------- | ---- | ----- | ----------- | ------------- |
| Dashboard (`admin/index.tsx`)           | API  | N/A   | N/A         | COMPLETE      |
| Agenda (`admin/agenda.tsx`)             | API  | API   | N/A         | COMPLETE      |
| Reservations (`admin/reservaties.tsx`)  | API  | API   | N/A         | COMPLETE      |
| Services (`admin/diensten.tsx`)         | API  | API   | N/A         | COMPLETE      |
| Vehicles (`admin/voertuigen.tsx`)       | API  | API   | N/A         | COMPLETE      |
| Blocked periods (`admin/blokkades.tsx`) | API  | API   | N/A         | COMPLETE      |
| Settings (`admin/instellingen.tsx`)     | API  | API   | N/A         | COMPLETE      |
| Gallery (`admin/galerij.tsx`)           | API  | API   | API storage | COMPLETE      |
| Reviews (`admin/reviews.tsx`)           | —    | —     | —           | redirect only |

## Write mapping

| PAGE            | CURRENT WRITE (before 6D-2)                                                                                                                          | NEW API                                                                                                         | STATUS    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------- |
| Agenda          | `bookings` insert (+ client `end_time`, free price/duration) + `booking_services` insert; slot pre-check via `fetchSlotData`/`computeAvailableSlots` | `POST /api/admin/bookings`; slots from `GET /api/admin/availability`                                            | MIGRATED  |
| Agenda          | `bookings` update (date, time, free duration, `end_time`, free `service_title`, status, notes)                                                       | `PATCH /api/admin/bookings/:id` (changed fields only; services/vehicle re-priced by the server)                 | MIGRATED  |
| Agenda          | `bookings` update `status='geannuleerd'`, client `cancelled_at`                                                                                      | `PATCH /api/admin/bookings/:id` `{ status: "geannuleerd" }` (server sets `cancelled_at`)                        | MIGRATED  |
| Agenda          | `bookings` delete                                                                                                                                    | `DELETE /api/admin/bookings/:id`                                                                                | MIGRATED  |
| Reservations    | `bookings` insert with free service text, price, duration and placeholder e-mail `geen@autowascenter.be`                                             | `POST /api/admin/bookings` (same dialog as the agenda: vehicle type + services + server slot; e-mail required)  | MIGRATED  |
| Reservations    | `bookings` update `status`                                                                                                                           | `PATCH /api/admin/bookings/:id` `{ status }`                                                                    | MIGRATED  |
| Reservations    | `bookings` delete                                                                                                                                    | `DELETE /api/admin/bookings/:id`                                                                                | MIGRATED  |
| Services        | `services` insert + `vehicle_types` select + `vehicle_type_services` insert                                                                          | `POST /api/admin/services` `{ kind }` (server: defaults + pricing rows, one transaction)                        | MIGRATED  |
| Services        | `services` update                                                                                                                                    | `PATCH /api/admin/services/:id`                                                                                 | MIGRATED  |
| Services        | `package_services` delete + insert                                                                                                                   | `PUT /api/admin/services/:id/package-content` `{ service_ids }` (complete list, one transaction)                | MIGRATED  |
| Services        | `services` delete                                                                                                                                    | `DELETE /api/admin/services/:id`                                                                                | MIGRATED  |
| Vehicles        | `vehicle_types` insert + `vehicle_type_services` insert                                                                                              | `POST /api/admin/vehicle-types` `{}` (server: slug/title/order defaults + pricing rows, one transaction)        | MIGRATED  |
| Vehicles        | `vehicle_types` update                                                                                                                               | `PATCH /api/admin/vehicle-types/:id`                                                                            | MIGRATED  |
| Vehicles        | `vehicle_types` delete                                                                                                                               | `DELETE /api/admin/vehicle-types/:id` (409 `RESOURCE_IN_USE` → clear message)                                   | MIGRATED  |
| Vehicles        | N × `vehicle_type_services` update (partial failures possible)                                                                                       | `PUT /api/admin/vehicle-types/:id/pricing` `{ rows }` (all-or-nothing)                                          | MIGRATED  |
| Blocked periods | `blocked_periods` insert                                                                                                                             | `POST /api/admin/blocked-periods`                                                                               | MIGRATED  |
| Blocked periods | `blocked_periods` delete                                                                                                                             | `DELETE /api/admin/blocked-periods/:id`                                                                         | MIGRATED  |
| Settings        | `site_settings` update of all fields                                                                                                                 | `PATCH /api/admin/settings` with the changed fields only                                                        | MIGRATED  |
| Gallery         | `supabase.storage.upload` + `getPublicUrl` + `gallery_items` insert                                                                                  | `POST /api/admin/gallery/upload` (multipart)                                                                    | MIGRATED  |
| Gallery         | `gallery_items` update                                                                                                                               | `PATCH /api/admin/gallery/:id`                                                                                  | MIGRATED  |
| Gallery         | `supabase.storage.remove(last URL segment)` + `gallery_items` delete                                                                                 | `DELETE /api/admin/gallery/:id` (server decides about the file)                                                 | MIGRATED  |
| Gallery         | — (no UI)                                                                                                                                            | `POST /api/admin/gallery` available as `createGalleryItem()` (metadata for an existing URL); not used by the UI | AVAILABLE |

## API client

`src/lib/api/client.ts` remains the only place that calls `fetch` for the API (no second client):

- **Public**: `get()` sends no token.
- **Admin**: `getAdmin()`, `postAdmin()`, `patchAdmin()`, `putAdmin()`, `deleteAdmin()` (204 without body) and `postAdminForm()` (multipart `FormData`; the browser sets the boundary).
  - Each admin call gets an Auth0 access token and sends `Authorization: Bearer …`.
  - Timeout 15 s (uploads 120 s).
  - Errors become a typed `ApiError`; responses are validated with the shared Zod contracts.

**Typed write layer**: `src/lib/api/admin-writes.ts`, the counterpart of `admin-reads.ts`.

- One function per mutation: `createAdminBooking`, `updateAdminBooking`, `deleteAdminBooking`, `loadAdminAvailability`, `createAdminService`, `updateAdminService`, `updatePackageContent`, `deleteAdminService`, `createAdminVehicleType`, `updateAdminVehicleType`, `deleteAdminVehicleType`, `updateAdminPricing`, `createBlockedPeriod`, `deleteBlockedPeriod`, `updateSettings`, `createGalleryItem`, `updateGalleryItem`, `deleteGalleryItem`, `uploadGalleryImage`.
- Every request body is validated **before sending** with the backend's own contract.
- The write contracts moved from `apps/api/src/contracts/admin-write.ts` to `packages/shared/src/admin-write.ts` (subpath `@autowascenter/shared/admin-write`); the backend re-exports them. The root workspace strategy is unchanged (no workspaces; the frontend imports the file directly, like the read contracts).
- The contracts are strict, so a request with `total_price`, `total_duration_minutes`, `location_fee`, `start_at`, `end_at`, `cancel_token`, `cancelled_at`, a free `service_title` or a not allowed status is rejected **in the browser**, and nothing is sent. The server validates everything again.

**React wiring**:

- `useAdminMutation()` (`src/hooks/useAdminMutation.ts`, core `runMutation` in `src/lib/api/mutation.ts`) runs a write, shows a fixed Dutch toast and returns the API response.
- `useAdminLoad()` (6D-1) still loads the data.
- `useAdminAvailability()` loads server slots.
- No React Query and no global state library.

## Auth0 token handling

Unchanged since phase 5/6D-1:

- the existing `Auth0Provider` (no second provider);
- `getAccessTokenSilently()` for the API audience, never the ID token;
- no token storage in our code;
- permission `admin:access` unchanged.

A 401 on a write notifies the `/admin` guard, which re-checks the session and offers a new login (at most once per 30 s).

## Dashboard

Read only: `GET /api/admin/dashboard`. No writes.

## Agenda

- **Read**: `GET /api/admin/agenda?start=&end=`.
- **New appointment** (`BookingCreateDialog`, shared with reservations):
  - customer name, phone and **e-mail (required)**, brand/model, vehicle type, **one or more services** (checkboxes), status (`nieuw`/`bevestigd`/`voltooid`), date, a **free slot from the server**, notes;
  - → `POST /api/admin/bookings`.
  - There is no duration, price or service-name input any more. The duration shown comes from the availability response; after saving, the toast shows the server's totals ("€121,00 incl. btw (€100,00 + €21,00 btw)").
- **Edit** (`BookingEditDialog`): the booking is reloaded with `GET /api/admin/bookings/:id` when the dialog opens, so no stale list data is used.
  - Move: date + slot from `GET /api/admin/availability?date=&exclude_booking_id=` (with changed services: `&vehicle_type_id=&service_ids=`).
  - Change vehicle type / services.
  - Status (all four), notes.
  - → `PATCH /api/admin/bookings/:id` with **only the changed fields**. The server re-checks opening hours, grid, past and overlap (excluding the booking itself; the exclusion constraint is the last guard), re-prices, replaces the `booking_services` snapshots and synchronises `total_price`. The UI shows the response's totals and reloads the agenda.
- **Cancel**: `PATCH { status: "geannuleerd" }` (the server sets `cancelled_at`). **Reactivate**: choose another status; the server re-checks overlap (409 if taken).
- **Delete**: `DELETE /api/admin/bookings/:id`.
- **409 `BOOKING_SLOT_UNAVAILABLE`**: "Dit tijdslot is intussen bezet…" and the agenda, the booking and the slot list are reloaded.

## Reservations

- List and detail as in 6D-1 (`GET /api/admin/bookings`, `GET /api/admin/bookings/:id`).
- "Nieuwe afspraak" uses the same `BookingCreateDialog`.
  - **Removed**: the free price, duration and service-name inputs, and the placeholder e-mail.
- Status select → `PATCH /api/admin/bookings/:id { status }`; delete → `DELETE`. After every write the page reloads the list from the API (no local recalculation).

## Services

- **New**: `POST /api/admin/services { kind }`. The server creates the title/icon/sort-order defaults and a pricing row for every vehicle type, in one transaction. The frontend no longer touches `vehicle_type_services`.
- **Save**: `PATCH /api/admin/services/:id`. For a package, additionally `PUT /api/admin/services/:id/package-content` with the **complete** list. The card is then updated from the API response; the other cards keep their unsaved edits.
- **Delete**: `DELETE /api/admin/services/:id`, then reload.

## Vehicles

- **New**: `POST /api/admin/vehicle-types {}`. The server creates the slug/title/order defaults and the pricing rows.
- **Edit fields**: `PATCH /api/admin/vehicle-types/:id` (on blur / toggle, as before), then reload.
- **Delete**: `DELETE /api/admin/vehicle-types/:id`. `409 RESOURCE_IN_USE` → "Dit item wordt nog gebruikt (bv. door reservaties)…", never database details.

## Pricing

"Prijzen opslaan" sends **one** `PUT /api/admin/vehicle-types/:id/pricing`:

- It carries all matrix rows of that vehicle type (`service_id`, `available`, `price`, `duration_minutes`), including rows the page hides (inactive services).
- An invalid row (e.g. 3 decimals, duration 0) is rejected before sending; the server also saves all rows or none.
- After success the matrix is reloaded.

## Blocked periods

`POST /api/admin/blocked-periods` (no times = whole day; `start ≤ end` and `start_time < end_time` are checked in the browser and by the server) and `DELETE /api/admin/blocked-periods/:id`, each followed by a reload. The agenda loads blocked periods itself whenever it is opened or navigated.

## Settings

`PATCH /api/admin/settings` with only the fields that differ from the last state confirmed by the API. The server merges and validates the result (e.g. opening before closing hour). The form is then filled from the response. Without changes, nothing is sent. Availability-dependent views (agenda slots) always request fresh data from the server.

## Gallery

- **Upload**: `POST /api/admin/gallery/upload`, multipart `FormData` with field `file`; `accept="image/jpeg,image/png,image/webp"` plus a type pre-check.
  - The server checks type (magic bytes) and size, stores the file and creates the item. The new item, with the server's `image_url`, is shown immediately.
  - Errors: 413 "Het bestand is te groot", 415 "Alleen JPEG-, PNG- en WebP-afbeeldingen…", 429, and 503 storage unavailable.
- **Metadata**: `PATCH /api/admin/gallery/:id`; the card is updated from the response.
- **Delete**: `DELETE /api/admin/gallery/:id`. The server removes the item and, only for files it manages itself, the stored image. Old Supabase URLs are never touched. The browser no longer handles file names, storage paths or Supabase Storage.

## Availability (`src/lib/slots.ts`)

| Area                       | Availability source                                                | Status                                            |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| **ADMIN**                  | `GET /api/admin/availability` (server-side, authoritative)         | Final                                             |
| **PUBLIC** (`/reservatie`) | `src/lib/slots.ts`: legacy/local slot calculation on Supabase data | **Temporary**, until the public frontend migrates |

- The admin no longer imports `src/lib/slots.ts` at all. The three pure display helpers it used (`timeToMinutes`, `minutesToTime`, `formatDuration`) are in `src/lib/time-display.ts`.
- `src/lib/slots.ts` itself is unchanged and is only used by `src/routes/reservatie.tsx`.

## Error handling

Writes use `describeWriteError` (`src/lib/api/errors.ts`). The toasts contain fixed Dutch texts only, never backend, SQL or PostgreSQL messages.

| Response                                                                  | UI                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Request invalid before sending / 400 `VALIDATION_ERROR`                   | "Ongeldige invoer. Controleer de velden."; the booking form shows Dutch messages per field      |
| 401                                                                       | "Je sessie is verlopen…" + the guard re-checks the session (login)                              |
| 403                                                                       | "Geen toegang…"                                                                                 |
| 404 (`RESOURCE_NOT_FOUND`, `VEHICLE_TYPE_NOT_FOUND`, `SERVICE_NOT_FOUND`) | "Dit item bestaat niet meer…" / specific texts; the data is reloaded                            |
| 409 `BOOKING_SLOT_UNAVAILABLE`                                            | "Dit tijdslot is intussen bezet…"; agenda and slots are reloaded                                |
| 409 `RESOURCE_IN_USE` / `RESOURCE_CONFLICT`                               | "…wordt nog gebruikt…" / "…botst met bestaande gegevens…"                                       |
| 422 `BOOKING_IN_PAST` / `BOOKING_OUTSIDE_OPENING_HOURS`                   | Planning messages                                                                               |
| 413 / 415 / 429                                                           | File too large / type not allowed / too many requests                                           |
| 503 / network                                                             | "Server tijdelijk niet bereikbaar…" (503 `STORAGE_UNAVAILABLE`: storage message)                |
| Timeout on a write                                                        | "…antwoordde niet op tijd… controleer of de wijziging is opgeslagen" + reload (outcome unknown) |
| 500 / unknown                                                             | "Er ging iets mis bij het opslaan."                                                             |

**Stale data**: there are no optimistic updates for bookings, pricing or settings.

- Every write goes to the API and the page then applies the response or reloads.
- The edit dialog loads the booking fresh.
- 404/409/timeouts trigger a reload, so an admin never silently overwrites another admin's change; the server decides.

## Date/time handling

All local date/time fields come from the API in Europe/Brussels:

- `preferred_date`, `preferred_time`, `pickup_date`, `pickup_time` and the availability `slots[].time` / `pickup_*`.
- The browser sends only `preferred_date` + `preferred_time` (a slot offered by the server). It never sends `start_at`/`end_at`, never computes an end time and never uses the legacy `end_time`.

## Remaining Supabase usage

| Directory / file                                                                                         | Usage                                                                  | Area                           |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| `src/routes/admin/*`, `src/routes/admin.tsx`, `src/routes/admin-login.tsx`                               | none                                                                   | ADMIN: **NONE**                |
| `src/components/admin/*`                                                                                 | none                                                                   | ADMIN: **NONE**                |
| `src/hooks/*` (`useAdminAuth`, `useAdminLoad`, `useAdminMutation`, `useAdminAvailability`, `use-mobile`) | none                                                                   | NONE                           |
| `src/lib/api/*`, `src/lib/auth/*`, `src/lib/time-display.ts`                                             | none (the word only appears in a test asserting "no Supabase request") | NONE                           |
| `src/lib/slots.ts`                                                                                       | reads `bookings`, `blocked_periods`, `site_settings`                   | PUBLIC (used by `/reservatie`) |
| `src/routes/reservatie.tsx`                                                                              | catalogue reads, booking insert                                        | PUBLIC                         |
| `src/routes/diensten.tsx`, `src/routes/galerij.tsx`                                                      | catalogue / gallery reads                                              | PUBLIC                         |
| `src/components/ServicesPreview.tsx`, `RealisationsPreview.tsx`, `Testimonials.tsx`                      | reads for the home page                                                | PUBLIC                         |
| `src/integrations/supabase/*`                                                                            | client (+ unused Lovable templates)                                    | PUBLIC                         |
| `supabase/` (migrations), `@supabase/supabase-js`                                                        | kept                                                                   | PUBLIC / LEGACY                |

The admin uses:

| Admin use            | Count |
| -------------------- | ----- |
| Database reads       | NONE  |
| Database writes      | NONE  |
| Storage              | NONE  |
| Auth (Auth0 instead) | NONE  |

## Tests

Root `npm test` runs `node --test "src/**/*.test.ts"` without a DOM, without Auth0 and without a real API: **111 tests**.

- **`client.test.ts`** (18):
  - GET, POST, PATCH, PUT, DELETE (204) and multipart: Bearer header, JSON body, `FormData` without a manual content type;
  - 400/401/403/404/409/422/500/503;
  - timeout (also per request), network failure, abort, token failures, no logging.
- **`admin-writes.test.ts`** (28): every write flow.
  - Agenda: create, move 10:00→10:30, move into another booking's slot → 409, change services, change vehicle type, status, cancel, reactivation 409, delete, availability query.
  - Reservations: create, status, delete, detail refresh.
  - Services: create, update, package contents, delete.
  - Vehicles: create, update, delete in use, pricing matrix incl. all-or-nothing.
  - Blocked periods: create, invalid ranges, delete.
  - Settings: partial update.
  - Gallery: metadata create/update/delete, upload (`FormData`, response URL, no Supabase request), invalid type, 413/415/503/429.
  - Contract tests: client price, duration, totals, cancel token, timestamps and `cancelled_at` are rejected before sending; pricing displayed = server's 100/21/121.
- **`booking-form.test.ts`** (6): e-mail missing, whitespace, invalid, valid (no placeholder); required vehicle type, services and slot; no price/duration/timestamps in the request.
- **`mutation.test.ts`** (4): success, 401 → guard, timeout → unknown outcome + refresh, no DB details.
- **Earlier tests** (55): reads (28), error views (8), load states (8), auth (11).

The React components themselves are not rendered in tests (no DOM test environment in the repository; adding one was out of scope). The logic that decides what is sent and shown is in the tested modules; the manual checklist covers rendering.

## Manual test checklist

Prerequisites:

- API (`apps/api`, `npm run dev`) on a database with data, with `UPLOAD_DIR`/`PUBLIC_UPLOAD_URL` set;
- frontend with `VITE_API_BASE_URL` and `VITE_AUTH0_*`;
- an Auth0 user with `admin:access`.

Keep the network tab open, filtered on the API host and on `supabase.co`; no admin step may produce a `supabase.co` request.

1. Login via Auth0 → `/admin`.
2. Dashboard shows data.
3. Agenda: week/day navigation.
4. Create a booking: vehicle type, two services, date, server slot; the duration is shown; the toast shows the server total; the booking appears.
5. Move the booking to another slot (and into an occupied slot → "intussen bezet", agenda refreshed).
6. Cancel the booking (struck through).
7. Reactivate (status "Bevestigd"); conflict → message.
8. Delete the booking.
9. Reservations: "Nieuwe afspraak" without e-mail → "E-mail is verplicht"; with e-mail → created; status change; delete.
10. Create a service (appears; prices under vehicles).
11. Edit a service and save.
12. Change the contents of a package and save; reload → contents kept.
13. Delete a service.
14. Create a vehicle type.
15. Edit a vehicle type (title, active, order).
16. Change the pricing matrix and save; an invalid value (e.g. 1,234) → nothing saved.
17. Delete a vehicle type with bookings → "wordt nog gebruikt"; without bookings → deleted.
18. Create a blocked period (whole day and with times).
19. Delete a blocked period.
20. Change settings (one field) → only that field in the PATCH body.
21. Gallery: edit title/order and save.
22. Upload an image (JPEG/PNG/WebP) → it appears immediately with an `/uploads/gallery/…` URL; SVG or > `MAX_UPLOAD_BYTES` → error.
23. Delete an uploaded image → the file disappears from `UPLOAD_DIR/gallery`; delete an old Supabase image → only the item disappears.
24. Logout.

**Executed so far**: none of these browser steps was executed in the development environment of this phase (no Auth0 credentials or running API with data were available there). All write flows were verified by the automated tests above.
