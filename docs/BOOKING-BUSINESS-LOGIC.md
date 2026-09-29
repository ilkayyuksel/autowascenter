# Booking Business Logic

This is the source of truth for booking, pricing and availability in the self-hosted backend (`apps/api`, phase 4).

- The rules are derived from the current frontend: `src/routes/reservatie.tsx` and `src/lib/slots.ts`. The frontend is **not** changed and still uses Supabase.
- Where the backend deliberately deviates, the deviation is marked **CHANGED** and justified.
- Where the current application is ambiguous, the deviation is marked **DISCREPANCY**.

## 1. Mapping: old frontend logic → new backend logic

| #   | Topic                  | Old (frontend, file:line)                                                                                                                                                                                                        | New (backend)                                                                                                                                                                                         |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Vehicle type selection | Step 1 lists `vehicle_types` with `active = true` (`reservatie.tsx:186`)                                                                                                                                                         | `vehicle_type_id` must exist and be active, otherwise **404 `VEHICLE_TYPE_NOT_FOUND`**                                                                                                                |
| 2   | Selectable services    | `vehicle_type_services` for the type with `available = true`, joined `services` filtered **in the browser** on `bookable && active` (`reservatie.tsx:222-248`)                                                                   | Same filters, **in the database**. A requested `service_id` without such a row is **404 `SERVICE_NOT_FOUND`** (unknown, inactive, walk-in only, or not available for this vehicle type)               |
| 3   | Selection identity     | The frontend selects `vehicle_type_services.id` values; the booking stores `service_id` (`reservatie.tsx:160, 342, 366`)                                                                                                         | The request sends **`service_ids`** (`services.id`), resolved per vehicle type on the server                                                                                                          |
| 4   | Multi-select           | Any number of options; toggling prevents duplicates (`toggleService`, `:318`)                                                                                                                                                    | `service_ids`: 1–50 unique UUIDs; duplicates are **400 `VALIDATION_ERROR`**                                                                                                                           |
| 5   | Main service required  | "Next" from step 2 needs at least one option with `kind !== "extra"` (`canNext`, `:300`)                                                                                                                                         | Booking requires at least one `dienst` or `pakket`, otherwise **422 `MAIN_SERVICE_REQUIRED`**. Availability does not enforce it (it only needs a duration)                                            |
| 6   | Packages               | A package is a `services` row with `kind = 'pakket'` and **its own** price and duration in `vehicle_type_services`. `package_services` is only used to list "includes" (`:231-246`). Package + included service are both counted | **Preserved exactly**: a package is priced like any other service; `package_services` is never used for pricing. Package + included service is allowed and both are counted (see §3, **DISCREPANCY**) |
| 7   | Price                  | `totalServicesPrice = Σ vts.price` of the selected options (`:276`), a JavaScript float                                                                                                                                          | `Σ vehicle_type_services.price`, read from PostgreSQL inside the booking transaction, computed in **integer cents**. **The client never sends a price.**                                              |
| 8   | Duration               | `totalDuration = Σ vts.duration_minutes` (`:275`)                                                                                                                                                                                | Same sum, from PostgreSQL. **The client never sends a duration.**                                                                                                                                     |
| 9   | Location fee           | `locationFee = onLocation && !inSN ? 0 : 0` (`:277`): always 0. Km-fee and free-km are only shown as text                                                                                                                        | Always **0**, via a dedicated `calculateLocationFee()` so a real (server-side) calculation can be added later. No geocoding                                                                           |
| 10  | Total excl. VAT        | `totalPrice = services + locationFee` (`:278`), stored as `bookings.total_price`                                                                                                                                                 | Identical meaning: `bookings.total_price` = services + location fee, **excl. VAT**                                                                                                                    |
| 11  | VAT                    | `vatAmount = totalPrice * 0.21`, `totalInclVat = totalPrice + vatAmount`, display only, not stored (`:279-280`)                                                                                                                  | 21 %, computed in cents with half-up rounding, returned in the API response (`vat`, `total_incl_vat`), **not stored** (the DB meaning is unchanged)                                                   |
| 12  | Opening window         | `site_settings.opening_hour/closing_hour`; fallback `10:00–21:00`, interval 30 if the row is missing (`slots.ts:fetchSlotData`)                                                                                                  | Same columns, same fallback when no row exists                                                                                                                                                        |
| 13  | Slot grid              | Starts at `open + k × max(5, slot_interval_minutes)` (`slots.ts:130,140`)                                                                                                                                                        | Identical. A booking time not on the grid is **422 `BOOKING_OUTSIDE_OPENING_HOURS`**                                                                                                                  |
| 14  | Which starts are valid | `t + min(duration, dayLen) <= close` (`slots.ts:140`): a job that fits in one day must end the same day; a job longer than one day can only start at opening time                                                                | Identical rule; violating it is **422 `BOOKING_OUTSIDE_OPENING_HOURS`**                                                                                                                               |
| 15  | Multi-day work         | Work continues on the **next calendar day** from opening time (`slots.ts` `busyForDate`, `computePickup`); `end_time` = start + duration, can be `"25:00"` (`reservatie.tsx:329`)                                                | Same continuation rule, but stored as absolute **`start_at` / `end_at` timestamps** (`end_at` = pickup moment). No `end_time` string                                                                  |
| 16  | "Today" and past slots | `todayStr = new Date().toISOString()` (**UTC** date) and `now` in browser-local minutes; skips `t <= now` (`slots.ts:133-141`)                                                                                                   | **CHANGED**: "today" and "now" are computed in **Europe/Brussels**. Past dates return no slots; booking a past date or time is **422 `BOOKING_IN_PAST`**                                              |
| 17  | Conflicting bookings   | `bookings` with `status <> 'geannuleerd'` and `preferred_date ∈ [date−7, date]` (`slots.ts:fetchSlotData`). **For anonymous visitors RLS returns 0 rows**, so the public wizard sees no bookings at all                          | **CHANGED**: all non-cancelled bookings whose `[start_at, end_at)` overlaps the candidate's work, **including later days** of a multi-day job. The server always sees every booking                   |
| 18  | Blocked periods        | For each date in `[start_date, end_date]`: `[start_time ?? 00:00, end_time ?? 24:00)`. Only periods overlapping the **first** day are fetched (`slots.ts:fetchSlotData`)                                                         | Same per-day semantics, checked against **every** day segment of the job (**CHANGED**: later days were ignored)                                                                                       |
| 19  | Capacity               | 1: any overlap is a conflict                                                                                                                                                                                                     | 1, unchanged                                                                                                                                                                                          |
| 20  | Weekdays / Sunday      | Not modelled; every day is bookable, Sunday included. `src/lib/site.ts` says "Zondag: Gesloten"                                                                                                                                  | Unchanged (every day bookable). **DISCREPANCY**: see §5                                                                                                                                               |
| 21  | Customer validation    | zod `customerSchema` (`reservatie.tsx:91-106`), in the browser                                                                                                                                                                   | The **same rules and messages** in `packages/shared` (`bookingRequestSchema`), enforced on the server                                                                                                 |
| 22  | Status                 | The client sends `status: "nieuw"` (`:356`); RLS allows any value                                                                                                                                                                | The server always sets **`nieuw`**; the request has no status field (unknown fields are rejected)                                                                                                     |
| 23  | Cancel token           | DB default `gen_random_uuid()`; the client could override it                                                                                                                                                                     | Only the DB default (cryptographically random); never accepted from the client, never returned                                                                                                        |
| 24  | Saving                 | Two independent requests: insert booking, then insert `booking_services` (`:332-374`); no transaction                                                                                                                            | **One transaction**: resolve, price, validate slot, insert booking, insert lines. Any failure rolls everything back                                                                                   |
| 25  | Concurrency            | None (client-side check only in the admin; none in the public flow)                                                                                                                                                              | Pre-check inside the transaction + **PostgreSQL exclusion constraint** `bookings_no_overlap_excl` as the final guard. A conflict is **409 `BOOKING_SLOT_UNAVAILABLE`**                                |
| 26  | Legacy columns         | `service_id` = first selected option, `service_title` = titles joined with `", "`, `vehicle_info` = `"brand model"` (`:341-343`). "First" follows the option list order (title order)                                            | Filled identically (options ordered by title) so the existing admin UI keeps working after the data switch                                                                                            |
| 27  | Snapshots              | `booking_services` rows with `service_id, service_title, price, duration_minutes` (`:364-370`)                                                                                                                                   | Identical, taken from the database values used for pricing inside the transaction                                                                                                                     |

