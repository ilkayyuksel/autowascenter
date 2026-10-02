// HTTP-level tests of the Fastify app via app.inject() (no TCP port).
// Data lives in PGlite with all migrations applied (see helpers/test-db.ts).

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createApp } from "../src/app.ts";
import {
  listResponse,
  publicGalleryItem,
  publicReview,
  publicService,
  publicSiteSettingsResponse,
  publicVehicleType,
  vehicleTypeServiceOption,
} from "../src/contracts/public.ts";
import { createDb, schema, type Database } from "../src/db/index.ts";
import { createTestDb } from "./helpers/test-db.ts";

const ORIGIN = "http://localhost:8080";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let db: Database;
let reset: () => Promise<unknown>;
let closeDb: () => Promise<void>;
let app: FastifyInstance;

before(async () => {
  const testDb = await createTestDb();
  db = testDb.db;
  reset = testDb.reset;
  closeDb = () => testDb.pg.close();
  app = await createApp({ db, corsOrigins: [ORIGIN], logLevel: "silent" });
});

after(async () => {
  await app.close();
  await closeDb();
});

beforeEach(() => reset());

async function get(url: string, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: "GET", url, headers });
  return { status: res.statusCode, body: res.json(), headers: res.headers };
}

/** Asserts `{ data: [...] }` where every item has exactly the contract's fields. */
function assertListShape<T extends z.ZodObject>(body: unknown, item: T) {
  const parsed = listResponse(z.strictObject(item.shape)).parse(body);
  return parsed.data as z.infer<T>[];
}

function assertError(body: unknown, code: string) {
  const parsed = z
    .strictObject({ error: z.strictObject({ code: z.string(), message: z.string() }) })
    .parse(body);
  assert.equal(parsed.error.code, code);
  return parsed.error;
}

async function seedService(values: Partial<typeof schema.services.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.services)
    .values({ title: "Dienst", ...values })
    .returning();
  return row!;
}

async function seedVehicleType(values: Partial<typeof schema.vehicleTypes.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.vehicleTypes)
    .values({ slug: `vt-${Math.random().toString(36).slice(2)}`, title: "Type", ...values })
    .returning();
  return row!;
}

describe("health", () => {
  test("GET /health", async () => {
    const res = await get("/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "ok" });
  });

  test("GET /health/db", async () => {
    const res = await get("/health/db");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "ok", database: "ok" });
  });
});

describe("GET /api/services", () => {
  test("returns an empty list", async () => {
    const res = await get("/api/services");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { data: [] });
  });

  test("returns active services only, by sort_order, with the contract fields", async () => {
    await seedService({ title: "B", sortOrder: 2, price: "40.00", durationMinutes: 45 });
    await seedService({ title: "A", sortOrder: 1, kind: "pakket", bookable: false, badge: "Top" });
    await seedService({ title: "Inactief", sortOrder: 0, active: false });

    const res = await get("/api/services");
    assert.equal(res.status, 200);
    const data = assertListShape(res.body, publicService);
    assert.deepEqual(
      data.map((s) => [s.title, s.kind, s.bookable, s.badge, s.price, s.duration_minutes]),
      [
        ["A", "pakket", false, "Top", null, null],
        ["B", "dienst", true, null, 40, 45],
      ],
    );
  });

  test("supports ?limit and rejects invalid values", async () => {
    for (let i = 0; i < 3; i++) await seedService({ title: `S${i}`, sortOrder: i });
    const res = await get("/api/services?limit=2");
    assert.deepEqual(
      assertListShape(res.body, publicService).map((s) => s.title),
      ["S0", "S1"],
    );

    const bad = await get("/api/services?limit=0");
    assert.equal(bad.status, 400);
    assertError(bad.body, "VALIDATION_ERROR");
  });
});

describe("GET /api/gallery", () => {
  test("returns an empty list", async () => {
    assert.deepEqual((await get("/api/gallery")).body, { data: [] });
  });

  test("returns all items by sort_order with the contract fields", async () => {
    await db.insert(schema.galleryItems).values([
      { imageUrl: "/b.jpg", title: "B", sortOrder: 2 },
      {
        imageUrl: "/a.jpg",
        title: "A",
        sortOrder: 1,
        beforeImageUrl: "/a0.jpg",
        category: "Polish",
      },
    ]);
    const res = await get("/api/gallery?limit=10");
    assert.equal(res.status, 200);
    const data = assertListShape(res.body, publicGalleryItem);
    assert.deepEqual(
      data.map((g) => [g.title, g.image_url, g.before_image_url, g.category]),
      [
        ["A", "/a.jpg", "/a0.jpg", "Polish"],
        ["B", "/b.jpg", null, null],
      ],
    );
  });
});

