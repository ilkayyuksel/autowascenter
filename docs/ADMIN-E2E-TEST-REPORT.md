# Admin end-to-end test report

Executed on 2026-10-03 against the running production Docker stack from `deploy/`
(`DOMAIN=localhost`, Caddy's internal CA) and against a disposable PostgreSQL 18.6 of the
same pinned image. Nothing in the stack configuration was changed for the tests.

## The Auth0 blocker, stated plainly

**No authenticated admin browser flow could be tested.** The admin UI is protected by Auth0
Universal Login, and no real Auth0 tenant or credentials exist on this machine. The only
Auth0 values present anywhere are placeholders created during phase 9 for configuration
validation (`validation-tenant.eu.auth0.com`, `validation-client-id`), which point at a
tenant that does not exist. A browser therefore cannot complete a login.

No workaround was invented. The production authentication path was **not** weakened, no
bypass flag, no test-only login route, no relaxed verifier in the server, and the Auth0
tenant was not touched. What this costs is written out in the matrix below as **NOT RUN**.

What _is_ covered instead, and what it does and does not prove:

| Layer                                                   | How                                                                                                                                                                                                                 | Proves                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Admin page logic → API → PostgreSQL                     | `apps/api/test/admin-e2e.integration.test.ts` drives the admin frontend's OWN modules (`src/lib/api/client.ts`, `admin-reads.ts`, `admin-writes.ts`) over real HTTP against the real Fastify app on real PostgreSQL | that the code the admin pages call produces the right rows, prices and errors |
| React rendering, clicking, Auth0 redirect, admin layout | not covered                                                                                                                                                                                                         | nothing — this is the NOT RUN part                                            |
| Public site and the admin route guard in a real browser | `e2e/browser.e2e.test.ts` (Edge through playwright-core, over HTTPS via Caddy)                                                                                                                                      | that the pages render, call only the own API, and that `/admin` shows nothing |

The API verifies a real RS256 token in the integration suite too; it is only signed with a
key generated per run, through the `createLocalVerifier` seam that already existed for the
other test suites.

## Test matrix

`Browser` = driven by a real browser; `API` = the HTTP request/response; `Database` =
verified with SQL afterwards.

| Flow                                                         | Browser     | API  | Database | Status                       |
| ------------------------------------------------------------ | ----------- | ---- | -------- | ---------------------------- |
| Public home, diensten, galerij, over-ons, contact            | PASS        | PASS | n/a      | PASS                         |
| Public reservation wizard (6 steps → confirmation)           | PASS        | PASS | PASS     | PASS                         |
| Public page calls no Supabase/Lovable/wrong-origin URL       | PASS        | n/a  | n/a      | PASS                         |
| Mobile 375×667, no horizontal overflow (5 pages)             | PASS        | n/a  | n/a      | PASS                         |
| `/admin` without a session shows no admin data               | PASS        | PASS | n/a      | PASS                         |
| `/admin-login` renders without exceptions                    | PASS        | n/a  | n/a      | PASS                         |
| **Auth0 login → session → admin shell**                      | **NOT RUN** | n/a  | n/a      | **NOT RUN** (no real tenant) |
| Dashboard figures (counts, week revenue, today's list)       | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Bookings list, pagination, detail                            | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Booking create (server price/duration/schedule/token)        | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Booking move, double-booked slot → 409, self-exclusion       | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Booking service change → re-priced, snapshots replaced       | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Booking cancel (slot freed) and delete (lines cascade)       | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Availability slot list incl. `exclude_booking_id`            | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Agenda range, multi-day job, new-appointment options         | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Services create/change/delete, cleared field → NULL          | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Package content replaced as a whole; invalid id → no change  | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Vehicle types create/change/delete, duplicate slug → 409     | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Vehicle type in use cannot be deleted (RESTRICT)             | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Pricing matrix all-or-nothing; drives the booking price      | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Blocked period blocks admin slots AND a public booking       | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Settings change → slots change; invalid value → no change    | NOT RUN     | PASS | PASS     | PASS at API + database level |
| `notification_email` stored but absent from public API       | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Gallery upload → file + row, server-generated UUID name      | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Gallery wrong type (415) and too large (413): no leftovers   | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Gallery delete of a legacy EXTERNAL url touches no file      | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Admin change becomes visible/hidden on the public site       | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Public booking appears in the admin list and is confirmed    | NOT RUN     | PASS | PASS     | PASS at API + database level |
| Admin endpoints: no token 401, forged 401, no permission 403 | NOT RUN     | PASS | PASS     | PASS at API + database level |
| **Gallery upload through the admin UI's file picker**        | **NOT RUN** | PASS | PASS     | **NOT RUN** in the browser   |
| Database integrity after a mixed series of actions           | NOT RUN     | PASS | PASS     | PASS at API + database level |

"PASS at API + database level" means exactly that: the admin page's own client code, the
HTTP call and the resulting rows were verified, and the rendering was not.

## Bugs found

Both were defects in the new tests, not in the application:

1. The first version of the browser test treated a failing **image** request as a console
   error. A `gallery_items.image_url` may legitimately still be an absolute Supabase
   Storage URL — phase 7A decided deliberately not to rewrite historical URLs — so a dead
   legacy host is data, not code. The check now distinguishes the two: first-party
   resources must always load, and a wrong host is still fatal for scripts, styles and
   XHR/fetch.
2. The admin suite shared one database with `real-postgres.integration.test.ts`, and
   `node --test` runs test files in parallel, so the two truncated each other's rows. The
   admin suite now creates and uses its own `<database>_admin_e2e`.

Two near-misses worth recording, because both would have produced a false result:

- The upload directory is state as much as the database is. Until it was emptied between
  tests, a leftover file made "no file was written" fail for the wrong reason — and
  briefly looked like a storage bug after a rejected oversized upload. With proper
  isolation the oversized and wrong-type uploads leave no row and no file.
- `LocalStorageProvider.create()` makes its directories once, at server start. Removing
  the directory under a running server makes uploads answer 500. That is the correct
  production shape (a fresh Docker volume gets its directories at boot) and not a defect,
  but tests must empty the directories rather than delete them.

No application behaviour, business logic, pricing, schema or API contract was changed.

## Test data

Only test data was used. Afterwards the stack database was cleaned: the three bookings and
the one gallery row created for testing were deleted, leaving no orphan `booking_services`,
no overlaps, the singleton `site_settings`, the exclusion constraint, 25 indexes and 10
tables — the schema unchanged. The uploads volume holds 0 stored and 0 staged files and the
orphan report is empty.

One booking was left in place on purpose: `ilkay / ilhikd@live.be` on 2026-10-04, which this
session did not create. No historical or production Supabase data was touched anywhere.

## Running it again

```sh
cd deploy && docker compose up -d          # the stack must be healthy
npm run test:e2e                           # browser tests (Edge or Chrome, no download)

docker run --rm -d -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=autowascenter_test --name awc-test-db postgres:18.6-alpine
cd apps/api && TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/autowascenter_test npm test
docker rm -f awc-test-db
```

Both suites skip themselves when their prerequisite is missing, so `npm test` stays green
without Docker.

## Remaining blocker before production

The authenticated admin UI has never been opened in a browser. Before the site goes live,
run the Auth0 browser smoke test on the real domain with the real tenant: log in at
`/admin-login`, load every admin page, create and move a booking, edit the catalogue and
upload a gallery image through the file picker. That is checks 19 and 20 of the deployment
gate in `docs/HOSTINGER-DEPLOYMENT.md`, and this report does not replace them.