## 2. Pricing

- **Source**: `vehicle_type_services.price` for the combination of the chosen vehicle type and each chosen service. That is the only price source used today.
- `services.price` is **LEGACY** (home-page display only) and is **not** used.
- **Services subtotal**: `Σ price` of the chosen services, excl. VAT.
- **Location fee**: `0` (see §1 row 9). `calculateLocationFee()` is the single place where a real calculation (km beyond `site_settings.free_km` × `site_settings.km_fee`) can be added later. The current code only shows those values as information text.
- **Total excl. VAT** = services subtotal + location fee. This value is stored as `bookings.total_price`, and its meaning is unchanged.
- **VAT**: 21 % of the total excl. VAT, rounded half-up to whole cents. **Total incl. VAT** = total excl. VAT + VAT. Neither is stored; both are returned by the API.
- **Arithmetic**: all amounts are handled as integer cents to avoid floating-point errors. The API returns euros as JSON numbers with at most 2 decimals.
- **Never trusted from the client**: price, totals, VAT, duration, status, cancel token, `start_at`, `end_at`. The request schema has no such fields and rejects unknown fields.

## 3. Package rules

The current application treats a package as an ordinary selectable service. This behaviour is kept:

| Selection                                | Price and duration                                   | Allowed?                        |
| ---------------------------------------- | ---------------------------------------------------- | ------------------------------- |
| Only a package                           | Package's own `vehicle_type_services` price/duration | yes                             |
| Only individual services                 | Sum of the services                                  | yes                             |
| Package + another (non-included) service | Package + service                                    | yes                             |
| Package + a service it includes          | Package + service (**both counted**)                 | yes                             |
| Several individual services              | Sum                                                  | yes                             |
| Only extras                              | —                                                    | no: 422 `MAIN_SERVICE_REQUIRED` |
| The same service twice                   | —                                                    | no: 400 `VALIDATION_ERROR`      |

