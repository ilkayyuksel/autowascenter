# Public Migration Map

Phase 7A moved every **public read** of the website from Supabase to the own REST API; phase 7B moved the public booking **write** (`/reservatie` submit) to `POST /api/bookings` (details: `docs/PUBLIC-BOOKING-MIGRATION.md`). Since 7B no runtime code uses Supabase. Supabase, `@supabase/supabase-js`, `src/integrations/supabase/` and `supabase/` are **not** removed yet; neither are the Lovable/Cloudflare build tools (phase 7C).

## Inventory: every Supabase reference in the repository

Search terms: `supabase.from(`, `supabase.auth`, `supabase.storage`, `createClient(`, `@supabase/supabase-js`, `.from("<table>")`, imports of `src/integrations/supabase`. Verified in the code after the migration, without assumptions.

| FILE                                                                                             | OPERATION                                                                                                                | TABLE / SERVICE                                         | KIND         | NEW API ENDPOINT                                             | STATUS                                                |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------ | ------------------------------------------------------------ | ----------------------------------------------------- |
| `src/components/ServicesPreview.tsx`                                                             | ~~select active, order sort_order, limit 4~~                                                                             | `services`                                              | PUBLIC READ  | `GET /api/services?limit=4`                                  | **MIGRATED**                                          |
| `src/components/RealisationsPreview.tsx`                                                         | ~~select order sort_order, limit 4~~                                                                                     | `gallery_items`                                         | PUBLIC READ  | `GET /api/gallery?limit=4`                                   | **MIGRATED**                                          |
| `src/components/Testimonials.tsx`                                                                | ~~select approved, order created_at desc, limit 6~~                                                                      | `reviews`                                               | PUBLIC READ  | `GET /api/reviews?limit=6`                                   | **MIGRATED**                                          |
| `src/routes/diensten.tsx`                                                                        | ~~select active, order sort_order~~                                                                                      | `services`                                              | PUBLIC READ  | `GET /api/services`                                          | **MIGRATED**                                          |
| `src/routes/galerij.tsx`                                                                         | ~~select order sort_order~~                                                                                              | `gallery_items`                                         | PUBLIC READ  | `GET /api/gallery`                                           | **MIGRATED**                                          |
| `src/routes/reservatie.tsx`                                                                      | ~~select active vehicle types~~                                                                                          | `vehicle_types`                                         | PUBLIC READ  | `GET /api/vehicle-types`                                     | **MIGRATED**                                          |
| `src/routes/reservatie.tsx`                                                                      | ~~select available rows + `services!inner`~~, ~~`package_services` + titles~~                                            | `vehicle_type_services`, `services`, `package_services` | PUBLIC READ  | `GET /api/vehicle-types/:id/services` (`includes`)           | **MIGRATED**                                          |
| `src/routes/reservatie.tsx`                                                                      | ~~select all blocked periods~~                                                                                           | `blocked_periods`                                       | PUBLIC READ  | none needed: used inside `GET /api/availability`             | **REMOVED from the browser**                          |
| `src/routes/reservatie.tsx`                                                                      | ~~select km_fee, free_km, opening/closing hour, slot interval~~                                                          | `site_settings`                                         | PUBLIC READ  | `GET /api/site-settings` (**new**, `km_fee`, `free_km` only) | **MIGRATED**                                          |
| `src/routes/reservatie.tsx` → `src/lib/slots.ts`                                                 | ~~`fetchSlotData`: bookings around the date, blocked periods, settings~~ + local `computeAvailableSlots`/`computePickup` | `bookings`, `blocked_periods`, `site_settings`          | PUBLIC READ  | `GET /api/availability` (slots + pickup moments)             | **MIGRATED** (server-side availability)               |
| `src/routes/reservatie.tsx`                                                                      | ~~`insert` booking (client-computed `end_time`, duration, price)~~                                                       | `bookings`                                              | PUBLIC WRITE | `POST /api/bookings`                                         | **MIGRATED** (7B)                                     |
| `src/routes/reservatie.tsx`                                                                      | ~~`insert` service lines~~                                                                                               | `booking_services`                                      | PUBLIC WRITE | part of `POST /api/bookings` (server transaction)            | **MIGRATED** (7B)                                     |
| `src/lib/slots.ts`                                                                               | `fetchSlotData` selects                                                                                                  | `bookings`, `blocked_periods`, `site_settings`          | UNUSED       | —                                                            | **UNUSED** (no importer left); kept, removal in 7C    |
| `src/integrations/supabase/client.ts`                                                            | `createClient(...)`                                                                                                      | Supabase client                                         | LEGACY       | —                                                            | Only imported by the unused `slots.ts`; removal in 7C |
| `src/integrations/supabase/client.server.ts`                                                     | `createClient(...)` (service role, server)                                                                               | Supabase client                                         | UNUSED       | —                                                            | UNUSED Lovable template                               |
| `src/integrations/supabase/auth-middleware.ts`                                                   | `createClient`, `supabase.auth.getClaims`                                                                                | Supabase Auth                                           | UNUSED       | —                                                            | UNUSED Lovable template (admin uses Auth0)            |
| `src/integrations/supabase/types.ts`                                                             | generated DB types                                                                                                       | —                                                       | LEGACY       | —                                                            | Kept until Supabase removal                           |
| `src/integrations/supabase/previewAuthStorage.ts`                                                | Supabase Auth session storage (Lovable preview)                                                                          | Supabase Auth                                           | LEGACY       | —                                                            | Only referenced by `client.ts`; no auth call is made  |
| `supabase/` (migrations, config)                                                                 | schema history                                                                                                           | —                                                       | LEGACY       | —                                                            | Kept                                                  |
| `package.json`                                                                                   | `@supabase/supabase-js`                                                                                                  | —                                                       | LEGACY       | —                                                            | No runtime use since 7B; removal in 7C                |
| `src/routes/admin/*`, `src/components/admin/*`, `src/hooks/*`, `src/lib/api/*`, `src/lib/auth/*` | none                                                                                                                     | —                                                       | ADMIN        | own API (6D)                                                 | **NONE**                                              |

