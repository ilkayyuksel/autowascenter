// ADMIN END-TO-END on real PostgreSQL: the ADMIN FRONTEND'S OWN client modules
// (src/lib/api/client.ts, admin-reads.ts, admin-writes.ts, public-writes.ts) driven over
// REAL HTTP against the real Fastify app on a real PostgreSQL server, with the result
// verified in the database with SQL.
//
// This is the chain "admin page code → API client → HTTP → Fastify → PostgreSQL → response
// the page renders". What it deliberately does NOT cover is the browser half: React
// rendering, clicking and the Auth0 Universal Login redirect. Those need a real Auth0
// tenant, which is not available here, so the authenticated admin BROWSER flows are
// reported as NOT RUN -- see e2e/browser.e2e.test.ts for what the browser does cover.
// No production-auth bypass is invented: the API verifies a real RS256 token here too,
// only signed with a per-run test key through the existing createLocalVerifier seam.
//
// Skipped unless TEST_DATABASE_URL points at a DISPOSABLE database (it is truncated
// between tests):
//
//   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=autowascenter_test --name awc-test-db postgres:18.6-alpine
//   TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/autowascenter_test npm test
//
// It runs in its OWN database, "<given database>_admin_e2e", created on first use: node
// --test runs test FILES IN PARALLEL, so sharing one database with
// real-postgres.integration.test.ts would let the two suites truncate each other's rows.
//
// WARNING: never point this at production.

import assert from "node:assert/strict";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { createApiClient, ApiError, type ApiClient } from "../../../src/lib/api/client.ts";
import {
  loadAgenda,
  loadAgendaVehicleOptions,
  loadBlockedPeriods,
  loadBookingDetail,
  loadBookingsPage,
  loadDashboard,
  loadGallery,
  loadServices,
  loadSettings,
  loadVehiclesPage,
} from "../../../src/lib/api/admin-reads.ts";
import {
  bookingPriceSummary,
  changedFields,
  createAdminBooking,
  createAdminService,
  createAdminVehicleType,
  createBlockedPeriod,
  createGalleryItem,
  deleteAdminBooking,
  deleteAdminService,
  deleteAdminVehicleType,
  deleteBlockedPeriod,
  deleteGalleryItem,
  loadAdminAvailability,
  RequestValidationError,
  updateAdminBooking,
  updateAdminPricing,
  updateAdminService,
  updateAdminVehicleType,
  updateGalleryItem,
  updatePackageContent,
  updateSettings,
  uploadGalleryImage,
} from "../../../src/lib/api/admin-writes.ts";
import { createPublicBooking, toPublicBookingRequest } from "../../../src/lib/api/public-writes.ts";
import { createApp } from "../src/app.ts";
import { schema, type Database } from "../src/db/index.ts";
import { LocalStorageProvider } from "../src/storage/local-storage-provider.ts";
import { createTestAuth, type TestAuth } from "./helpers/auth.ts";
import { NOW, seedCatalog, type Catalog } from "./helpers/fixtures.ts";
import { JPEG, SVG, tempDir } from "./helpers/uploads.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));
const skip = TEST_DATABASE_URL
  ? false
  : "set TEST_DATABASE_URL to a disposable PostgreSQL (see the header of this file)";

const TABLES = [
  "bookings",
  "booking_services",
  "package_services",
  "vehicle_type_services",
  "services",
  "vehicle_types",
  "blocked_periods",
  "site_settings",
  "gallery_items",
  "reviews",
];

const UPLOAD_BASE = "https://autowascenter.test/uploads";
const MAX_UPLOAD_BYTES = 4096;
/** Thursday 2026-10-01 is "today"; this Friday is inside the dashboard's week. */
const FRIDAY = "2026-10-02";
/** Next Monday, outside the current week and far from any seeded booking. */
const MONDAY = "2026-10-05";
const EXTERNAL_IMAGE =
  "https://abcd1234.supabase.co/storage/v1/object/public/gallery/legacy-photo.jpg";

let pool: pg.Pool;
let db: Database;
let app: FastifyInstance;
let auth: TestAuth;
let uploadRoot: string;
let removeUploadRoot: () => Promise<void>;
let baseUrl: string;
let c: Catalog;

/** The client an authenticated admin page uses. */
let api: ApiClient;
/** No token at all: what a logged-out browser would send. */
let anon: ApiClient;
/** A well-formed token signed with a key that is not in the JWKS. */
let forged: ApiClient;
/** A valid token without the admin:access permission. */
let noPermission: ApiClient;

/**
 * Creates (once) and returns the URL of this suite's own database, so a parallel test file
 * cannot truncate our rows halfway through a test.
 */
async function ownDatabase(url: string): Promise<string> {
  const target = new URL(url);
  const name = `${decodeURIComponent(target.pathname.slice(1))}_admin_e2e`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    const existing = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [name]);
    if (existing.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  target.pathname = `/${encodeURIComponent(name)}`;
  return target.toString();
}

/** Unlinks every stored and staged file, keeping the directories themselves. */
async function emptyUploads() {
  for (const area of ["gallery", ".staging"]) {
    const dir = join(uploadRoot, area);
    for (const name of await readdir(dir).catch(() => [])) {
      await rm(join(dir, name), { force: true });
    }
  }
}

const rows = async (sql: string, params: unknown[] = []) =>
  (await pool.query(sql, params)).rows as Record<string, unknown>[];
const one = async (sql: string, params: unknown[] = []) => (await rows(sql, params))[0];
const count = async (sql: string, params: unknown[] = []) =>
  Number(Object.values((await one(sql, params)) ?? { n: 0 })[0]);

/** Asserts the call fails with an ApiError and returns it. */
async function failsWith(fn: () => Promise<unknown>, status: number, code?: string) {
  const error = await fn().then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(error instanceof ApiError, `expected an ApiError, got ${String(error)}`);
  assert.equal(error.status, status, `code was ${error.code}: ${error.message}`);
  if (code) assert.equal(error.code, code);
  return error;
}

