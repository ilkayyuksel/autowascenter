// Transaction rollback: a trigger forces a failure HALFWAY through each multi-table mutation
// (after earlier statements of the same transaction succeeded). Expected: zero partial changes,
// a generic 500 for the client, and no database details in the response.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { schema, type Database } from "../src/db/index.ts";
import { createTestAuth } from "./helpers/auth.ts";
import { failWhen } from "./helpers/failure.ts";
import { DAY, NOW, seedCatalog, type Catalog } from "./helpers/fixtures.ts";
import { createTestDb } from "./helpers/test-db.ts";

let pg: PGlite;
let db: Database;
let reset: () => Promise<unknown>;
let app: FastifyInstance;
let token: string;
let c: Catalog;
let cleanup: (() => Promise<unknown>) | undefined;

before(async () => {
  const t = await createTestDb();
  pg = t.pg;
  db = t.db;
  reset = t.reset;
  const auth = await createTestAuth();
  token = await auth.token();
  app = await createApp({
    db,
    corsOrigins: ["http://localhost:8080"],
    logLevel: "silent",
    tokenVerifier: auth.verifier,
    clock: () => NOW,
  });
});
after(async () => {
  await app.close();
  await pg.close();
});
beforeEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  await reset();
  c = await seedCatalog(db);
});

async function call(method: "POST" | "PATCH" | "PUT", url: string, body: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    payload: body as object,
  });
  return { status: res.statusCode, body: res.body };
}

function assertGeneric500(res: { status: number; body: string }) {
  assert.equal(res.status, 500, res.body);
  assert.match(res.body, /"INTERNAL_ERROR"/);
  assert.doesNotMatch(
    res.body,
    /forced test failure|trigger|vehicle_type_services|booking_services|package_services/i,
  );
}

const n = async (table: string) =>
  (
    (await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))) as unknown as {
      rows: { n: number }[];
    }
  ).rows[0]!.n;

const bookingBody = (overrides: Record<string, unknown> = {}) => ({
  vehicle_type_id: c.vehicleTypes.sedan.id,
  service_ids: [c.services.wax.id],
  preferred_date: DAY,
  preferred_time: "10:00",
  customer_name: "Jan",
  customer_email: "jan@example.com",
  customer_phone: "0470123456",
  ...overrides,
});