Supabase **Storage**: not used anywhere any more (admin uses the API since 6D-2; public pages only display image URLs). Supabase **Auth**: not used (admin: Auth0; customers have no accounts).

## Per page

| PAGE                    | DATA                                                                   | OLD SOURCE                                                          | NEW SOURCE                                           | STATUS                                                        |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| `/` (`index.tsx`)       | 4 services                                                             | Supabase `services`                                                 | `GET /api/services?limit=4`                          | MIGRATED                                                      |
| `/`                     | 4 realisations (example photos as fallback)                            | Supabase `gallery_items`                                            | `GET /api/gallery?limit=4`                           | MIGRATED                                                      |
| `/`                     | 6 approved reviews (section hidden when none)                          | Supabase `reviews`                                                  | `GET /api/reviews?limit=6`                           | MIGRATED                                                      |
| `/diensten`             | active services, category filter, bookable labels                      | Supabase `services`                                                 | `GET /api/services`                                  | MIGRATED                                                      |
| `/galerij`              | gallery items, filters, lightbox, before/after, fallback               | Supabase `gallery_items`                                            | `GET /api/gallery`                                   | MIGRATED                                                      |
| `/over-ons`             | static                                                                 | —                                                                   | —                                                    | UNCHANGED (no data)                                           |
| `/contact`              | static form, no submit backend                                         | — (no Supabase)                                                     | —                                                    | UNCHANGED — contact submit **not implemented** (not migrated) |
| `/reservatie` step 1    | vehicle types                                                          | Supabase `vehicle_types`                                            | `GET /api/vehicle-types`                             | MIGRATED                                                      |
| `/reservatie` steps 2–3 | services/packages/extras per type, prices, durations, package contents | Supabase `vehicle_type_services` + `services` + `package_services`  | `GET /api/vehicle-types/:id/services`                | MIGRATED                                                      |
| `/reservatie` step 4    | free start times + pickup moment                                       | Supabase bookings/blocked periods/settings + local slot calculation | `GET /api/availability`                              | MIGRATED (server-authoritative)                               |
| `/reservatie` step 5    | km fee / free km text                                                  | Supabase `site_settings`                                            | `GET /api/site-settings`                             | MIGRATED                                                      |
| `/reservatie` submit    | booking + service lines                                                | Supabase insert (2 separate writes)                                 | `POST /api/bookings` (1 request, server transaction) | **MIGRATED** (7B)                                             |

## Details

- **Client**: the existing central client (`src/lib/api/client.ts`), as `publicApi` (`src/lib/api/public-api.ts`).
  - It is created **without** a token provider, so public calls can never send an `Authorization` header. No Auth0 is involved.
  - The existing timeout (15 s) applies.
- **Typed reads**: `src/lib/api/public-reads.ts`: `getPublicServices`, `getPublicGallery`, `getPublicReviews`, `getPublicVehicleTypes`, `getPublicVehicleTypeServices`, `getPublicAvailability`, `getPublicSiteSettings`. Responses are validated with the shared contracts.
- **Contracts**: `apps/api/src/contracts/public.ts` moved to `packages/shared/src/public.ts` (subpath `@autowascenter/shared/public`); the backend re-exports it. Availability uses `packages/shared/src/booking.ts`.
- **New endpoint `GET /api/site-settings`**: the booking page needed `km_fee` and `free_km` from `site_settings`, and no public endpoint existed.
  - It has a strict, separate public contract (`publicSiteSettings`) and the service selects only those two columns.
  - `notification_email`, address and opening hours can never be returned; the API tests verify this.
  - The admin settings endpoint is not reused.
