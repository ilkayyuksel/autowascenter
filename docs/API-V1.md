# API v1

HTTP API of the self-hosted backend (`apps/api`).

- **Business rules**: `docs/BOOKING-BUSINESS-LOGIC.md`.
- **Implementation and operations**: `apps/api/README.md`.
- **Frontend**: the frontend does **not** use this API yet; it still talks to Supabase.

## Conventions

| Topic           | Convention                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Base path       | `/api`. Health endpoints live at `/health` and `/health/db`.                                                                |
| Success         | `{ "data": … }`                                                                                                             |
| Error           | `{ "error": { "code": "…", "message": "…" } }`. Never a stack trace, SQL or driver details.                                 |
| Field names     | `snake_case`, the same as the columns the current frontend reads                                                            |
| Money           | JSON numbers in euros, at most 2 decimals. Totals are computed server-side in integer cents.                                |
| Dates and times | `YYYY-MM-DD` and `HH:MM` are local **Europe/Brussels** values. `*_at` fields are absolute ISO-8601 instants (UTC, `Z`).     |
| Contracts       | Zod schemas: `packages/shared/src/booking.ts` (booking and availability) and `apps/api/src/contracts/public.ts` (catalogue) |
| Authentication  | None yet; all endpoints are public. Admin endpoints come with Auth0 (next phase).                                           |
| CORS            | Only the origins in `CORS_ORIGIN`; methods `GET, HEAD, POST, OPTIONS`; request header `Content-Type`                        |

## Endpoints

| Method | Path                                         | Purpose                                         |
| ------ | -------------------------------------------- | ----------------------------------------------- |
| GET    | `/health`                                    | Liveness                                        |
| GET    | `/health/db`                                 | Readiness (database)                            |
| GET    | `/api/services`                              | Active services (catalogue)                     |
| GET    | `/api/gallery`                               | Gallery items                                   |
| GET    | `/api/reviews`                               | Approved reviews                                |
| GET    | `/api/vehicle-types`                         | Active vehicle types                            |
| GET    | `/api/vehicle-types/:vehicleTypeId/services` | Bookable options with price/duration for a type |
| GET    | `/api/availability`                          | Free start times for a date and selection       |
| POST   | `/api/bookings`                              | Create a booking                                |

The catalogue and health endpoints are unchanged from phase 3 and are documented in `apps/api/README.md`.

---

## GET /api/availability

Returns the start times on which the chosen services can be done for the chosen vehicle type. The result is **informative**: `POST /api/bookings` validates everything again.

### Query

| Parameter         | Type         | Rules                                                                                  |
| ----------------- | ------------ | -------------------------------------------------------------------------------------- |
| `date`            | `YYYY-MM-DD` | A real calendar date (local Brussels)                                                  |
| `vehicle_type_id` | UUID         | An active vehicle type                                                                 |
| `service_ids`     | UUID list    | 1–50 unique ids, as `a,b,c` or as a repeated parameter (`service_ids=a&service_ids=b`) |

Unknown parameters are rejected.

### 200 response

```json
{
  "data": {
    "date": "2026-10-05",
    "vehicle_type_id": "…",
    "total_duration_minutes": 150,
    "slots": [
      {
        "time": "10:00",
        "start_at": "2026-10-05T08:00:00.000Z",
        "end_at": "2026-10-05T10:30:00.000Z",
        "pickup_date": "2026-10-05",
        "pickup_time": "12:30"
      }
    ]
  }
}
```

- `time` is the value to send as `preferred_time`.
- `end_at`, `pickup_date` and `pickup_time` give the pickup moment. For multi-day work, this is on a later day.
- A past date returns `slots: []`. On today, only starts after the current Brussels minute are returned.
- `total_duration_minutes` is the sum of the durations of the chosen services for this vehicle type.

### How slots are computed

1. The duration comes from `vehicle_type_services`, only for combinations where the service is available, active and bookable.
2. The candidate starts come from the grid `opening_hour + k × max(5, slot_interval_minutes)` in `site_settings` (single row; fallback `10:00–21:00`/30).
   - A job that fits in one day must end by closing time.
   - A longer job can only start at opening time and continues on the next calendar day(s) at opening time.
