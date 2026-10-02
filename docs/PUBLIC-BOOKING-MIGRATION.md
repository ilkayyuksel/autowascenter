# Public Booking Migration

Phase 7B moved the public `/reservatie` submit from two direct Supabase inserts to the existing, tested `POST /api/bookings` (phase 4). No new booking, pricing or availability engine was built.

The runtime architecture is now:

```
PUBLIC → own API → PostgreSQL
ADMIN  → Auth0 → own API → PostgreSQL / local storage
```

## Form

`src/routes/reservatie.tsx` keeps its six steps and its UX:

| Step | What happens                                                                                                                                                     | Source                                |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1    | Choose the vehicle type                                                                                                                                          | `GET /api/vehicle-types`              |
| 2–3  | Choose services, packages and extras                                                                                                                             | `GET /api/vehicle-types/:id/services` |
| 4    | Choose the date and a free slot                                                                                                                                  | `GET /api/availability`               |
| 5    | Customer details (react-hook-form + Zod): name, phone, **e-mail (required, validated)**, brand, model, notes, company/VAT, on location (Sint-Niklaas or address) | —                                     |
| 6    | Confirm                                                                                                                                                          | —                                     |

**Before 7B (removed)**: `supabase.from("bookings").insert(...)` with client-computed `end_time`, `total_duration_minutes`, `total_price`, `location_fee`, `service_title`, `status`, followed by a **separate** `supabase.from("booking_services").insert(...)` with client price/duration/title snapshots. These were two non-atomic writes, with every value trusted from the browser.

**Now**: one `POST /api/bookings`.

- The submit button is disabled and shows "Versturen..." while sending.
- A guard (`createSubmitGuard`) also ignores a second click or Enter while a request is running.
- A reset or leaving the page invalidates a running submission, so a late response can never show a stale success.
- After success, the existing confirmation is shown, now with the **server's** values: reference (first 8 characters of the booking id), drop-off, pickup and total incl. VAT. "Nieuwe reservatie" resets the wizard.

## API client

- The existing central client (`src/lib/api/client.ts`) got a public `post()`: JSON, **never** an `Authorization` header (the endpoint is public; no Auth0, no login for customers).
- The typed helpers live in `src/lib/api/public-writes.ts`:
  - `toPublicBookingRequest()`: explicit form → request mapper;
  - `createPublicBooking()`;
  - `describePublicBookingError()`;
  - `bookingConfirmation()`;
  - `createSubmitGuard()`.
- There is no `fetch` in the page itself. The client's timeout (15 s) applies.

## Request contract

The shared `bookingRequestSchema` (`packages/shared/src/booking.ts`) is a strict object, used by both the backend and the browser. It allows exactly:

| Field                                 | Source in the form                                                     | Notes                                      |
| ------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| `vehicle_type_id`                     | step 1                                                                 | the only vehicle identifier (no title)     |
| `service_ids`                         | `service_id` of the chosen options (not the vehicle_type_services ids) | no titles, prices or durations             |
| `preferred_date`                      | step 4 date (`yyyy-MM-dd`, local)                                      | no `toISOString()`, no timezone conversion |
| `preferred_time`                      | step 4 slot (`HH:mm`, from the availability response)                  |                                            |
| `customer_name`                       | step 5                                                                 |                                            |
| `customer_email`                      | step 5, **required**                                                   | no placeholder address                     |
| `customer_phone`                      | step 5                                                                 |                                            |
| `vehicle_brand`, `vehicle_model`      | step 5                                                                 |                                            |
| `notes`, `company_name`, `vat_number` | step 5                                                                 | omitted when blank                         |
| `on_location`                         | step 5                                                                 | always sent                                |
| `location_in_sint_niklaas`            | step 5                                                                 | only when on location                      |
| `location_address`                    | step 5                                                                 | only when on location outside Sint-Niklaas |

