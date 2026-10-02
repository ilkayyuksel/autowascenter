// Integration tests against a REAL PostgreSQL server (phase 8). The other suites use
// PGlite, which is the same engine but has a single connection: it can prove the rules,
// not真 parallelism, and it never exercises the production migration path.
//
// This suite therefore covers what PGlite cannot:
//   * the production migration script's path (drizzle-orm migrator on an empty database),
//   * schema objects as the server really creates them (btree_gist, enums, constraints,
//     the exclusion constraint, triggers, indexes, FK actions),
//   * TWO SIMULTANEOUS bookings on separate connections → exactly one wins,
//   * transaction rollback with a forced mid-transaction failure.
//
// It is skipped unless TEST_DATABASE_URL points at a disposable database, so `npm test`
// stays green without Docker:
//
//   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=autowascenter_test --name awc-test-db postgres:18.6-alpine
//   TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/autowascenter_test npm test
//
// WARNING: the database is truncated between tests. Never point this at production.

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";
import { bookingCreatedResponseSchema } from "@autowascenter/shared";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { createApp } from "../src/app.ts";
import { bookingsListResponse } from "../src/contracts/admin.ts";
import { schema, type Database } from "../src/db/index.ts";
import { createTestAuth } from "./helpers/auth.ts";
import { DAY, NOW, seedCatalog, type Catalog } from "./helpers/fixtures.ts";

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

let pool: pg.Pool;
let db: Database;
let app: FastifyInstance;
let token: string;
let c: Catalog;

const rows = async (sql: string, params: unknown[] = []) =>
  (await pool.query(sql, params)).rows as Record<string, unknown>[];
const value = async (sql: string, params: unknown[] = []) => {
  const result = await rows(sql, params);
  return result[0] ? Object.values(result[0])[0] : undefined;
};