const customer = {
  customer_name: "E2E Admin Test",
  customer_email: "e2e-admin@example.test",
  customer_phone: "0470000002",
};

/** Books through the admin API exactly as BookingCreateDialog does. */
const bookAdmin = (overrides: Partial<Parameters<typeof createAdminBooking>[1]> = {}) =>
  createAdminBooking(api, {
    vehicle_type_id: c.vehicleTypes.sedan.id,
    service_ids: [c.services.wax.id],
    preferred_date: MONDAY,
    preferred_time: "10:00",
    ...customer,
    ...overrides,
  });

describe("admin end-to-end on real PostgreSQL", { skip }, () => {
  before(async () => {
    pool = new pg.Pool({ connectionString: await ownDatabase(TEST_DATABASE_URL!), max: 10 });
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
    db = drizzle(pool, { schema }) as unknown as Database;

    auth = await createTestAuth();
    ({ dir: uploadRoot, remove: removeUploadRoot } = await tempDir());
    app = await createApp({
      db,
      corsOrigins: ["http://localhost:8080"],
      logLevel: "silent",
      clock: () => NOW,
      tokenVerifier: auth.verifier,
      storage: await LocalStorageProvider.create({
        rootDir: uploadRoot,
        publicBaseUrl: UPLOAD_BASE,
      }),
      uploads: { maxBytes: MAX_UPLOAD_BYTES, rateLimit: { max: 1000, timeWindowMs: 60_000 } },
      bookingRateLimit: { max: 1000, timeWindowMs: 60_000 },
    });
    // A real socket, so the frontend's fetch-based client is exercised as in the browser.
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    assert.ok(address && typeof address === "object", "expected a TCP address");
    baseUrl = `http://127.0.0.1:${address.port}`;

    api = createApiClient({ baseUrl, getAccessToken: () => auth.token() });
    anon = createApiClient({ baseUrl });
    forged = createApiClient({ baseUrl, getAccessToken: () => auth.foreignToken() });
    noPermission = createApiClient({
      baseUrl,
      getAccessToken: () => auth.token({ permissions: [] }),
    });
  });

  after(async () => {
    await app?.close();
    await pool?.end();
    await removeUploadRoot?.();
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${TABLES.join(", ")} CASCADE`);
    // The stored files are state too: without this, a leftover from an earlier test would
    // make a "no file was written" assertion pass or fail for the wrong reason. Empty the
    // directories instead of removing them: LocalStorageProvider.create() makes them once,
    // at server start (which is also how a fresh Docker volume gets them).
    await emptyUploads();
    c = await seedCatalog(db);
  });

  // ------------------------------------------------------------------ dashboard

  describe("dashboard (/admin)", () => {
    test("every number the dashboard shows matches the database", async () => {
      await bookAdmin({ preferred_date: FRIDAY, preferred_time: "10:00" });
      await bookAdmin({ preferred_date: FRIDAY, preferred_time: "12:00" });
      await createGalleryItem(api, { image_url: EXTERNAL_IMAGE, title: "Legacy" });

      const view = await loadDashboard(api);

      assert.equal(view.today, "2026-10-01", "today is derived from the injected clock");
      assert.equal(view.week_start, "2026-09-28", "week starts on Monday");
      assert.equal(view.week_end, "2026-10-04");

      assert.equal(
        view.counts.active_services,
        await count(`SELECT count(*) FROM services WHERE active`),
      );
      assert.equal(
        view.counts.active_vehicle_types,
        await count(`SELECT count(*) FROM vehicle_types WHERE active`),
      );
      assert.equal(view.counts.gallery_items, await count(`SELECT count(*) FROM gallery_items`));

      assert.equal(view.week.booking_count, 2, "both bookings start inside the week");
      const revenue = Number(
        (
          await one(
            `SELECT coalesce(sum(total_price), 0) AS s FROM bookings
             WHERE status <> 'geannuleerd' AND start_at >= $1 AND start_at < $2`,
            ["2026-09-27T22:00:00Z", "2026-10-04T22:00:00Z"],
          )
        )?.s,
      );
      assert.equal(view.week.revenue_excl_vat, revenue);
      assert.equal(view.week.days.length, 7, "one entry per day of the week");
      const friday = view.week.days.find((d) => d.date === FRIDAY);
      assert.equal(friday?.booking_count, 2);
    });

    test("a cancelled booking leaves the week's revenue", async () => {
      const booking = await bookAdmin({ preferred_date: FRIDAY, preferred_time: "10:00" });
      const before = await loadDashboard(api);
      assert.ok(before.week.revenue_excl_vat > 0);

      await updateAdminBooking(api, booking.id, { status: "geannuleerd" });

      const afterCancel = await loadDashboard(api);
      assert.equal(afterCancel.week.revenue_excl_vat, 0);
      assert.equal(afterCancel.week.booking_count, 0);
      assert.equal(
        await count(`SELECT count(*) FROM bookings WHERE status = 'geannuleerd'`),
        1,
        "cancelling keeps the row (it is not a delete)",
      );
    });
  });

  // ------------------------------------------------------------------ bookings

  describe("bookings (/admin/reservaties)", () => {
    test("creating stores the booking with SERVER-computed price, duration and schedule", async () => {
      const created = await bookAdmin();

      const row = await one(
        `SELECT *, preferred_date::text AS date_text FROM bookings WHERE id = $1`,
        [created.id],
      );
      assert.ok(row, "the booking must exist in PostgreSQL");
      assert.equal(row.customer_email, customer.customer_email);
      assert.equal(row.date_text, MONDAY);
      assert.equal(String(row.preferred_time), "10:00:00");
      assert.equal(row.status, "bevestigd", "the dialog's default");
      // Sedan + Wax = 74.75 for 60 minutes (the pricing matrix, not the legacy base price).
      assert.equal(Number(row.total_price), 74.75);
      assert.equal(row.total_duration_minutes, 60);
      assert.equal(
        (row.start_at as Date).toISOString(),
        "2026-10-05T08:00:00.000Z",
        "10:00 Brussels (CEST) = 08:00Z",
      );
      assert.equal((row.end_at as Date).toISOString(), "2026-10-05T09:00:00.000Z");
      assert.ok(row.cancel_token, "the server generates a cancel token");

      const lines = await rows(`SELECT * FROM booking_services WHERE booking_id = $1`, [
        created.id,
      ]);
      assert.equal(lines.length, 1, "one service snapshot");
      assert.equal(lines[0]!.service_id, c.services.wax.id);
      assert.equal(Number(lines[0]!.price), 74.75);

      // The response the page renders carries the server's pricing, incl. 21% VAT.
      const summary = bookingPriceSummary(created.pricing);
      assert.equal(summary.subtotal, 74.75);
      assert.equal(summary.vat, Number((74.75 * 0.21).toFixed(2)));
      assert.equal(summary.total, Number((74.75 * 1.21).toFixed(2)));
    });

    test("the frontend cannot send a price, a duration or a schedule", async () => {
      // The shared contract is strict, so admin-writes.ts refuses before anything is sent.
      for (const forbidden of [
        { total_price: 1 },
        { total_duration_minutes: 5 },
        { start_at: "2026-10-05T08:00:00Z" },
        { cancel_token: "x" },
        { status: "geannuleerd" },
      ]) {
        await assert.rejects(
          () => bookAdmin(forbidden as never),
          RequestValidationError,
          `${Object.keys(forbidden)[0]} must be rejected client-side`,
        );
      }
      assert.equal(await count(`SELECT count(*) FROM bookings`), 0, "nothing was sent");

      // And the API refuses it too, for a client that does not use admin-writes.ts.
      await failsWith(
        () =>
          api.postAdmin(
            "/api/admin/bookings",
            {
              vehicle_type_id: c.vehicleTypes.sedan.id,
              service_ids: [c.services.wax.id],
              preferred_date: MONDAY,
              preferred_time: "10:00",
              ...customer,
              total_price: 1,
            },
            { safeParse: (v: unknown) => ({ success: true as const, data: v }) },
          ),
        400,
        "VALIDATION_ERROR",
      );
      assert.equal(await count(`SELECT count(*) FROM bookings`), 0);
    });

    test("the list and the detail show what the database holds", async () => {
      const a = await bookAdmin({ preferred_time: "10:00" });
      await bookAdmin({ preferred_time: "12:00", customer_name: "Tweede Klant" });

      const page = await loadBookingsPage(api, { page: 1, limit: 50 });
      assert.equal(page.meta.total, 2);
      assert.equal(page.items.length, 2);
      const row = page.items.find((b) => b.id === a.id);
      assert.equal(row?.total_price, 74.75);
      assert.equal(row?.pickup_label, "11:00", "same-day pickup shows just the time");

      const detail = await loadBookingDetail(api, a.id);
      assert.equal(detail.vehicle_type_id, c.vehicleTypes.sedan.id);
      assert.equal(detail.vehicle_type_title, "Sedan");
      assert.deepEqual(
        detail.lines.map((l) => [l.service_title, l.price, l.duration_minutes]),
        [["Wax", 74.75, 60]],
      );

      // Pagination: page 2 of a 1-per-page list.
      const second = await loadBookingsPage(api, { page: 2, limit: 1 });
      assert.equal(second.items.length, 1);
      assert.equal(second.meta.total, 2);
      assert.notEqual(
        second.items[0]!.id,
        (await loadBookingsPage(api, { page: 1, limit: 1 })).items[0]!.id,
      );
    });

    test("moving a booking re-computes the schedule; a taken slot is refused", async () => {
      const booking = await bookAdmin({ preferred_time: "10:00" });

      const moved = await updateAdminBooking(api, booking.id, {
        preferred_date: MONDAY,
        preferred_time: "14:00",
      });
      assert.equal(moved.preferred_time, "14:00");
      const row = await one(`SELECT start_at, end_at FROM bookings WHERE id = $1`, [booking.id]);
      assert.equal((row!.start_at as Date).toISOString(), "2026-10-05T12:00:00.000Z");
      assert.equal((row!.end_at as Date).toISOString(), "2026-10-05T13:00:00.000Z");

      // A second booking on the now-occupied slot is refused by the exclusion constraint.
      await failsWith(
        () => bookAdmin({ preferred_time: "14:00" }),
        409,
        "BOOKING_SLOT_UNAVAILABLE",
      );
      assert.equal(await count(`SELECT count(*) FROM bookings`), 1, "no second row");

      // Moving onto its own slot is allowed (the booking excludes itself).
      const again = await updateAdminBooking(api, booking.id, { preferred_time: "14:00" });
      assert.equal(again.preferred_time, "14:00");
    });

    test("changing the services re-prices and replaces the snapshots", async () => {
      const booking = await bookAdmin();

      const updated = await updateAdminBooking(api, booking.id, {
        service_ids: [c.services.wax.id, c.services.interior.id],
      });

      // 74.75 + 55.00 = 129.75 excl. VAT; 60 + 90 = 150 minutes.
      assert.equal(updated.pricing.total_excl_vat, 129.75);
      assert.equal(updated.total_duration_minutes, 150);
      const row = await one(
        `SELECT total_price, total_duration_minutes, end_at FROM bookings WHERE id = $1`,
        [booking.id],
      );
      assert.equal(Number(row!.total_price), 129.75);
      assert.equal(row!.total_duration_minutes, 150);
      assert.equal((row!.end_at as Date).toISOString(), "2026-10-05T10:30:00.000Z");

      const lines = await rows(
        `SELECT service_title FROM booking_services WHERE booking_id = $1 ORDER BY service_title`,
        [booking.id],
      );
      assert.deepEqual(
        lines.map((l) => l.service_title),
        ["Interieur", "Wax"],
        "the old snapshot is replaced, not appended",
      );
    });

    test("cancelling frees the slot; deleting removes the booking and its lines", async () => {
      const booking = await bookAdmin({ preferred_time: "10:00" });
      await updateAdminBooking(api, booking.id, { status: "geannuleerd" });

      // The exclusion constraint ignores cancelled bookings, so the slot is bookable again.
      const replacement = await bookAdmin({ preferred_time: "10:00" });
      assert.notEqual(replacement.id, booking.id);

      await deleteAdminBooking(api, booking.id);
      assert.equal(await count(`SELECT count(*) FROM bookings WHERE id = $1`, [booking.id]), 0);
      assert.equal(
        await count(`SELECT count(*) FROM booking_services WHERE booking_id = $1`, [booking.id]),
        0,
        "the service lines cascade",
      );
      assert.equal(
        await count(`SELECT count(*) FROM bookings WHERE id = $1`, [replacement.id]),
        1,
        "the other booking is untouched",
      );
    });

    test("a booking that does not exist gives 404, not a crash", async () => {
      const missing = "11111111-1111-4111-8111-111111111111";
      await failsWith(() => loadBookingDetail(api, missing), 404);
      await failsWith(() => updateAdminBooking(api, missing, { status: "voltooid" }), 404);
      await failsWith(() => deleteAdminBooking(api, missing), 404);
    });
  });

  // ------------------------------------------------------------------ availability

  describe("availability (the booking dialog's slot list)", () => {
    test("the server decides which slots are free", async () => {
      const free = await loadAdminAvailability(api, {
        date: MONDAY,
        vehicle_type_id: c.vehicleTypes.sedan.id,
        service_ids: [c.services.wax.id],
      });
      assert.equal(free.date, MONDAY);
      assert.equal(free.total_duration_minutes, 60);
      assert.ok(
        free.slots.some((s) => s.time === "10:00"),
        "the day opens at 10:00",
      );
      assert.ok(
        free.slots.every((s) => s.time <= "17:00"),
        "a 60-minute job cannot start after 17:00 with an 18:00 close",
      );
      assert.equal(free.slots[0]!.pickup_time, "11:00", "the server computes the pickup moment");

      const booking = await bookAdmin({ preferred_time: "10:00" });
      const after = await loadAdminAvailability(api, {
        date: MONDAY,
        vehicle_type_id: c.vehicleTypes.sedan.id,
        service_ids: [c.services.wax.id],
      });
      assert.ok(!after.slots.some((s) => s.time === "10:00"), "the taken slot is gone");

      // Editing that booking must offer its own slot again.
      const moving = await loadAdminAvailability(api, {
        date: MONDAY,
        vehicle_type_id: c.vehicleTypes.sedan.id,
        service_ids: [c.services.wax.id],
        exclude_booking_id: booking.id,
      });
      assert.ok(moving.slots.some((s) => s.time === "10:00"));
      assert.equal(moving.exclude_booking_id, booking.id);
    });
  });

  // ------------------------------------------------------------------ agenda

  describe("agenda (/admin/agenda)", () => {
    test("shows the bookings and blocked periods of the range", async () => {
      const booking = await bookAdmin({ preferred_time: "10:00" });
      const period = await createBlockedPeriod(api, {
        start_date: "2026-10-07",
        end_date: "2026-10-08",
        reason: "E2E vakantie",
      });

      const view = await loadAgenda(api, { start: "2026-10-05", end: "2026-10-10" });
      assert.equal(view.bookings.length, 1);
      assert.equal(view.bookings[0]!.id, booking.id);
      assert.equal(view.bookings[0]!.same_day_end_time, "11:00");
      assert.equal(view.bookings[0]!.ends_later, false);
      assert.deepEqual(
        view.blocked.map((b) => b.id),
        [period.id],
      );

      const empty = await loadAgenda(api, { start: "2026-11-01", end: "2026-11-05" });
      assert.deepEqual(empty.bookings, []);
      assert.deepEqual(empty.blocked, []);
    });

    test("a multi-day job is shown as ending later", async () => {
      // Coating: 900 minutes on a sedan, so the pickup is on another day.
      const booking = await bookAdmin({
        service_ids: [c.services.coating.id],
        preferred_time: "10:00",
      });
      const view = await loadAgenda(api, { start: MONDAY, end: "2026-10-10" });
      const shown = view.bookings.find((b) => b.id === booking.id)!;
      assert.equal(shown.ends_later, true);
      assert.equal(shown.same_day_end_time, null);
      assert.notEqual(shown.pickup_date, shown.preferred_date);
    });

    test("the new-appointment form only offers bookable options", async () => {
      const options = await loadAgendaVehicleOptions(api);
      const titles = options.vehicleTypes.map((v) => v.title);
      assert.deepEqual(titles, ["Sedan", "SUV"], "the inactive type is not offered");

      const sedan = options.servicesByType[c.vehicleTypes.sedan.id] ?? [];
      const offered = sedan.map((s) => s.title).sort();
      assert.ok(offered.includes("Wax"));
      assert.ok(!offered.includes("Weg"), "an inactive service is not offered");
      assert.ok(!offered.includes("Express"), "a non-bookable service is not offered");
      assert.ok(!offered.includes("Motorruimte"), "an unavailable matrix row is not offered");
    });
  });

  // ------------------------------------------------------------------ services

  describe("services and packages (/admin/diensten)", () => {
    test("create, change, deactivate and delete", async () => {
      const created = await createAdminService(api, {
        kind: "dienst",
        title: "E2E Dienst",
        description: "Testdienst",
        sort_order: 99,
      });
      assert.equal(
        await count(`SELECT count(*) FROM services WHERE id = $1 AND title = 'E2E Dienst'`, [
          created.id,
        ]),
        1,
      );

      const renamed = await updateAdminService(api, created.id, {
        title: "E2E Dienst gewijzigd",
        active: false,
      });
      assert.equal(renamed.title, "E2E Dienst gewijzigd");
      const row = await one(`SELECT title, active FROM services WHERE id = $1`, [created.id]);
      assert.equal(row!.title, "E2E Dienst gewijzigd");
      assert.equal(row!.active, false);

      // An empty patch is refused before anything is sent.
      await assert.rejects(() => updateAdminService(api, created.id, {}), RequestValidationError);

      // A cleared text field becomes NULL, not "".
      await updateAdminService(api, created.id, { description: "" });
      assert.equal(
        (await one(`SELECT description FROM services WHERE id = $1`, [created.id]))!.description,
        null,
      );

      await deleteAdminService(api, created.id);
      assert.equal(await count(`SELECT count(*) FROM services WHERE id = $1`, [created.id]), 0);
    });

    test("the loader returns the list and the package contents", async () => {
      const { items, contents } = await loadServices(api);
      assert.equal(items.length, await count(`SELECT count(*) FROM services`));
      assert.ok(
        items.some((s) => s.title === "Weg" && !s.active),
        "the admin list also shows inactive services",
      );
      assert.deepEqual(
        [...(contents[c.services.fullDetail.id] ?? [])].sort(),
        [c.services.wax.id, c.services.interior.id].sort(),
      );
    });

    test("the package content is REPLACED as a whole", async () => {
      const updated = await updatePackageContent(api, c.services.fullDetail.id, [
        c.services.interior.id,
      ]);
      assert.deepEqual(updated.included_service_ids, [c.services.interior.id]);
      assert.deepEqual(
        (
          await rows(`SELECT service_id FROM package_services WHERE package_id = $1`, [
            c.services.fullDetail.id,
          ])
        ).map((r) => r.service_id),
        [c.services.interior.id],
        "Wax was removed",
      );

      // Emptying it is allowed and leaves no rows.
      await updatePackageContent(api, c.services.fullDetail.id, []);
      assert.equal(
        await count(`SELECT count(*) FROM package_services WHERE package_id = $1`, [
          c.services.fullDetail.id,
        ]),
        0,
      );
    });

    test("one invalid id leaves the package content unchanged", async () => {
      const before = await rows(`SELECT service_id FROM package_services WHERE package_id = $1`, [
        c.services.fullDetail.id,
      ]);
      await failsWith(
        () =>
          updatePackageContent(api, c.services.fullDetail.id, [
            c.services.interior.id,
            "22222222-2222-4222-8222-222222222222",
          ]),
        400,
        "VALIDATION_ERROR",
      );
      const afterRows = await rows(
        `SELECT service_id FROM package_services WHERE package_id = $1`,
        [c.services.fullDetail.id],
      );
      assert.deepEqual(
        afterRows.map((r) => r.service_id).sort(),
        before.map((r) => r.service_id).sort(),
        "all or nothing",
      );
    });
  });

  // ------------------------------------------------------------------ vehicle types

  describe("vehicle types and pricing (/admin/voertuigen)", () => {
    test("create, change and delete a vehicle type", async () => {
      const created = await createAdminVehicleType(api, {
        slug: "e2e-bestelwagen",
        title: "E2E Bestelwagen",
        sort_order: 30,
      });
      assert.equal(
        await count(`SELECT count(*) FROM vehicle_types WHERE slug = 'e2e-bestelwagen'`),
        1,
      );

      await updateAdminVehicleType(api, created.id, { title: "E2E Bestelwagen XL" });
      assert.equal(
        (await one(`SELECT title FROM vehicle_types WHERE id = $1`, [created.id]))!.title,
        "E2E Bestelwagen XL",
      );

      // A duplicate slug is a conflict, not a crash.
      await failsWith(
        () => createAdminVehicleType(api, { slug: "e2e-bestelwagen", title: "Dubbel" }),
        409,
      );

      await deleteAdminVehicleType(api, created.id);
      assert.equal(
        await count(`SELECT count(*) FROM vehicle_types WHERE id = $1`, [created.id]),
        0,
      );
    });

    test("a vehicle type with a booking cannot be deleted (RESTRICT)", async () => {
      await bookAdmin();
      await failsWith(() => deleteAdminVehicleType(api, c.vehicleTypes.sedan.id), 409);
      assert.equal(
        await count(`SELECT count(*) FROM vehicle_types WHERE id = $1`, [c.vehicleTypes.sedan.id]),
        1,
        "the type is still there",
      );
    });

    test("the pricing matrix is saved all-or-nothing and drives the booking price", async () => {
      await updateAdminPricing(api, c.vehicleTypes.sedan.id, [
        { service_id: c.services.wax.id, available: true, price: 99.5, duration_minutes: 45 },
        { service_id: c.services.interior.id, available: false, price: 55, duration_minutes: 90 },
      ]);

      const row = await one(
        `SELECT price, duration_minutes, available FROM vehicle_type_services
         WHERE vehicle_type_id = $1 AND service_id = $2`,
        [c.vehicleTypes.sedan.id, c.services.wax.id],
      );
      assert.equal(Number(row!.price), 99.5);
      assert.equal(row!.duration_minutes, 45);

      // The new matrix is what the server charges for a new booking.
      const booking = await bookAdmin();
      assert.equal(booking.pricing.total_excl_vat, 99.5);
      assert.equal(booking.total_duration_minutes, 45);

      // An unavailable row can no longer be booked.
      await failsWith(
        () => bookAdmin({ service_ids: [c.services.interior.id], preferred_time: "12:00" }),
        404,
        "SERVICE_NOT_FOUND",
      );
    });

    test("an invalid row rolls back the whole matrix", async () => {
      const before = await rows(
        `SELECT service_id, price FROM vehicle_type_services WHERE vehicle_type_id = $1 ORDER BY service_id`,
        [c.vehicleTypes.sedan.id],
      );
      await failsWith(
        () =>
          updateAdminPricing(api, c.vehicleTypes.sedan.id, [
            { service_id: c.services.wax.id, available: true, price: 1, duration_minutes: 30 },
            {
              service_id: "33333333-3333-4333-8333-333333333333",
              available: true,
              price: 2,
              duration_minutes: 30,
            },
          ]),
        400,
        "VALIDATION_ERROR",
      );
      const afterRows = await rows(
        `SELECT service_id, price FROM vehicle_type_services WHERE vehicle_type_id = $1 ORDER BY service_id`,
        [c.vehicleTypes.sedan.id],
      );
      assert.deepEqual(afterRows, before, "nothing was changed");
    });

    test("the page's view matches the matrix in the database", async () => {
      const page = await loadVehiclesPage(api);
      assert.equal(page.vehicles.length, await count(`SELECT count(*) FROM vehicle_types`));
      assert.equal(page.vts.length, await count(`SELECT count(*) FROM vehicle_type_services`));
      assert.ok(
        !page.services.some((s) => s.title === "Weg"),
        "an inactive service is not a matrix column",
      );
    });
  });

  // ------------------------------------------------------------------ blocked periods

  describe("blocked periods (/admin/blokkades)", () => {
    test("a blocked period really blocks, and removing it unblocks", async () => {
      const period = await createBlockedPeriod(api, {
        start_date: MONDAY,
        end_date: MONDAY,
        reason: "E2E blokkade",
      });
      assert.deepEqual(
        (await loadBlockedPeriods(api)).map((p) => p.id),
        [period.id],
      );

      // The admin dialog offers no slots.
      const blocked = await loadAdminAvailability(api, {
        date: MONDAY,
        vehicle_type_id: c.vehicleTypes.sedan.id,
        service_ids: [c.services.wax.id],
      });
      assert.deepEqual(blocked.slots, [], "a fully blocked day has no slots");

      // And a PUBLIC visitor is refused too, through the public booking client.
      const request = toPublicBookingRequest(
        {
          vehicleTypeId: c.vehicleTypes.sedan.id,
          serviceIds: [c.services.wax.id],
          date: MONDAY,
          time: "10:00",
        },
        {
          customer_name: "Publieke Test",
          customer_phone: "0470000003",
          customer_email: "e2e-public@example.test",
          vehicle_brand: "Volvo",
          vehicle_model: "V60",
          on_location: false,
        },
      );
      const error = await failsWith(
        () => createPublicBooking(anon, request),
        409,
        "BOOKING_SLOT_UNAVAILABLE",
      );
      assert.ok(error.message.length > 0);
      assert.equal(await count(`SELECT count(*) FROM bookings`), 0, "nothing was created");

      await deleteBlockedPeriod(api, period.id);
      assert.equal(
        await count(`SELECT count(*) FROM blocked_periods WHERE id = $1`, [period.id]),
        0,
      );
      const freed = await loadAdminAvailability(api, {
        date: MONDAY,
        vehicle_type_id: c.vehicleTypes.sedan.id,
        service_ids: [c.services.wax.id],
      });
      assert.ok(freed.slots.length > 0, "the day is bookable again");
    });

    test("an impossible period is refused before it is sent", async () => {
      await assert.rejects(
        () => createBlockedPeriod(api, { start_date: "2026-10-09", end_date: "2026-10-08" }),
        RequestValidationError,
        "end before start",
      );
      await assert.rejects(
        () =>
          createBlockedPeriod(api, {
            start_date: MONDAY,
            end_date: MONDAY,
            start_time: "16:00",
            end_time: "10:00",
          }),
        RequestValidationError,
      );
      assert.equal(await count(`SELECT count(*) FROM blocked_periods`), 0);
    });
  });

  // ------------------------------------------------------------------ settings

  describe("settings (/admin/instellingen)", () => {
    test("a changed opening time immediately changes the slots", async () => {
      const before = await loadSettings(api);
      assert.equal(before.opening_hour, "10:00");

      const patch = changedFields(before, { ...before, opening_hour: "12:00" });
      assert.deepEqual(patch, { opening_hour: "12:00" }, "only the changed field is sent");
      await updateSettings(api, patch);

      assert.equal(
        String((await one(`SELECT opening_hour FROM site_settings`))!.opening_hour),
        "12:00:00",
      );
      const slots = await loadAdminAvailability(api, {
        date: MONDAY,
        vehicle_type_id: c.vehicleTypes.sedan.id,
        service_ids: [c.services.wax.id],
      });
      assert.equal(slots.slots[0]!.time, "12:00", "the day now opens at 12:00");
    });

    test("notification_email is stored for the admin but never exposed publicly", async () => {
      await updateSettings(api, { notification_email: "e2e-owner@example.test" });
      assert.equal((await loadSettings(api)).notification_email, "e2e-owner@example.test");

      const response = await fetch(`${baseUrl}/api/site-settings`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { data: Record<string, unknown> };
      // The public endpoint carries ONLY the two fields the public pages need; opening
      // hours and the slot grid reach the browser through GET /api/availability instead.
      assert.deepEqual(
        Object.keys(body.data).sort(),
        ["free_km", "km_fee"],
        "no admin-only field may be exposed",
      );
      assert.ok(!JSON.stringify(body).includes("e2e-owner@example.test"));

      // Clearing it removes the address.
      await updateSettings(api, { notification_email: "" });
      assert.equal((await loadSettings(api)).notification_email, null);
    });

    test("an invalid value is refused and changes nothing", async () => {
      await assert.rejects(
        () => updateSettings(api, { opening_hour: "25:00" }),
        RequestValidationError,
      );
      await assert.rejects(() => updateSettings(api, { km_fee: -1 }), RequestValidationError);
      await assert.rejects(() => updateSettings(api, {}), RequestValidationError);
      assert.equal(
        String((await one(`SELECT opening_hour FROM site_settings`))!.opening_hour),
        "10:00:00",
      );
    });
  });

  // ------------------------------------------------------------------ gallery

  describe("gallery (/admin/galerij)", () => {
    const files = () => readdir(`${uploadRoot}/gallery`).catch(() => []);

    test("uploading stores the file and the row, and the server names the file", async () => {
      const item = await uploadGalleryImage(api, new Blob([JPEG], { type: "image/jpeg" }), {
        title: "E2E Upload",
        sort_order: 5,
      });

      assert.match(
        item.image_url,
        new RegExp(`^${UPLOAD_BASE}/gallery/[0-9a-f-]{36}\\.jpg$`),
        "a server-generated UUID name, never the client's file name and never a local path",
      );
      const row = await one(`SELECT * FROM gallery_items WHERE id = $1`, [item.id]);
      assert.equal(row!.title, "E2E Upload");
      assert.equal(row!.image_url, item.image_url);
      assert.equal((await files()).length, 1, "exactly one file on disk");

      const listed = await loadGallery(api);
      assert.deepEqual(
        listed.map((g) => g.id),
        [item.id],
      );

      await updateGalleryItem(api, item.id, { title: "E2E Upload gewijzigd" });
      assert.equal(
        (await one(`SELECT title FROM gallery_items WHERE id = $1`, [item.id]))!.title,
        "E2E Upload gewijzigd",
      );

      await deleteGalleryItem(api, item.id);
      assert.equal(await count(`SELECT count(*) FROM gallery_items WHERE id = $1`, [item.id]), 0);
      assert.deepEqual(await files(), [], "the owned file is removed with the row");
    });

    test("a wrong file type is refused and leaves no row and no file", async () => {
      // Client-side: the type is not in the allowlist, so nothing is sent.
      await assert.rejects(
        () => uploadGalleryImage(api, new Blob([SVG], { type: "image/svg+xml" })),
        RequestValidationError,
      );

      // Server-side: an allowed MIME type with the wrong content is caught by magic bytes.
      await failsWith(
        () => uploadGalleryImage(api, new Blob([SVG], { type: "image/png" })),
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );

      assert.equal(await count(`SELECT count(*) FROM gallery_items`), 0);
      assert.deepEqual(await files(), [], "no partial file is kept");
    });

    test("a file over the limit is refused and leaves no row and no file", async () => {
      const tooLarge = Buffer.concat([JPEG, Buffer.alloc(MAX_UPLOAD_BYTES * 2)]);
      const error = await failsWith(
        () => uploadGalleryImage(api, new Blob([tooLarge], { type: "image/jpeg" })),
        413,
      );
      assert.ok(error.message.length > 0);
      assert.equal(await count(`SELECT count(*) FROM gallery_items`), 0);
      assert.deepEqual(await files(), [], "the staging file is cleaned up");
    });

    test("deleting a legacy EXTERNAL url removes the row and touches no file", async () => {
      const owned = await uploadGalleryImage(api, new Blob([JPEG], { type: "image/jpeg" }));
      const legacy = await createGalleryItem(api, {
        image_url: EXTERNAL_IMAGE,
        title: "Legacy Supabase",
      });
      assert.equal((await files()).length, 1);

      await deleteGalleryItem(api, legacy.id);

      assert.equal(await count(`SELECT count(*) FROM gallery_items WHERE id = $1`, [legacy.id]), 0);
      assert.equal(
        (await files()).length,
        1,
        "an external URL must never be treated as a local path",
      );
      assert.equal(await count(`SELECT count(*) FROM gallery_items WHERE id = $1`, [owned.id]), 1);
    });
  });

  // ------------------------------------------------------------------ public <-> admin

  describe("public site reflects the admin's changes", () => {
    const publicJson = async (path: string) => {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200, path);
      return (await response.json()) as { data: { id: string; title: string; active?: boolean }[] };
    };

    test("a new service and vehicle type appear publicly; deactivating hides them", async () => {
      const service = await createAdminService(api, {
        kind: "dienst",
        title: "E2E Publiek Zichtbaar",
        active: true,
        bookable: true,
      });
      const vehicleType = await createAdminVehicleType(api, {
        slug: "e2e-publiek",
        title: "E2E Publiek Voertuig",
        active: true,
      });

      const services = await publicJson("/api/services");
      assert.ok(services.data.some((s) => s.id === service.id));
      const types = await publicJson("/api/vehicle-types");
      assert.ok(types.data.some((v) => v.id === vehicleType.id));

      await updateAdminService(api, service.id, { active: false });
      await updateAdminVehicleType(api, vehicleType.id, { active: false });

      assert.ok(
        !(await publicJson("/api/services")).data.some((s) => s.id === service.id),
        "an inactive service is hidden publicly",
      );
      assert.ok(
        !(await publicJson("/api/vehicle-types")).data.some((v) => v.id === vehicleType.id),
        "an inactive vehicle type is hidden publicly",
      );
      // But the admin still sees them.
      assert.ok((await loadServices(api)).items.some((s) => s.id === service.id));
    });

    test("a public booking shows up in the admin list with the server's values", async () => {
      const request = toPublicBookingRequest(
        {
          vehicleTypeId: c.vehicleTypes.sedan.id,
          serviceIds: [c.services.wax.id],
          date: MONDAY,
          time: "12:00",
        },
        {
          customer_name: "E2E Publieke Klant",
          customer_phone: "0470000004",
          customer_email: "e2e-public2@example.test",
          vehicle_brand: "Audi",
          vehicle_model: "A4",
          on_location: false,
        },
      );
      const booking = await createPublicBooking(anon, request);

      const page = await loadBookingsPage(api, { page: 1 });
      const row = page.items.find((b) => b.id === booking.id);
      assert.ok(row, "the admin sees the public booking");
      assert.equal(row.customer_name, "E2E Publieke Klant");
      assert.equal(row.status, "nieuw", "a public booking starts as 'nieuw'");
      assert.equal(row.total_price, 74.75);

      // And the admin can confirm it.
      await updateAdminBooking(api, booking.id, { status: "bevestigd" });
      assert.equal(
        (await one(`SELECT status FROM bookings WHERE id = $1`, [booking.id]))!.status,
        "bevestigd",
      );
    });
  });

  // ------------------------------------------------------------------ security

  describe("security of the admin endpoints", () => {
    test("without a token, with a forged token or without the permission: no admin data", async () => {
      await bookAdmin();

      // No Authorization header at all.
      for (const path of [
        "/api/admin/dashboard",
        "/api/admin/bookings",
        "/api/admin/services",
        "/api/admin/vehicle-types",
        "/api/admin/blocked-periods",
        "/api/admin/settings",
        "/api/admin/gallery",
        "/api/admin/availability?date=2026-10-05",
      ]) {
        const response = await fetch(`${baseUrl}${path}`);
        assert.equal(response.status, 401, path);
        const text = await response.text();
        assert.ok(!text.includes(customer.customer_email), `${path} leaked data`);
      }

      // A token signed with a key outside the JWKS.
      await failsWith(() => loadDashboard(forged), 401);
      // A valid token without admin:access.
      await failsWith(() => loadDashboard(noPermission), 403);

      // Writes are protected as well, and change nothing.
      const before = await count(`SELECT count(*) FROM bookings`);
      await failsWith(
        () => deleteAdminBooking(forged, "11111111-1111-4111-8111-111111111111"),
        401,
      );
      await failsWith(
        () => createAdminService(noPermission, { kind: "dienst", title: "Mag niet" }),
        403,
      );
      assert.equal(await count(`SELECT count(*) FROM bookings`), before);
      assert.equal(await count(`SELECT count(*) FROM services WHERE title = 'Mag niet'`), 0);
    });

    test("the public endpoints stay reachable without a token", async () => {
      for (const path of ["/api/services", "/api/vehicle-types", "/api/site-settings", "/health"]) {
        assert.equal((await fetch(`${baseUrl}${path}`)).status, 200, path);
      }
    });
  });

  // ------------------------------------------------------------------ integrity

  describe("database integrity after a mixed series of admin actions", () => {
    test("no orphans, no duplicates, no half-saved changes", async () => {
      // A realistic session: create, move, change services, cancel, delete, catalogue edits.
      const first = await bookAdmin({ preferred_time: "10:00" });
      const second = await bookAdmin({ preferred_time: "12:00" });
      // Order matters: lengthening the 12:00 booking to 150 minutes makes it run until
      // 14:30, so the first booking is moved to 15:00, not 14:00.
      await updateAdminBooking(api, second.id, {
        service_ids: [c.services.wax.id, c.services.interior.id],
      });
      await updateAdminBooking(api, first.id, { preferred_time: "15:00" });
      const third = await bookAdmin({ preferred_time: "16:00" }); // 15:00 + 60 min, adjacent
      await updateAdminBooking(api, third.id, { status: "geannuleerd" });
      await deleteAdminBooking(api, third.id);
      const service = await createAdminService(api, { kind: "dienst", title: "E2E Integriteit" });
      await updateAdminPricing(api, c.vehicleTypes.sedan.id, [
        { service_id: service.id, available: true, price: 10, duration_minutes: 30 },
      ]);
      const item = await uploadGalleryImage(api, new Blob([JPEG], { type: "image/jpeg" }));
      await deleteGalleryItem(api, item.id);

      assert.equal(
        await count(`SELECT count(*) FROM booking_services bs
                     LEFT JOIN bookings b ON b.id = bs.booking_id WHERE b.id IS NULL`),
        0,
        "no orphan service lines",
      );
      assert.equal(
        await count(
          `SELECT count(*) FROM bookings a JOIN bookings b
             ON a.id < b.id AND a.status <> 'geannuleerd' AND b.status <> 'geannuleerd'
            AND tstzrange(a.start_at, a.end_at, '[)') && tstzrange(b.start_at, b.end_at, '[)')`,
        ),
        0,
        "no overlapping active bookings",
      );
      assert.equal(
        await count(`SELECT count(*) FROM bookings WHERE start_at >= end_at
                     OR total_duration_minutes <= 0 OR cancel_token IS NULL`),
        0,
        "every booking has a consistent schedule and a cancel token",
      );
      assert.equal(
        await count(
          `SELECT count(*) FROM bookings b WHERE b.total_duration_minutes <>
             (SELECT coalesce(sum(duration_minutes), 0) FROM booking_services WHERE booking_id = b.id)`,
        ),
        0,
        "the stored duration equals the sum of its service lines",
      );
      assert.equal(
        await count(
          `SELECT count(*) FROM bookings b WHERE b.total_price <> b.location_fee +
             (SELECT coalesce(sum(price), 0) FROM booking_services WHERE booking_id = b.id)`,
        ),
        0,
        "the stored price equals the sum of its service lines plus the location fee",
      );
      assert.equal(
        await count(`SELECT count(*) FROM site_settings`),
        1,
        "the settings stay a singleton",
      );

      // The schema itself is unchanged: the exclusion constraint is still there and active.
      assert.equal(
        await count(
          `SELECT count(*) FROM pg_constraint WHERE conname = 'bookings_no_overlap_excl'`,
        ),
        1,
      );
      await assert.rejects(
        () =>
          pool.query(
            `INSERT INTO bookings (customer_name, customer_email, customer_phone, total_price,
               preferred_date, preferred_time, start_at, end_at, total_duration_minutes, status)
             SELECT 'Overlap', 'x@example.test', '0470000000', 0, preferred_date, preferred_time,
               start_at, end_at, total_duration_minutes, 'bevestigd'
             FROM bookings WHERE id = $1`,
            [first.id],
          ),
        /bookings_no_overlap_excl/,
        "the constraint still refuses an overlap",
      );
    });
  });
});