Nothing else can be sent. The mapper builds the body field by field (no spreading of form state), and the body is validated with the shared contract **before** sending. Because the contract is strict, `total_price`, `total_excl_vat`, `total_incl_vat`, `vat`, `duration`, `total_duration_minutes`, `location_fee`, `location_distance_km`, `status`, `cancel_token`, `start_at`, `end_at`, `pickup_date`, `pickup_time`, `service_title`, `price` or `end_time` are rejected in the browser, and again with 400 by the server.

A package plus a service that is already in it is sent as both ids, and the server charges both (phase 4 rule, unchanged).

## Server-side pricing

The final price comes only from the server, using the same pricing engine as the admin bookings:

- per-type prices from `vehicle_type_services`;
- the location fee;
- VAT 21 %;
- totals in cents.

The wizard's running totals (steps 2–6) remain an **indication** computed from the per-type prices for display. They are never sent, and the confirmation shows `pricing.total_incl_vat` from the response.

## Server-side availability

`GET /api/availability` (phase 7A) is only a **preflight** to offer slots. `POST /api/bookings` checks everything again inside its transaction with the same rules:

- vehicle type active;
- services bookable/active/available for that type;
- opening hours and slot grid;
- not in the past;
- blocked periods;
- overlap with other bookings, including multi-day work.

A slot shown earlier can therefore still be refused (409). API test `public-booking-consistency.test.ts` verifies that an offered slot can be booked, that the booked slot disappears from the availability and is refused afterwards, and that an off-grid time is refused.

## Server-side validation

Customer fields use the same rules and Dutch messages as the form (shared schema). The browser validates for UX: the react-hook-form step plus the contract check before sending. The server validates again and is authoritative.

## Transaction

One request results in one database transaction on the server:

- `bookings` (with server-computed `start_at`, `end_at`, duration, totals, `location_fee`, `status = 'nieuw'`, and a generated `cancel_token`);
- **plus** the `booking_services` snapshots (title, price and duration per service).

The frontend never writes `booking_services` and never generates a cancel token. The token is not returned, and there is no cancellation UI (out of scope).

## Concurrency

Two customers booking the same slot: the transaction re-checks the overlap, and the PostgreSQL exclusion constraint (`bookings_no_overlap_excl`) is the final guard. The second request gets **409 `BOOKING_SLOT_UNAVAILABLE`**. In the browser, double clicks are blocked by the submit guard.

## Error handling

`describePublicBookingError` maps errors to fixed Dutch texts: no backend messages, URLs, stack traces or database details.

| Response                                                          | UI                                                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Contract check fails in the browser (e.g. e-mail missing/invalid) | Field message on the form, back to step 5 (or 4 for vehicle/services/slot); nothing sent                                |
| 400 `VALIDATION_ERROR`                                            | "Controleer uw gegevens." → step 5                                                                                      |
| 404 `VEHICLE_TYPE_NOT_FOUND` / `SERVICE_NOT_FOUND`                | "…niet meer beschikbaar. Maak opnieuw een keuze." → step 1                                                              |
| 409 `BOOKING_SLOT_UNAVAILABLE`                                    | "Dit tijdstip is intussen niet meer beschikbaar…" → step 4; the slot is cleared and `GET /api/availability` is reloaded |
| 422 `BOOKING_OUTSIDE_OPENING_HOURS` / `BOOKING_IN_PAST`           | Planning message → step 4, availability reloaded                                                                        |
| 429 `RATE_LIMITED`                                                | "Te veel aanvragen na elkaar…"                                                                                          |
| Network error / timeout                                           | "Geen verbinding met de server…", the customer can retry                                                                |
| 500 / 503 / unexpected response                                   | "Er ging iets mis bij het verwerken van je reservatie. Probeer het opnieuw."                                            |

There is no Supabase fallback.

## Success response