- **Blocked periods**: no longer loaded by the browser. The current UI never displayed them; they only fed the local slot calculation, which `GET /api/availability` now does server-side.
- **Availability**: `/reservatie` shows exactly the slots and pickup moments from `GET /api/availability`. The duration label and the summary use the server's `total_duration_minutes`; while it is loading, the sum of the chosen options is shown.
- **Prices on `/reservatie`**: the totals in steps 2–6 are still the sum of the per-type prices from the API, an **indication**, as before. The authoritative booking price is computed by `POST /api/bookings` in phase 7B.
- **Gallery URLs**: `image_url` and `before_image_url` are used exactly as returned. Old Supabase Storage URLs and new self-hosted `/uploads/gallery/…` URLs are both plain image URLs; there is no URL rewrite in the frontend.
- **Loading / empty / error**:
  - Home sections and `/galerij` keep their existing behaviour: example photos or a hidden section when there is no data or an error.
  - `/diensten` and `/reservatie` (vehicle types, services, availability) show a short Dutch message on errors.
  - `/reservatie` step 4 shows "Beschikbare tijdstippen laden…" while loading.
  - Requests are aborted when a page is left. No backend details are shown.
- **SSR**: the reads stay client-side in `useEffect`, as before. There is no SSR refactor.

## `/reservatie` after 7B

| Part         | Source                                                                              |
| ------------ | ----------------------------------------------------------------------------------- |
| READ         | API (`/api/vehicle-types`, `/api/vehicle-types/:id/services`, `/api/site-settings`) |
| AVAILABILITY | API (`GET /api/availability`, preflight; `POST /api/bookings` re-checks)            |
| WRITE        | API (`POST /api/bookings`, one request, server transaction)                         |
| SUPABASE     | NONE                                                                                |

Write mapping:

CURRENT SUPABASE WRITE → `POST /api/bookings` → REQUEST MAPPING → RESPONSE MAPPING → STATUS

| Current Supabase write                                                                                                       | New                  | Request mapping (`toPublicBookingRequest`)                                                                                                                                                                                        | Response mapping (`bookingConfirmation`)                                                                 | Status   |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| `bookings` insert with client `end_time`, `total_duration_minutes`, `total_price`, `location_fee`, `service_title`, `status` | `POST /api/bookings` | `vehicle_type_id`, `service_ids` (service ids), `preferred_date`, `preferred_time`, customer fields, optional `notes`/`company_name`/`vat_number`, `on_location` (+ `location_in_sint_niklaas`, `location_address` when relevant) | reference (id), drop-off, pickup (`pickup_date`/`pickup_time`), `pricing.total_incl_vat` from the server | MIGRATED |
| `booking_services` insert with client title/price/duration snapshots                                                         | (same request)       | nothing extra: the server creates the snapshots in the same transaction                                                                                                                                                           | `services[]` in the response                                                                             | MIGRATED |

## Historical data

The old Supabase bookings (including those made via the public site during 7A) remain in Supabase and are **not migrated** in this phase. New bookings go to the self-hosted PostgreSQL.

## Remaining Supabase after 7B (no runtime use)

| File                                                             | Reason                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/lib/slots.ts`                                               | Unused (no importer); still imports the client; delete in 7C |
| `src/integrations/supabase/{client,previewAuthStorage,types}.ts` | Only reachable via the unused `slots.ts`; delete in 7C       |
| `src/integrations/supabase/{client.server,auth-middleware}.ts`   | Unused Lovable templates; delete in 7C                       |
| `supabase/`, `@supabase/supabase-js`, `VITE_SUPABASE_*`          | Legacy; removed in 7C                                        |

## Manual browser check

Prerequisites: the API (`apps/api`, `npm run dev`) on a database with data, and the frontend with `VITE_API_BASE_URL`. Filter the network tab on `supabase.co`: steps 1–9 must not cause a Supabase request.

1. **Home**: services, realisations and reviews from `/api/services?limit=4`, `/api/gallery?limit=4`, `/api/reviews?limit=6`.
2. **Diensten**: list and category filter (`/api/services`).
3. **Galerij**: items, filter and lightbox, including before/after (`/api/gallery`). Old Supabase image URLs still display.
4. **Reviews/testimonials** on the home page; with no approved reviews the section is hidden.
5. **Reservatie step 1**: vehicle types (`/api/vehicle-types`).
6. **Vehicle type chosen**: services and extras (`/api/vehicle-types/:id/services`), package contents listed.
7. **Services chosen**: the totals are an indication.
8. **Availability**: date → `/api/availability?date=&vehicle_type_id=&service_ids=`; slots and pickup times; a blocked or fully booked day shows no slots.
9. **Loading/error states**: stop the API → `/diensten` and `/reservatie` show error messages, home and galerij fall back; no endless loading.
10. **Admin login** (Auth0).
11. **Admin dashboard**.

**Executed**: none of these browser steps was executed in this phase. No running API with data and no Auth0 credentials were available in the development environment. The behaviour is covered by the automated tests (public reads, page source checks).