describe("real PostgreSQL integration", { skip }, () => {
  before(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 10 });
    // The production migration path: an empty database must end up with the full schema.
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
    db = drizzle(pool, { schema }) as unknown as Database;
    const auth = await createTestAuth();
    token = await auth.token();
    app = await createApp({
      db,
      corsOrigins: ["http://localhost:8080"],
      logLevel: "silent",
      clock: () => NOW,
      tokenVerifier: auth.verifier,
      bookingRateLimit: { max: 1000, timeWindowMs: 60_000 },
    });
  });

  after(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${TABLES.join(", ")} CASCADE`);
    c = await seedCatalog(db);
  });

  describe("migrations on a real server", () => {
    test("records both migrations and is idempotent", async () => {
      const applied = await rows(
        `SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at`,
      );
      assert.equal(applied.length, 2, "0000_initial_schema and 0001_booking_integrity");
      // Running it again applies nothing and must not fail.
      await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
      assert.equal((await rows(`SELECT hash FROM drizzle.__drizzle_migrations`)).length, 2);
    });

    test("creates exactly the expected tables, the enum and btree_gist", async () => {
      const present = (
        await rows(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
        )
      ).map((r) => r.table_name as string);
      assert.deepEqual(present.sort(), [...TABLES].sort());

      assert.equal(await value(`SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'`), 1);
      const statuses = (
        await rows(
          `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'booking_status' ORDER BY e.enumsortorder`,
        )
      ).map((r) => r.enumlabel);
      assert.deepEqual(statuses, ["nieuw", "bevestigd", "voltooid", "geannuleerd"]);
      // No Supabase leftovers.
      assert.equal(await value(`SELECT 1 FROM pg_type WHERE typname = 'app_role'`), undefined);
    });

    test("creates the overlap exclusion constraint, the updated_at triggers and the indexes", async () => {
      const exclusion = await rows(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conname = 'bookings_no_overlap_excl'`,
      );
      assert.equal(exclusion.length, 1);
      const def = exclusion[0]!.def as string;
      assert.match(def, /EXCLUDE USING gist/);
      assert.match(def, /tstzrange\(start_at, end_at, '\[\)'/);
      // Cancelled bookings free their slot.
      assert.match(def, /status <> 'geannuleerd'/);

      assert.equal(
        (
          await rows(
            `SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = 'public'`,
          )
        ).length,
        8,
        "one updated_at trigger per table",
      );
      const indexes = (
        await rows(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)
      ).map((r) => r.indexname as string);
      for (const expected of [
        "bookings_preferred_date_idx",
        "bookings_status_idx",
        "bookings_vehicle_type_id_idx",
        "bookings_cancel_token_key",
        "blocked_periods_dates_idx",
        "site_settings_singleton_idx",
      ]) {
        assert.ok(indexes.includes(expected), `${expected} (have: ${indexes.sort().join(", ")})`);
      }
    });

    test("keeps the ON DELETE actions: RESTRICT, SET NULL and CASCADE", async () => {
      const actions = new Map(
        (
          await rows(
            `SELECT c.conname, c.confdeltype FROM pg_constraint c
             JOIN pg_class cl ON cl.oid = c.conrelid
             WHERE c.contype = 'f' AND cl.relname IN ('bookings', 'booking_services')`,
          )
        ).map((a) => [a.conname as string, a.confdeltype as string]),
      );
      // r = RESTRICT, n = SET NULL, c = CASCADE
      assert.equal(
        actions.get("bookings_vehicle_type_id_vehicle_types_id_fk"),
        "r",
        "a vehicle type used by bookings must not be deletable",
      );
      assert.equal(actions.get("bookings_service_id_services_id_fk"), "n");
      assert.equal(actions.get("booking_services_service_id_services_id_fk"), "n");
      assert.equal(actions.get("booking_services_booking_id_bookings_id_fk"), "c");
    });
  });

  describe("booking concurrency on separate connections", () => {
    const body = (time: string) => ({
      vehicle_type_id: c.vehicleTypes.sedan.id,
      service_ids: [c.services.wax.id],
      preferred_date: DAY,
      preferred_time: time,
      customer_name: "Jan Peeters",
      customer_email: "jan@example.com",
      customer_phone: "0470123456",
      vehicle_brand: "BMW",
      vehicle_model: "3-Reeks",
      on_location: false,
    });
    const post = (payload: object) => app.inject({ method: "POST", url: "/api/bookings", payload });

    test("two simultaneous requests for the same slot: exactly one 201 and one 409", async () => {
      // Fired without awaiting in between, so both transactions are open at the same time
      // on different pool connections — the race PGlite cannot reproduce.
      const [first, second] = await Promise.all([post(body("10:00")), post(body("10:00"))]);
      const statuses = [first.statusCode, second.statusCode].sort();
      assert.deepEqual(statuses, [201, 409], `got ${JSON.stringify(statuses)}`);

      const winner = [first, second].find((r) => r.statusCode === 201)!;
      const loser = [first, second].find((r) => r.statusCode === 409)!;
      assert.equal(
        (loser.json() as { error: { code: string } }).error.code,
        "BOOKING_SLOT_UNAVAILABLE",
      );
      bookingCreatedResponseSchema.parse(winner.json());

      // Exactly one booking with exactly one service line.
      assert.equal(await value(`SELECT count(*)::int FROM bookings`), 1);
      assert.equal(await value(`SELECT count(*)::int FROM booking_services`), 1);
    });

    test("ten simultaneous requests for the same slot leave one booking", async () => {
      const results = await Promise.all(Array.from({ length: 10 }, () => post(body("11:00"))));
      const created = results.filter((r) => r.statusCode === 201);
      const rejected = results.filter((r) => r.statusCode === 409);
      assert.equal(created.length, 1);
      assert.equal(rejected.length, 9);
      assert.equal(await value(`SELECT count(*)::int FROM bookings`), 1);
    });

    test("simultaneous requests for different slots all succeed", async () => {
      const results = await Promise.all([
        post(body("10:00")),
        post(body("12:00")),
        post(body("14:00")),
      ]);
      assert.deepEqual(
        results.map((r) => r.statusCode),
        [201, 201, 201],
      );
      assert.equal(await value(`SELECT count(*)::int FROM bookings`), 3);
      // The admin API sees all three.
      const list = bookingsListResponse.parse(
        (
          await app.inject({
            method: "GET",
            url: "/api/admin/bookings",
            headers: { authorization: `Bearer ${token}` },
          })
        ).json(),
      );
      assert.equal(list.meta.total, 3);
    });
  });

  describe("transactions roll back completely", () => {
    /** Temporary trigger that fails every write to `table` matching `when`. */
    async function failWhen(table: string, when: string) {
      await pool.query(`
        CREATE OR REPLACE FUNCTION test_forced_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'forced test failure'; END $$;
        DROP TRIGGER IF EXISTS test_forced_failure ON ${table};
        CREATE TRIGGER test_forced_failure BEFORE INSERT OR UPDATE ON ${table}
          FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION test_forced_failure();
      `);
      return () => pool.query(`DROP TRIGGER IF EXISTS test_forced_failure ON ${table}`);
    }

    const adminPost = (url: string, payload: object) =>
      app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${token}` },
        payload,
      });

    test("a public booking whose service lines fail leaves no booking row", async () => {
      const cleanup = await failWhen("booking_services", "true");
      try {
        const res = await app.inject({
          method: "POST",
          url: "/api/bookings",
          payload: {
            vehicle_type_id: c.vehicleTypes.sedan.id,
            service_ids: [c.services.wax.id],
            preferred_date: DAY,
            preferred_time: "10:00",
            customer_name: "Jan Peeters",
            customer_email: "jan@example.com",
            customer_phone: "0470123456",
            vehicle_brand: "BMW",
            vehicle_model: "3-Reeks",
            on_location: false,
          },
        });
        assert.equal(res.statusCode, 500);
      } finally {
        await cleanup();
      }
      assert.equal(await value(`SELECT count(*)::int FROM bookings`), 0);
      assert.equal(await value(`SELECT count(*)::int FROM booking_services`), 0);
    });

    test("a new service whose pricing rows fail leaves no service row", async () => {
      const before = await value(`SELECT count(*)::int FROM services`);
      const cleanup = await failWhen("vehicle_type_services", "true");
      try {
        assert.equal((await adminPost("/api/admin/services", { kind: "dienst" })).statusCode, 500);
      } finally {
        await cleanup();
      }
      assert.equal(await value(`SELECT count(*)::int FROM services`), before);
    });

    test("a new vehicle type whose pricing rows fail leaves no vehicle type", async () => {
      const before = await value(`SELECT count(*)::int FROM vehicle_types`);
      const cleanup = await failWhen("vehicle_type_services", "true");
      try {
        assert.equal(
          (await adminPost("/api/admin/vehicle-types", {}).then((r) => r)).statusCode,
          500,
        );
      } finally {
        await cleanup();
      }
      assert.equal(await value(`SELECT count(*)::int FROM vehicle_types`), before);
    });

    test("package contents are replaced all-or-nothing", async () => {
      const put = (serviceIds: string[]) =>
        app.inject({
          method: "PUT",
          url: `/api/admin/services/${c.services.fullDetail.id}/package-content`,
          headers: { authorization: `Bearer ${token}` },
          payload: { service_ids: serviceIds },
        });
      assert.equal((await put([c.services.wax.id, c.services.interior.id])).statusCode, 200);
      assert.equal(await value(`SELECT count(*)::int FROM package_services`), 2);

      const cleanup = await failWhen("package_services", "true");
      try {
        assert.equal((await put([c.services.wax.id])).statusCode, 500);
      } finally {
        await cleanup();
      }
      // The original two rows are still there: nothing was half-replaced.
      assert.equal(await value(`SELECT count(*)::int FROM package_services`), 2);
    });

    test("the pricing matrix saves nothing when one row fails", async () => {
      const rowsBefore = await rows(
        `SELECT service_id, price FROM vehicle_type_services
         WHERE vehicle_type_id = $1 ORDER BY service_id`,
        [c.vehicleTypes.sedan.id],
      );
      const cleanup = await failWhen("vehicle_type_services", "NEW.price = 99.99");
      try {
        const res = await app.inject({
          method: "PUT",
          url: `/api/admin/vehicle-types/${c.vehicleTypes.sedan.id}/pricing`,
          headers: { authorization: `Bearer ${token}` },
          payload: {
            rows: [
              { service_id: c.services.wax.id, available: true, price: 55, duration_minutes: 90 },
              {
                service_id: c.services.interior.id,
                available: true,
                price: 99.99,
                duration_minutes: 60,
              },
            ],
          },
        });
        assert.equal(res.statusCode, 500);
      } finally {
        await cleanup();
      }
      const rowsAfter = await rows(
        `SELECT service_id, price FROM vehicle_type_services
         WHERE vehicle_type_id = $1 ORDER BY service_id`,
        [c.vehicleTypes.sedan.id],
      );
      assert.deepEqual(rowsAfter, rowsBefore, "the whole matrix must be unchanged");
    });
  });
});