`201 { data: { id, status: "nieuw", preferred_date, preferred_time, start_at, end_at, pickup_date, pickup_time, total_duration_minutes, services[], pricing{ services_subtotal, location_fee, total_excl_vat, vat_rate, vat, total_incl_vat, currency } } }`

The response is validated with `bookingCreatedResponseSchema`. The confirmation uses it as is (`bookingConfirmation()`); no price, duration or time is reconstructed in the browser.

The admin API sees the same booking: `GET /api/admin/bookings/:id` returns the same times, totals and service lines (API test).

## Historical Supabase bookings

**NOT MIGRATED.**

- Bookings made before this phase, and those made through the public site during phase 7A, remain in Supabase.
- From now on new bookings are stored in the self-hosted PostgreSQL.
- Historical data is migrated separately later (see `docs/DATABASE-MIGRATION-MAP.md`). Until then, availability does not know about those older Supabase bookings.

## Remaining legacy files

No runtime code reads from or writes to Supabase any more. What remains is unused or legacy, for the controlled cleanup in phase 7C:

| File                                                                       | Status                                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/lib/slots.ts`                                                         | UNUSED: no importer left (admin since 6D-2, public since 7A/7B); still imports the Supabase client |
| `src/integrations/supabase/client.ts`, `previewAuthStorage.ts`, `types.ts` | LEGACY: only imported by the unused `slots.ts`                                                     |
| `src/integrations/supabase/client.server.ts`, `auth-middleware.ts`         | UNUSED Lovable templates                                                                           |
| `supabase/` (migrations, config)                                           | LEGACY schema history                                                                              |
| `@supabase/supabase-js` (root `package.json`)                              | No runtime use; removed in 7C                                                                      |
| `.env.example` `VITE_SUPABASE_*`                                           | Removed in 7C                                                                                      |

## Tests

- **Frontend** (`src/lib/api/public-writes.test.ts`, 20 tests):
  - one POST to `/api/bookings` with a JSON body and no Authorization header;
  - the exact payload, with a security test that no server-only field is ever sent and that smuggled fields are rejected before sending;
  - response parsing; 400/409/422/500/503, malformed response, timeout;
  - location mapping, service ids (package + included service);
  - customer e-mail missing/empty/invalid → refused with a field error, valid → sent unchanged;
  - error texts per status, network/timeout/abort/rate limit;
  - double-submit protection (two rapid submits → one request), stale results after a reset;
  - confirmation from the server's 100/21/121.
- `client.test.ts`: public `post()` never sends a token.
- `public-pages.test.ts`: `/reservatie` has no Supabase import and exactly one `createPublicBooking` call.
- **API** (`apps/api/test/public-booking-consistency.test.ts`, 3 tests): admin consistency, availability preflight vs. booking, server-only fields → 400.

## Manual browser test

Prerequisites: API with a database and catalogue data, frontend with `VITE_API_BASE_URL`. Watch the network tab: there must be no request to `supabase.co`.

1. Open `/reservatie`.
2. Choose a vehicle type.
3. Choose service(s).
4. Choose a package (contents listed) and test it together with a service it already contains (both are charged).
5. Choose a date.
6. Choose a free slot.
7. Fill in the customer details.
8. Leave the e-mail empty or invalid → field error, no request.
9. Submit → one `POST /api/bookings` without `Authorization`; the payload contains only contract fields.
10. Check the success state: reference, drop-off, pickup and total incl. VAT match the response.
11. Check the booking in the admin (`/admin/reservaties`, detail = `GET /api/admin/bookings/:id`).
12. Start a new booking for the same date: the booked slot is no longer offered.
13. Occupied slot: book the same slot in a second tab → "intussen niet meer beschikbaar", the slots reload.
14. Double-click "Bevestig reservatie" → only one request.
15. Stop the API and submit → network error message, retry possible.

**Executed**: none of these browser steps was executed in this phase. No running API with a database was available in the development environment. Steps 9–14 are covered by the automated frontend and API tests listed above.