**DISCREPANCY**: the current frontend does **not** prevent a package plus a service it already includes, and charges both. The backend keeps this on purpose, because the task forbids inventing pricing rules the current code does not have. The business should decide whether this combination should be rejected or deduplicated. It is covered by a test so a change is deliberate.

## 4. Duration and time model

- **Duration**: `Σ vehicle_type_services.duration_minutes` of the chosen services.
- **Work segments** (the same algorithm as `slots.ts`):
  - Work starts at the chosen local time and runs until `min(start + remaining, closing_hour)`.
  - If time remains, it continues the **next calendar day** at `opening_hour`, and so on.
  - The pickup moment is the end of the last segment.
- **Absolute timestamps**:
  - `start_at` = local start in Europe/Brussels.
  - `end_at` = local pickup moment in Europe/Brussels.
  - Both are `timestamptz`. The occupied interval is `[start_at, end_at)`.
- **Old versus new**: the old `end_time` was `start + duration` as a clock string and could be `"25:00"`. It no longer exists. Multi-day bookings are represented only by `start_at`/`end_at`.
- **Why a range is enough for conflicts**: between `start_at` and `end_at`, the job occupies every open hour. The overnight gaps inside the range are closed hours that no other job can use. So overlap of `[start_at, end_at)` ranges is equivalent to overlap of the per-day work segments. This is what the database exclusion constraint checks.
- **Blocked periods** are compared per day segment instead, because a block may cover closed hours that do not affect a job.

## 5. Opening hours

- One daily window for **every** day, from `site_settings.opening_hour` to `closing_hour` (DEFERRED BUSINESS DECISION: no per-weekday model).
- **DISCREPANCY**:
  - `src/lib/site.ts` shows "Maandag–Vrijdag 09:00–18:00, Zaterdag 09:00–17:00, Zondag Gesloten".
  - The database default is `08:00–22:00`, the code fallback `10:00–21:00`, and the admin agenda grid is hardcoded to `10–21`.
  - Sunday is bookable in both the current and the new implementation.
  - The backend does **not** invent a Sunday rule and adds no column. The business should decide and then model opening hours per weekday.
- **Fallback**: if `site_settings` has no row, `10:00–21:00` with a 30-minute interval is used. This is the same fallback as the frontend.
- **Interval**: `max(5, slot_interval_minutes)`, the same as the frontend.

## 6. Blocked periods

- A period applies to **every date** from `start_date` to `end_date` inclusive.
- **Whole day** (`start_time` and `end_time` NULL): 00:00–24:00.
- **Time range**: `[start_time, end_time)`. A NULL start means 00:00; a NULL end means 24:00.
- **Multiple days**: the time range repeats on each date.
- **Conflict**: a job segment `[s, e)` on a date conflicts if it overlaps any block interval of that date.

## 7. Availability (`GET /api/availability`)

1. Validate the query (Zod): `date`, `vehicle_type_id`, `service_ids`.
2. Resolve the services for the vehicle type (404 as in §1) and compute the total duration.
3. If `date` is before "today" in Europe/Brussels: no slots.
4. Generate the candidate starts on the grid that satisfy rule 14. On today, skip starts ≤ the current Brussels minute.
5. For each candidate, compute the work segments and absolute `[start_at, end_at)`.
6. Drop candidates that overlap a non-cancelled booking (range overlap) or a blocked period on any segment day.
7. Return the remaining slots with `start_at`, `end_at` and the pickup date/time.

The result is **informative**. `POST /api/bookings` re-validates everything.

## 8. Booking lifecycle and transaction (`POST /api/bookings`)

**Inside one database transaction:**