3. A start is dropped when its work overlaps:
   - a non-cancelled booking (`[start_at, end_at)`), on **any** day the work spans;
   - a blocked period on any segment day (whole day, time range, one-sided range, multi-day).
4. Capacity is 1.

### Errors

| Status | Code                     | When                                                  |
| ------ | ------------------------ | ----------------------------------------------------- |
| 400    | `VALIDATION_ERROR`       | Invalid, missing or unknown parameters, duplicate ids |
| 404    | `VEHICLE_TYPE_NOT_FOUND` | Unknown or inactive vehicle type                      |
| 404    | `SERVICE_NOT_FOUND`      | A service is not bookable for this vehicle type       |
| 503    | `DATABASE_UNAVAILABLE`   | Database unreachable                                  |
| 500    | `INTERNAL_ERROR`         | Unexpected                                            |

---

## POST /api/bookings

Creates a public booking. The client sends **only choices and customer data**. Prices, durations, totals, VAT, status, cancel token and timestamps are always computed by the server.

- **Rate limited** per client IP (default 10 requests per 60 s; see `apps/api/README.md`).
- **Body limit**: 16 KB.

### Request (`application/json`)

| Field                      | Type         | Required | Rules (same as the current frontend form)                                                        |
| -------------------------- | ------------ | -------- | ------------------------------------------------------------------------------------------------ |
| `vehicle_type_id`          | UUID         | yes      | Active vehicle type                                                                              |
| `service_ids`              | UUID[]       | yes      | 1–50, unique; at least one `dienst` or `pakket`                                                  |
| `preferred_date`           | `YYYY-MM-DD` | yes      | Local date, not in the past                                                                      |
| `preferred_time`           | `HH:MM`      | yes      | A start on the slot grid within opening hours, not in the past                                   |
| `customer_name`            | string       | yes      | Trimmed, 2–100 characters                                                                        |
| `customer_phone`           | string       | yes      | Trimmed, 6–30 characters                                                                         |
| `customer_email`           | string       | yes      | Valid e-mail, at most 255 characters                                                             |
| `vehicle_brand`            | string       | yes      | 1–60 characters                                                                                  |
| `vehicle_model`            | string       | yes      | 1–60 characters                                                                                  |
| `notes`                    | string       | no       | At most 1000 characters; `""` is stored as NULL                                                  |
| `company_name`             | string       | no       | At most 120 characters                                                                           |
| `vat_number`               | string       | no       | At most 40 characters                                                                            |
| `on_location`              | boolean      | no       | Default `false`                                                                                  |
| `location_in_sint_niklaas` | boolean      | no       | —                                                                                                |
| `location_address`         | string       | no       | At most 255 characters; **required (> 5 characters)** when `on_location` and not in Sint-Niklaas |

- **Unknown fields are rejected** with 400. That includes `total_price`, `total_duration_minutes`, `price`, `status`, `cancel_token`, `location_fee`, `start_at` and `end_at`.
- **Location fields** are stored as the frontend does today:
  - `location_in_sint_niklaas` is only kept when `on_location` is true;
  - `location_address` is only kept when `on_location` is true and the address is outside Sint-Niklaas.

### 201 response

```json
{
  "data": {
    "id": "…",
    "status": "nieuw",
    "preferred_date": "2026-10-05",
    "preferred_time": "10:00",
    "start_at": "2026-10-05T08:00:00.000Z",
    "end_at": "2026-10-05T10:00:00.000Z",
    "pickup_date": "2026-10-05",
    "pickup_time": "12:00",
    "total_duration_minutes": 120,
    "services": [
      { "service_id": "…", "title": "Ozon", "kind": "extra", "price": 75, "duration_minutes": 60 },
      {
        "service_id": "…",
        "title": "Wax",
        "kind": "dienst",
        "price": 74.75,
        "duration_minutes": 60
      }
    ],
    "pricing": {
      "services_subtotal": 149.75,
      "location_fee": 0,
      "total_excl_vat": 149.75,
      "vat_rate": 0.21,
      "vat": 31.45,
      "total_incl_vat": 181.2,
      "currency": "EUR"
    }
  }
}
```

