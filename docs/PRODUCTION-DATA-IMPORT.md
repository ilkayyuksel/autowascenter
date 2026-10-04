# Production data import

The first real Autowascenter catalogue, exported from Lovable, lives in
`data/autowascenter-production.json` and is imported by `apps/api/src/scripts/seed.ts`.

```sh
cd apps/api
npm run db:seed -- --dry-run     # validate against the database, change nothing
npm run db:seed                  # apply
```

The export is the truth: values are written exactly as supplied, nothing is normalised,
corrected or invented. The seed runs in one transaction, upserts on the natural key
(`id` for the catalogue, `(vehicle_type_id, service_id)` for the pricing matrix) and never
deletes anything, so a second run ends in the same state and existing bookings, gallery
rows, package contents and blocked periods are untouched. Verified by
`apps/api/test/seed-production.test.ts` (16 tests on a real PostgreSQL engine).

## What the export contains

| Section                    | Rows | Goes to                 |
| -------------------------- | ---- | ----------------------- |
| `site_settings`            | 1    | `site_settings`         |
| `vehicle_types`            | 5    | `vehicle_types`         |
| `services`                 | 16   | `services`              |
| `prijzen_per_voertuigtype` | 66   | `vehicle_type_services` |
| `package_services`         | 0    | nothing written         |
| `blocked_periods`          | 0    | nothing written         |
| `gallery_items`            | 0    | nothing written         |

`bedrijf` has no database columns on purpose. The name, domain and mobile number are
frontend content and already live in `src/lib/site.ts`; only the address and city are
stored, through `site_settings` (the pricing engine measures the travel surcharge from
there). No schema change was made for this import.

The three empty sections are accepted **only while empty**. Their row shape has never been
exported, so the seed refuses a filled-in version with a clear message rather than
importing a guessed mapping. Gallery rows additionally need their image files, which is a
separate migration step.

## Resolved: the ids are not RFC-4122 UUIDs

The catalogue uses readable ids such as `11111111-1111-1111-1111-111111111101`. PostgreSQL
stores and compares those like any other `uuid`, but their variant nibble is not 8/9/a/b,
so they are not RFC-4122 valid. The API validated every id with zod's `z.uuid()`, which
enforces those bits, and that **broke the entire public booking flow** on real data:

| Request                                        | Before                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/vehicle-types/<id>/services`         | 400                                                                                |
| `GET /api/availability?vehicle_type_id=<id>&…` | 400                                                                                |
| `POST /api/bookings`                           | 400 `VALIDATION_ERROR: vehicle_type_id: Invalid UUID; service_ids.0: Invalid UUID` |

Keeping the ids was chosen over regenerating them, so that a later import of historical
Lovable bookings still resolves. `packages/shared/src/ids.ts` now holds the single id
definition, accepting exactly what a PostgreSQL `uuid` column accepts (8-4-4-4-12 hex, case
insensitive) and nothing looser: an empty string, wrong length, underscores, non-hex
characters and anything with trailing text are all still rejected. All 36 contract call
sites use it. A test pins this, including every delivered id, so it cannot be tightened
back by accident.

### The fix only takes effect once it is deployed

The id schema is compiled into **both** sides, so an older deployment keeps failing even
after the database is seeded correctly:

- the **API** rejects the id in the URL or body, which is the 400 in the table above;
- the **browser bundle** validates every response with the same shared contracts, so a
  correct `200` from `/api/vehicle-types` is thrown away client-side and the page shows
  "De voertuigtypes konden niet geladen worden." on a request that actually succeeded.

Observed on https://autowascenter.be on 2026-10-04: `/api/vehicle-types`, `/api/services`
and `/api/site-settings` all answered 200 with the seeded data, while
`/api/vehicle-types/<id>/services` and `/api/availability` answered 400, and `/reservatie`
showed the load error. The deployed bundle was confirmed to contain zod's RFC pattern
(`[89abAB]` variant class), i.e. a build from before this fix.

Deploy both images and recreate the containers:

```sh
cd /srv/autowascenter          # the repository on the server
git pull
cd deploy
docker compose build api web   # the shared contracts are baked into both
docker compose up -d api web
```

Then verify from a real browser, not only with curl -- the browser applies the response
contracts that curl does not:

```sh
E2E_BASE_URL=https://autowascenter.be npm run test:e2e
```

The suite picks the vehicle type and service from the live catalogue, so it runs against
production data as it is. Note that its booking test creates a real reservation, which you
then cancel from the admin UI.

## DATA REVIEW REQUIRED

None of these were changed. They are judgements about the business data, not bugs.

1. **A package that is not a package.** `Diep Clean Interieur + Exterieur`
   (`22222222-2222-2222-2222-222222222214`) has `category = "Pakketten"` but
   `kind = "dienst"`, and `package_services` is empty, so nothing records what it contains.
   The architecture expresses a package as `services.kind = "pakket"` plus rows in
   `package_services`. As seeded it behaves as an ordinary service: bookable, priced per
   vehicle type (€89.95–€279.95), and shown under the heading "Pakketten". Decide whether
   it should become `kind = "pakket"` with its contents listed; the seed will then carry
   that from a new export.
2. **No packages or extras at all.** Every one of the 16 services has `kind = "dienst"`.
   The `pakket` and `extra` features of the catalogue are therefore unused by this data.
3. **Two spellings of one category.** Three services use `Interieur` and one uses
   `interieur` (lowercase). Categories are grouped literally, so the site will show two
   separate groups.
4. **Opening hours disagree with the website.** `site_settings` says 10:00–21:00, and those
   hours apply to all seven days: per-weekday opening hours are a deferred schema decision,
   so there is no "closed on Sunday" anywhere in the database. The static content in
   `src/lib/site.ts` advertises 09:00–18:00 on weekdays, 09:00–17:00 on Saturday and closed
   on Sunday. Customers can currently book Sunday 20:00. Close the gap either by correcting
   the advertised hours, by blocking recurring periods, or by deciding to implement
   per-weekday hours.
5. **Walk-in services have no prices**, which is consistent: `Basiswasbeurt interieur` and
   `Basiswasbeurt exterieur` are `bookable = false` with the badge "geen afspraak nodig",
   and the pricing matrix has no rows for them. They appear on the site through
   `GET /api/services` (which lists active services and reports `bookable`), and are not
   offered as booking options.
6. **Caravan / Mobilehome is priced for 10 of the 14 bookable services.** `Velgen Coating`,
   `Ruiten Coating`, `Zetels Diepte Reiniging` and `Auto Hemel Reiniging` have no row for
   it, so they cannot be booked for a caravan (the API answers 404 `SERVICE_NOT_FOUND`).
   This looks deliberate; confirm it is.

## Re-importing after a new export

Replace `data/autowascenter-production.json` and run the seed again. Changed titles,
prices, durations and settings are updated in place; nothing is duplicated. Two things to
know:

- The export repeats the vehicle type and service titles next to the ids in the pricing
  block. The seed refuses an export where those disagree with the catalogue, because that
  means the export itself is inconsistent. A rename must appear in both places.
- Rows that disappear from the export are **not** deleted. Removing a service is a
  deliberate admin action (it affects historical bookings), not a side effect of seeding.
- Update the pinned counts in `apps/api/test/seed-production.test.ts` when the data changes.

## Status of the production database

The seed has **not** been run against the production PostgreSQL. It was executed against a
real PostgreSQL engine (PGlite, with every migration applied) in the test suite: dry run,
first run, second run, rollback on a broken reference, and the public API afterwards
including a real booking priced at €49.95 excl. VAT for 120 minutes, exactly as the pricing
matrix says.

On the server, in this order:

```sh
cd deploy
docker compose run --rm api npm run db:migrate:prod     # migrations first
docker compose run --rm api npm run db:seed -- --dry-run
docker compose run --rm api npm run db:seed
```

The script prints the target database name, host and user (never the password) before it
writes, so check it is the production database. Afterwards verify through the site itself:
the catalogue pages, a slot list, and one test reservation that is then deleted from the
admin UI.