1. Load the vehicle type (must be active) and the chosen services for that type (see §1 rows 2–5).
2. Compute the pricing lines, the total duration, and the prices in cents.
3. Load `site_settings`. Validate: not in the past (Brussels), on the grid, and within the start rule. Compute `start_at`/`end_at`.
4. Check blocked periods and overlapping bookings. Either one is **409 `BOOKING_SLOT_UNAVAILABLE`**.
5. Insert `bookings`. The server-controlled fields are `status = 'nieuw'`, `total_price`, `location_fee`, `total_duration_minutes`, `start_at` and `end_at`; `cancel_token` comes from the DB default. The legacy fields are filled as in §1 row 26.
6. Insert one `booking_services` snapshot row per service.
7. Commit.

- **Rollback**: if any step throws, the whole transaction rolls back and no partial booking remains.
- **Exclusion violation** (SQLSTATE `23P01`): if another booking commits in the same slot between step 4 and step 5, the constraint rejects the insert, and the API answers **409 `BOOKING_SLOT_UNAVAILABLE`**.
- **Status**: a public booking always starts as `nieuw`. Confirming, completing and cancelling belong to the future admin API.
- **Snapshot behaviour**: `booking_services` stores the title, price and duration used at booking time. Later catalogue changes do not alter existing bookings; deleting a service sets `booking_services.service_id` to NULL but keeps the snapshot.

## 9. Concurrency protection

- **Layer 1**: the availability check inside the transaction. It gives fast, friendly 409s in the common case.
- **Layer 2, authoritative**: the PostgreSQL exclusion constraint.
  ```sql
  EXCLUDE USING gist (tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status <> 'geannuleerd')
  ```
  Under PostgreSQL's default READ COMMITTED isolation, two concurrent transactions can both pass layer 1. The second insert then waits for the first to commit and fails with `23P01`, which becomes 409. Two successes are impossible.
- **Double submit from the current frontend**: the "Bevestig" button is only disabled after React re-renders `submitting`, so a very fast double click can send two identical requests. They target the same slot, so the second one gets a 409 from the overlap protection. No idempotency column was added.
  - A future improvement without a schema change: an optional `Idempotency-Key` header with a short-lived cache. For multiple replicas, that cache would need to be shared.

## 10. Timezone

- **Business time zone**: `Europe/Brussels` for every calendar and clock calculation.
- **Input interpretation**:
  - `preferred_date` (`YYYY-MM-DD`) and `preferred_time` (`HH:MM`) are local Brussels wall-clock values.
  - `site_settings` hours and `blocked_periods` dates and times are local too.
- **Today and now**: derived from the server clock with `Intl.DateTimeFormat(..., { timeZone: "Europe/Brussels" })`, never from `toISOString()`.
- **Local to absolute**: the Brussels UTC offset is looked up for the specific date and time (IANA rules via `Intl`), so each timestamp gets the correct CET/CEST offset. `start_at` must equal `(preferred_date + preferred_time) AT TIME ZONE 'Europe/Brussels'`, and the database enforces this with a CHECK.
- **DST**:
  - The transitions happen at 02:00–03:00 local time, outside any realistic opening window.
  - Slots are generated in local minutes, so a slot at "10:00" is 10:00 local on both sides of a change.
  - A multi-day job across a DST change keeps its local segment times, and the absolute `end_at` gets the correct offset.
  - A local time inside the spring-forward gap (for example 02:30 on the last Sunday of March) does not exist. Such a start is rejected as outside opening hours: slot times must round-trip through the time-zone conversion.

## 11. Error codes

| Status | Code                            | When                                                                               |
| ------ | ------------------------------- | ---------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`              | Malformed input (Zod): fields, formats, UUIDs, duplicates, unknown fields          |
| 404    | `VEHICLE_TYPE_NOT_FOUND`        | Unknown or inactive vehicle type                                                   |
| 404    | `SERVICE_NOT_FOUND`             | A service is unknown or not bookable for this vehicle type                         |
| 409    | `BOOKING_SLOT_UNAVAILABLE`      | Overlapping booking or blocked period, including concurrent races                  |
| 422    | `BOOKING_OUTSIDE_OPENING_HOURS` | Time outside the opening window, not on the slot grid, or violating the start rule |
| 422    | `BOOKING_IN_PAST`               | Date or time before "now" in Europe/Brussels                                       |
| 422    | `MAIN_SERVICE_REQUIRED`         | Only extras selected                                                               |
| 429    | `RATE_LIMITED`                  | Too many booking requests from one client                                          |
| 500    | `INTERNAL_ERROR`                | Unexpected error (details only in the server log)                                  |
| 503    | `DATABASE_UNAVAILABLE`          | The database is unreachable                                                        |