describe("GET /api/reviews", () => {
  test("returns an empty list", async () => {
    assert.deepEqual((await get("/api/reviews")).body, { data: [] });
  });

  test("returns approved reviews only, newest first", async () => {
    await db.insert(schema.reviews).values([
      {
        customerName: "Oud",
        rating: 4,
        content: "x",
        approved: true,
        createdAt: new Date("2026-01-01"),
      },
      {
        customerName: "Nieuw",
        rating: 5,
        content: "y",
        approved: true,
        createdAt: new Date("2026-06-01"),
      },
      { customerName: "Wacht", rating: 1, content: "z", approved: false },
    ]);
    const res = await get("/api/reviews?limit=6");
    assert.equal(res.status, 200);
    assert.deepEqual(
      assertListShape(res.body, publicReview).map((r) => r.customer_name),
      ["Nieuw", "Oud"],
    );
  });
});

describe("GET /api/vehicle-types", () => {
  test("returns an empty list", async () => {
    assert.deepEqual((await get("/api/vehicle-types")).body, { data: [] });
  });

  test("returns active types only, by sort_order", async () => {
    await seedVehicleType({ slug: "suv", title: "SUV", sortOrder: 40 });
    await seedVehicleType({ slug: "stadswagen", title: "Stadswagen", sortOrder: 10 });
    await seedVehicleType({ slug: "oud", title: "Oud", sortOrder: 0, active: false });

    const res = await get("/api/vehicle-types");
    assert.equal(res.status, 200);
    assert.deepEqual(
      assertListShape(res.body, publicVehicleType).map((v) => v.slug),
      ["stadswagen", "suv"],
    );
  });
});

describe("GET /api/site-settings (public subset)", () => {
  test("no settings row → 500 SETTINGS_NOT_CONFIGURED", async () => {
    const res = await get("/api/site-settings");
    assert.equal(res.status, 500);
    assertError(res.body, "SETTINGS_NOT_CONFIGURED");
  });

  test("returns only km_fee and free_km: never notification_email or other admin data", async () => {
    await db.insert(schema.siteSettings).values({
      kmFee: "0.75",
      freeKm: "15",
      notificationEmail: "admin@autowascenter.test",
      baseAddress: "Geheimstraat 1",
    });
    const res = await get("/api/site-settings");
    assert.equal(res.status, 200);
    assert.deepEqual(publicSiteSettingsResponse.parse(res.body), {
      data: { km_fee: 0.75, free_km: 15 },
    });
    const raw = JSON.stringify(res.body);
    assert.doesNotMatch(
      raw,
      /notification_email|admin@autowascenter|Geheimstraat|opening_hour|base_/,
    );
  });

  test("is public: no Authorization header needed", async () => {
    await db.insert(schema.siteSettings).values({});
    assert.equal((await get("/api/site-settings")).status, 200);
  });
});