**Pricing fields**

| Field               | Meaning                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `services_subtotal` | Σ `vehicle_type_services.price` of the chosen services, excl. VAT                                                            |
| `location_fee`      | Always 0 today, the same as the current application                                                                          |
| `total_excl_vat`    | `services_subtotal + location_fee`. This is the value stored in `bookings.total_price`; its meaning (excl. VAT) is unchanged |
| `vat`               | 21 % of `total_excl_vat`, rounded half-up to cents. Not stored                                                               |
| `total_incl_vat`    | `total_excl_vat + vat`. Not stored                                                                                           |

**Services**: ordered by title. This is also the order used for the legacy columns `service_id` (the first line) and `service_title` (titles joined with `", "`).

The response never contains the cancel token or any other secret.

### Transaction behaviour

Everything runs in **one database transaction**:

1. Resolve the vehicle type and services, and read prices and durations from the database.
2. Compute the price and duration.
3. Validate opening hours, the slot grid and "not in the past", then compute `start_at` and `end_at`.
4. Check blocked periods and overlapping bookings.
5. Insert `bookings` with `status = 'nieuw'`. `cancel_token` comes from the database default.
6. Insert the `booking_services` snapshot rows.
7. Commit.

Any error rolls back the whole transaction, so no half booking is ever stored.

### Concurrency

- The pre-check in step 4 gives a friendly 409 in the normal case.
- The final guard is the PostgreSQL exclusion constraint `bookings_no_overlap_excl`: `tstzrange(start_at, end_at, '[)')` must not overlap for non-cancelled bookings.
- When two requests race for the same slot, one commits and the other's insert fails with SQLSTATE `23P01`. That failure becomes **409 `BOOKING_SLOT_UNAVAILABLE`**. Two successes are impossible.
- A double click on the current frontend's submit button sends two identical requests. The second one gets 409 for the same reason; no idempotency column exists.

### Errors

| Status | Code                            | When                                                                         |
| ------ | ------------------------------- | ---------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`              | Invalid, missing or unknown fields; duplicate `service_ids`                  |
| 400    | `BAD_REQUEST`                   | Malformed JSON, body larger than 16 KB (413) or unsupported media type (415) |
| 404    | `VEHICLE_TYPE_NOT_FOUND`        | Unknown or inactive vehicle type                                             |
| 404    | `SERVICE_NOT_FOUND`             | A service is unknown, inactive, walk-in only or unavailable for this type    |
| 409    | `BOOKING_SLOT_UNAVAILABLE`      | Overlapping booking or blocked period, including a concurrent race           |
| 422    | `BOOKING_OUTSIDE_OPENING_HOURS` | Before opening, work not fitting the window, or not on the slot grid         |
| 422    | `BOOKING_IN_PAST`               | Date or time before "now" in Europe/Brussels                                 |
| 422    | `MAIN_SERVICE_REQUIRED`         | Only extras chosen                                                           |
| 429    | `RATE_LIMITED`                  | Rate limit exceeded                                                          |
| 503    | `DATABASE_UNAVAILABLE`          | Database unreachable                                                         |
| 500    | `INTERNAL_ERROR`                | Unexpected (details only in the server log)                                  |

## Time zone

- **Input**: every business calculation uses `Europe/Brussels`. `preferred_date`/`preferred_time`, the opening hours and the blocked periods are local wall-clock values.
- **Today and now**: derived from the server clock through `Intl` in Europe/Brussels, not from UTC.
- **Stored timestamps**: `start_at`/`end_at` get the correct CET or CEST offset for their own date. The database enforces `start_at = (preferred_date + preferred_time) AT TIME ZONE 'Europe/Brussels'`.
- **DST**: slot times stay local across a change (a "10:00" slot is 10:00 local on both sides). Local times that do not exist or exist twice (02:00–03:00 on transition days) are never offered.