describe("rollback of multi-table mutations", () => {
  test("service create + pricing rows: a failing pricing row → no service", async () => {
    const [services, rows] = [await n("services"), await n("vehicle_type_services")];
    cleanup = await failWhen(pg, "vehicle_type_services", "true");
    assertGeneric500(await call("POST", "/api/admin/services", { kind: "dienst", title: "Half" }));
    assert.equal(await n("services"), services);
    assert.equal(await n("vehicle_type_services"), rows);
  });

  test("vehicle type create + pricing rows: a failing row → no vehicle type", async () => {
    const [types, rows] = [await n("vehicle_types"), await n("vehicle_type_services")];
    cleanup = await failWhen(pg, "vehicle_type_services", "NEW.price = 30");
    assertGeneric500(await call("POST", "/api/admin/vehicle-types", { slug: "half" }));
    assert.equal(await n("vehicle_types"), types);
    assert.equal(await n("vehicle_type_services"), rows);
  });

  test("package content A,B → A,C fails on C: A,B remain (the DELETE is rolled back too)", async () => {
    const pkg = c.services.fullDetail.id; // seeded with Wax (A) + Interieur (B)
    cleanup = await failWhen(pg, "package_services", `NEW.service_id = '${c.services.ozone.id}'`);
    assertGeneric500(
      await call("PUT", `/api/admin/services/${pkg}/package-content`, {
        service_ids: [c.services.wax.id, c.services.ozone.id],
      }),
    );
    const contents = await db
      .select({ id: schema.packageServices.serviceId })
      .from(schema.packageServices)
      .where(eq(schema.packageServices.packageId, pkg));
    assert.deepEqual(
      contents.map((r) => r.id).sort(),
      [c.services.wax.id, c.services.interior.id].sort(),
    );
  });

  test("booking + booking_services (admin and public): failing snapshot → no booking", async () => {
    cleanup = await failWhen(pg, "booking_services", "true");
    assertGeneric500(await call("POST", "/api/admin/bookings", bookingBody()));
    const publicRes = await app.inject({
      method: "POST",
      url: "/api/bookings",
      payload: { ...bookingBody(), vehicle_brand: "BMW", vehicle_model: "X" },
    });
    assert.equal(publicRes.statusCode, 500);
    assert.equal(await n("bookings"), 0);
    assert.equal(await n("booking_services"), 0);
  });

  test("booking update with new services: failing snapshot → price, duration and old lines intact", async () => {
    const created = await call("POST", "/api/admin/bookings", bookingBody());
    const id = (JSON.parse(created.body) as { data: { id: string } }).data.id;
    cleanup = await failWhen(pg, "booking_services", "true");
    assertGeneric500(
      await call("PATCH", `/api/admin/bookings/${id}`, { service_ids: [c.services.interior.id] }),
    );
    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
    assert.deepEqual(
      [booking!.totalPrice, booking!.totalDurationMinutes, booking!.serviceTitle],
      ["74.75", 60, "Wax"],
    );
    const lines = await db
      .select()
      .from(schema.bookingServices)
      .where(eq(schema.bookingServices.bookingId, id));
    assert.deepEqual(
      lines.map((l) => l.serviceTitle),
      ["Wax"],
    );
  });

  test("pricing matrix A, B valid + C fails: A and B are NOT saved", async () => {
    const suv = c.vehicleTypes.suv.id; // seeded: Wax 91 / 75, Full detail 350 / 300, no Interieur row
    cleanup = await failWhen(pg, "vehicle_type_services", "NEW.price = 13.37");
    assertGeneric500(
      await call("PUT", `/api/admin/vehicle-types/${suv}/pricing`, {
        rows: [
          { service_id: c.services.wax.id, available: true, price: 95, duration_minutes: 80 }, // A: update
          { service_id: c.services.interior.id, available: true, price: 66, duration_minutes: 90 }, // B: insert
          {
            service_id: c.services.fullDetail.id,
            available: true,
            price: 13.37,
            duration_minutes: 60,
          }, // C: fails
        ],
      }),
    );
    const rows = await db
      .select({
        serviceId: schema.vehicleTypeServices.serviceId,
        price: schema.vehicleTypeServices.price,
        duration: schema.vehicleTypeServices.durationMinutes,
      })
      .from(schema.vehicleTypeServices)
      .where(eq(schema.vehicleTypeServices.vehicleTypeId, suv));
    const byService = new Map(rows.map((r) => [r.serviceId, r]));
    assert.deepEqual(
      [byService.get(c.services.wax.id)!.price, byService.get(c.services.wax.id)!.duration],
      ["91.00", 75],
    );
    assert.equal(byService.has(c.services.interior.id), false);
    assert.equal(byService.get(c.services.fullDetail.id)!.price, "350.00");
  });
});

describe("integrity after failed mutations", () => {
  test("no orphan rows anywhere", async () => {
    cleanup = await failWhen(pg, "booking_services", "true");
    await call("POST", "/api/admin/bookings", bookingBody());
    const orphanChecks = [
      "SELECT count(*)::int AS n FROM booking_services s LEFT JOIN bookings b ON b.id = s.booking_id WHERE b.id IS NULL",
      "SELECT count(*)::int AS n FROM vehicle_type_services v LEFT JOIN services s ON s.id = v.service_id WHERE s.id IS NULL",
      "SELECT count(*)::int AS n FROM package_services p LEFT JOIN services s ON s.id = p.package_id WHERE s.id IS NULL",
    ];
    for (const q of orphanChecks) {
      const res = (await db.execute(sql.raw(q))) as unknown as { rows: { n: number }[] };
      assert.equal(res.rows[0]!.n, 0, q);
    }
    const [settings] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.siteSettings);
    assert.equal(settings!.n, 1);
  });
});