describe("GET /api/vehicle-types/:vehicleTypeId/services", () => {
  test("rejects a malformed id with 400", async () => {
    const res = await get("/api/vehicle-types/not-a-uuid/services");
    assert.equal(res.status, 400);
    assertError(res.body, "VALIDATION_ERROR");
  });

  test("returns 404 for an unknown or inactive vehicle type", async () => {
    const unknown = await get(`/api/vehicle-types/${UNKNOWN_ID}/services`);
    assert.equal(unknown.status, 404);
    assertError(unknown.body, "VEHICLE_TYPE_NOT_FOUND");

    const inactive = await seedVehicleType({ active: false });
    const res = await get(`/api/vehicle-types/${inactive.id}/services`);
    assert.equal(res.status, 404);
  });

  test("returns an empty list for a type without services", async () => {
    const vt = await seedVehicleType();
    assert.deepEqual((await get(`/api/vehicle-types/${vt.id}/services`)).body, { data: [] });
  });

  test("returns bookable options with vehicle-type price/duration and package contents", async () => {
    const sedan = await seedVehicleType({ slug: "sedan" });
    const suv = await seedVehicleType({ slug: "suv" });

    const wax = await seedService({ title: "Wax", price: "65.00", durationMinutes: 60 });
    const interior = await seedService({ title: "Interieur", sortOrder: 1 });
    const hidden = await seedService({ title: "Inactief onderdeel", active: false });
    const pkg = await seedService({ title: "Full detail", kind: "pakket", badge: "Bestseller" });
    const extra = await seedService({ title: "Ozon", kind: "extra" });
    const walkIn = await seedService({ title: "Express", bookable: false });
    const inactive = await seedService({ title: "Weg", active: false });
    const unavailable = await seedService({ title: "Niet voor sedan" });

    const vts = (serviceId: string, price: string, durationMinutes: number, available = true) => ({
      vehicleTypeId: sedan.id,
      serviceId,
      price,
      durationMinutes,
      available,
    });
    await db
      .insert(schema.vehicleTypeServices)
      .values([
        vts(wax.id, "74.75", 60),
        vts(pkg.id, "287.50", 240),
        vts(extra.id, "75.00", 60),
        vts(walkIn.id, "25.00", 30),
        vts(inactive.id, "10.00", 30),
        vts(unavailable.id, "10.00", 30, false),
        { vehicleTypeId: suv.id, serviceId: wax.id, price: "91.00", durationMinutes: 75 },
      ]);
    await db.insert(schema.packageServices).values([
      { packageId: pkg.id, serviceId: interior.id },
      { packageId: pkg.id, serviceId: wax.id },
      { packageId: pkg.id, serviceId: hidden.id },
    ]);

    const res = await get(`/api/vehicle-types/${sedan.id}/services`);
    assert.equal(res.status, 200);
    const data = assertListShape(res.body, vehicleTypeServiceOption);

    assert.deepEqual(
      data.map((o) => [o.title, o.kind, o.price, o.duration_minutes, o.includes]),
      [
        ["Full detail", "pakket", 287.5, 240, ["Wax", "Interieur"]],
        ["Ozon", "extra", 75, 60, []],
        ["Wax", "dienst", 74.75, 60, []],
      ],
    );
    assert.equal(data.find((o) => o.title === "Wax")?.service_id, wax.id);
    assert.equal(data.find((o) => o.title === "Full detail")?.badge, "Bestseller");
  });
});

describe("errors, CORS and database failures", () => {
  test("unknown routes return the error shape", async () => {
    const res = await get("/api/does-not-exist");
    assert.equal(res.status, 404);
    assertError(res.body, "NOT_FOUND");
  });

  test("CORS allows only the configured origin", async () => {
    const allowed = await get("/api/services", { origin: ORIGIN });
    assert.equal(allowed.headers["access-control-allow-origin"], ORIGIN);

    const other = await get("/api/services", { origin: "https://evil.example" });
    assert.equal(other.headers["access-control-allow-origin"], undefined);
  });

  test("an unreachable PostgreSQL returns 503 without leaking connection details", async () => {
    // Real node-postgres pool pointed at a closed port: exercises the production driver path.
    const { db: downDb, pool } = createDb("postgres://user:s3cret@127.0.0.1:1/nope", {
      connectionTimeoutMillis: 2_000,
    });
    const downApp = await createApp({ db: downDb, corsOrigins: [ORIGIN], logLevel: "silent" });
    try {
      const health = await downApp.inject({ method: "GET", url: "/health/db" });
      assert.equal(health.statusCode, 503);
      assertError(health.json(), "DATABASE_UNAVAILABLE");

      const api = await downApp.inject({ method: "GET", url: "/api/services" });
      assert.equal(api.statusCode, 503);
      assertError(api.json(), "DATABASE_UNAVAILABLE");

      for (const body of [health.body, api.body]) {
        assert.doesNotMatch(body, /s3cret|127\.0\.0\.1|ECONNREFUSED|stack/i);
      }

      // Liveness does not depend on the database.
      assert.equal((await downApp.inject({ method: "GET", url: "/health" })).statusCode, 200);
    } finally {
      await downApp.close();
      await pool.end();
    }
  });

  test("an unexpected database error returns a generic 500", async () => {
    const broken = await createTestDb();
    await broken.pg.close();
    const brokenApp = await createApp({ db: broken.db, corsOrigins: [ORIGIN], logLevel: "silent" });
    try {
      const res = await brokenApp.inject({ method: "GET", url: "/api/services" });
      assert.equal(res.statusCode, 500);
      const error = assertError(res.json(), "INTERNAL_ERROR");
      assert.equal(error.message, "An unexpected error occurred.");

      const health = await brokenApp.inject({ method: "GET", url: "/health/db" });
      assert.equal(health.statusCode, 503);
    } finally {
      await brokenApp.close();
    }
  });
});
