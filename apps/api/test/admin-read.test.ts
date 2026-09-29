// Admin read API (/api/admin/*): authorization matrix, validation, strict contracts and data
// correctness. PGlite database, local test Auth0 keys (no real tenant).

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { bookingRequestSchema } from "@autowascenter/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createApp } from "../src/app.ts";
import {
  agendaResponse,
  blockedPeriodsResponse,
  bookingDetailResponse,
  bookingsListResponse,
  dashboardResponse,
  galleryResponse,
  servicesResponse,
  settingsResponse,
  vehicleTypesResponse,
} from "../src/contracts/admin.ts";
import { schema, type Database } from "../src/db/index.ts";
import { createBooking } from "../src/services/booking.service.ts";
import { createTestAuth, type TestAuth } from "./helpers/auth.ts";
import { DAY, insertBookingAt, NOW, seedCatalog, type Catalog } from "./helpers/fixtures.ts";
import { createTestDb } from "./helpers/test-db.ts";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let db: Database;
let reset: () => Promise<unknown>;
let closeDb: () => Promise<void>;
let app: FastifyInstance;
let auth: TestAuth;
let adminToken: string;
let c: Catalog;

before(async () => {
  const t = await createTestDb();
  db = t.db;
  reset = t.reset;
  closeDb = () => t.pg.close();
  auth = await createTestAuth();
  adminToken = await auth.token();
  app = await createApp({
    db,
    corsOrigins: ["http://localhost:8080"],
    logLevel: "silent",
    tokenVerifier: auth.verifier,
    clock: () => NOW, // Thursday 2026-10-01 10:00 Europe/Brussels
  });
});
after(async () => {
  await app.close();
  await closeDb();
});
beforeEach(async () => {
  await reset();
  c = await seedCatalog(db);
});

async function get(url: string, token: string | null = adminToken) {
  const res = await app.inject({
    method: "GET",
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.statusCode, body: res.body, json: () => res.json() as unknown };
}

const errorShape = z.strictObject({
  error: z.strictObject({ code: z.string(), message: z.string() }),
});
function assertError(res: { status: number; json: () => unknown }, status: number, code: string) {
  assert.equal(res.status, status);
  assert.equal(errorShape.parse(res.json()).error.code, code);
}

const ENDPOINTS = [
  "/api/admin/dashboard",
  "/api/admin/bookings",
  `/api/admin/bookings/${UNKNOWN_ID}`,
  `/api/admin/agenda?start=${DAY}&end=${DAY}`,
  "/api/admin/services",
  "/api/admin/vehicle-types",
  "/api/admin/blocked-periods",
  "/api/admin/settings",
  "/api/admin/gallery",
];

describe("authorization matrix (every admin read endpoint)", () => {
  test("no token → 401 AUTHENTICATION_REQUIRED", async () => {
    for (const url of ENDPOINTS) assertError(await get(url, null), 401, "AUTHENTICATION_REQUIRED");
  });

  test("invalid token → 401 AUTHENTICATION_INVALID", async () => {
    const foreign = await auth.foreignToken();
    for (const url of ENDPOINTS) {
      assertError(await get(url, foreign), 401, "AUTHENTICATION_INVALID");
      assertError(await get(url, "not.a.token"), 401, "AUTHENTICATION_INVALID");
    }
  });

  test("valid token without admin:access → 403, even with an 'admin' role-like claim", async () => {
    const noPermission = await auth.token({
      permissions: ["bookings:read"],
      roles: ["admin"],
      email: "admin@autowascenter.be",
    });
    for (const url of ENDPOINTS)
      assertError(await get(url, noPermission), 403, "AUTHORIZATION_REQUIRED");
  });

  test("admin token → 200 (404 only for the unknown booking id)", async () => {
    for (const url of ENDPOINTS) {
      const res = await get(url);
      if (url.includes(UNKNOWN_ID)) assertError(res, 404, "RESOURCE_NOT_FOUND");
      else assert.equal(res.status, 200, `${url}: ${res.body}`);
    }
  });

  test("query parameters cannot bypass authorization", async () => {
    for (const url of [
      "/api/admin/bookings?admin=true",
      "/api/admin/settings?permissions=admin:access",
    ]) {
      assertError(await get(url, null), 401, "AUTHENTICATION_REQUIRED");
    }
  });
});

describe("parameter validation → 400 VALIDATION_ERROR", () => {
  test("unknown query parameters are rejected", async () => {
    for (const url of [
      "/api/admin/dashboard?week=1",
      "/api/admin/services?all=1",
      "/api/admin/vehicle-types?x=1",
      "/api/admin/blocked-periods?from=2026-01-01",
      "/api/admin/settings?x=1",
      "/api/admin/gallery?x=1",
      "/api/admin/bookings?status=nieuw",
    ]) {
      assertError(await get(url), 400, "VALIDATION_ERROR");
    }
  });

  test("bookings pagination bounds and booking id format", async () => {
    for (const q of ["page=0", "page=-1", "page=abc", "limit=0", "limit=101", "limit=1.5"]) {
      assertError(await get(`/api/admin/bookings?${q}`), 400, "VALIDATION_ERROR");
    }
    assertError(await get("/api/admin/bookings/not-a-uuid"), 400, "VALIDATION_ERROR");
  });

  test("agenda range", async () => {
    for (const q of [
      "",
      `start=${DAY}`,
      "start=2026-02-30&end=2026-03-01",
      "start=05-10-2026&end=2026-10-06",
      "start=2026-10-06&end=2026-10-05",
      "start=2026-01-01&end=2026-03-31",
    ]) {
      assertError(await get(`/api/admin/agenda?${q}`), 400, "VALIDATION_ERROR");
    }
    assert.equal((await get("/api/admin/agenda?start=2026-10-01&end=2026-12-01")).status, 200); // 62 days
  });
});

describe("GET /api/admin/dashboard", () => {
  test("counts, week revenue (SQL aggregates, excl. VAT), today and next booking", async () => {
    await db.insert(schema.galleryItems).values({ imageUrl: "/a.jpg" });
    // Week of NOW: Mon 2026-09-28 … Sun 2026-10-04.
    await insertBookingAt(db, {
      date: "2026-09-29",
      time: "10:00",
      endTime: "11:00",
      totalPrice: "100.10",
      customerName: "Dinsdag",
    });
    await insertBookingAt(db, {
      date: "2026-10-01",
      time: "09:00",
      endTime: "09:30",
      totalPrice: "50.00",
      customerName: "Vroeg",
    });
    await insertBookingAt(db, {
      date: "2026-10-01",
      time: "14:00",
      endTime: "15:00",
      totalPrice: "74.75",
      customerName: "Later",
      serviceTitle: "Wax",
    });
    await insertBookingAt(db, {
      date: "2026-10-01",
      time: "16:00",
      endTime: "17:00",
      totalPrice: "999.00",
      status: "geannuleerd",
    });
    await insertBookingAt(db, {
      date: "2026-10-05",
      time: "10:00",
      endTime: "11:00",
      totalPrice: "10.00",
    }); // next week

    const res = await get("/api/admin/dashboard");
    const { data } = dashboardResponse.parse(res.json());
    assert.equal(data.today, "2026-10-01");
    assert.equal(data.week_start, "2026-09-28");
    assert.equal(data.week_end, "2026-10-04");
    assert.deepEqual(data.counts, {
      active_services: 7,
      gallery_items: 1,
      active_vehicle_types: 2,
    });
    assert.equal(data.week.booking_count, 3);
    assert.equal(data.week.revenue_excl_vat, 224.85);
    assert.equal(data.week.days.length, 7);
    assert.deepEqual(data.week.days[1], {
      date: "2026-09-29",
      booking_count: 1,
      revenue_excl_vat: 100.1,
    });
    assert.deepEqual(data.week.days[3], {
      date: "2026-10-01",
      booking_count: 2,
      revenue_excl_vat: 124.75,
    });
    assert.deepEqual(
      data.today_bookings.map((b) => [b.customer_name, b.preferred_time]),
      [
        ["Vroeg", "09:00"],
        ["Later", "14:00"],
      ],
    );
    assert.equal(data.next_booking?.customer_name, "Later");
    assert.equal(data.next_booking?.service_title, "Wax");
  });

  test("an empty week", async () => {
    const { data } = dashboardResponse.parse((await get("/api/admin/dashboard")).json());
    assert.equal(data.week.booking_count, 0);
    assert.equal(data.week.revenue_excl_vat, 0);
    assert.deepEqual(data.today_bookings, []);
    assert.equal(data.next_booking, null);
  });
});

describe("GET /api/admin/bookings and /bookings/:id", () => {
  const request = (time: string, name: string) =>
    bookingRequestSchema.parse({
      vehicle_type_id: c.vehicleTypes.sedan.id,
      service_ids: [c.services.wax.id, c.services.interior.id],
      preferred_date: DAY,
      preferred_time: time,
      customer_name: name,
      customer_phone: "0470123456",
      customer_email: "klant@example.com",
      vehicle_brand: "BMW",
      vehicle_model: "3-Reeks",
      company_name: "Garage BV",
      on_location: true,
      location_in_sint_niklaas: false,
      location_address: "Straat 12, 9000 Gent",
    });

  test("server-side pagination with meta; newest appointment first", async () => {
    await insertBookingAt(db, {
      date: "2026-10-02",
      time: "10:00",
      endTime: "11:00",
      customerName: "B",
    });
    await insertBookingAt(db, {
      date: "2026-10-03",
      time: "10:00",
      endTime: "11:00",
      customerName: "C",
    });
    await insertBookingAt(db, {
      date: "2026-10-01",
      time: "12:00",
      endTime: "13:00",
      customerName: "A",
    });

    const page1 = bookingsListResponse.parse((await get("/api/admin/bookings?limit=2")).json());
    assert.deepEqual(page1.meta, { page: 1, limit: 2, total: 3, total_pages: 2 });
    assert.deepEqual(
      page1.data.map((b) => b.customer_name),
      ["C", "B"],
    );

    const page2 = bookingsListResponse.parse(
      (await get("/api/admin/bookings?page=2&limit=2")).json(),
    );
    assert.deepEqual(
      page2.data.map((b) => b.customer_name),
      ["A"],
    );

    const beyond = bookingsListResponse.parse(
      (await get("/api/admin/bookings?page=9&limit=2")).json(),
    );
    assert.deepEqual(beyond.data, []);
    assert.equal(beyond.meta.total, 3);

    const defaults = bookingsListResponse.parse((await get("/api/admin/bookings")).json());
    assert.deepEqual(defaults.meta, { page: 1, limit: 50, total: 3, total_pages: 1 });
  });

  test("detail: booking, vehicle type, snapshots, scheduling, pricing, location; no cancel token", async () => {
    const created = await createBooking(db, request("10:00", "Jan"), NOW);
    const res = await get(`/api/admin/bookings/${created.id}`);
    const { data } = bookingDetailResponse.parse(res.json());
    assert.equal(data.status, "nieuw");
    assert.deepEqual(data.vehicle_type, {
      id: c.vehicleTypes.sedan.id,
      slug: "sedan",
      title: "Sedan",
    });
    assert.equal(data.preferred_time, "10:00");
    assert.equal(data.pickup_time, "12:30");
    assert.equal(data.total_price, 129.75);
    assert.equal(data.location_address, "Straat 12, 9000 Gent");
    assert.equal(data.company_name, "Garage BV");
    assert.deepEqual(
      data.services.map((s) => [s.service_title, s.price, s.duration_minutes]),
      [
        ["Interieur", 55, 90],
        ["Wax", 74.75, 60],
      ],
    );

    const [row] = await db.select({ token: schema.bookings.cancelToken }).from(schema.bookings);
    for (const body of [res.body, (await get("/api/admin/bookings")).body]) {
      assert.doesNotMatch(body, /cancel_token|cancelToken/);
      assert.ok(!body.includes(row!.token), "cancel token leaked");
    }
  });
});

describe("GET /api/admin/agenda", () => {
  test("bookings overlapping the range (all statuses, multi-day) and blocked periods", async () => {
    await insertBookingAt(db, {
      date: "2026-10-04",
      time: "10:00",
      endDate: "2026-10-05",
      endTime: "12:00",
      customerName: "Meerdaags",
    });
    await insertBookingAt(db, {
      date: "2026-10-06",
      time: "10:00",
      endTime: "11:00",
      customerName: "Geannuleerd",
      status: "geannuleerd",
    });
    await insertBookingAt(db, {
      date: "2026-10-07",
      time: "10:00",
      endTime: "11:00",
      customerName: "Buiten bereik",
    });
    await db.insert(schema.blockedPeriods).values([
      { startDate: "2026-10-01", endDate: "2026-10-05", reason: "Vakantie" },
      { startDate: "2026-10-06", endDate: "2026-10-06", startTime: "14:00", endTime: "15:00" },
      { startDate: "2026-10-08", endDate: "2026-10-09" },
    ]);

    const { data } = agendaResponse.parse(
      (await get("/api/admin/agenda?start=2026-10-05&end=2026-10-06")).json(),
    );
    assert.deepEqual(
      data.bookings.map((b) => b.customer_name),
      ["Meerdaags", "Geannuleerd"],
    );
    assert.equal(data.bookings[0]!.pickup_date, "2026-10-05");
    assert.equal(data.bookings[0]!.pickup_time, "12:00");
    assert.deepEqual(
      data.blocked_periods.map((b) => [b.start_date, b.start_time, b.end_time]),
      [
        ["2026-10-01", null, null],
        ["2026-10-06", "14:00", "15:00"],
      ],
    );
  });
});

describe("catalogue, settings and gallery", () => {
  test("GET /api/admin/services: all kinds incl. inactive, legacy fields, package contents", async () => {
    const { data, meta } = servicesResponse.parse((await get("/api/admin/services")).json());
    assert.equal(meta.total, 8);
    const byTitle = new Map(data.map((s) => [s.title, s]));
    assert.equal(byTitle.get("Weg")!.active, false);
    assert.equal(byTitle.get("Express")!.bookable, false);
    assert.equal(byTitle.get("Wax")!.price, 65);
    assert.equal(byTitle.get("Wax")!.duration_minutes, 60);
    assert.equal(byTitle.get("Ozon")!.kind, "extra");
    assert.deepEqual(
      [...byTitle.get("Full detail")!.included_service_ids].sort(),
      [c.services.wax.id, c.services.interior.id].sort(),
    );
    assert.deepEqual(byTitle.get("Wax")!.included_service_ids, []);
  });

  test("GET /api/admin/vehicle-types: all types with the full pricing matrix", async () => {
    const { data, meta } = vehicleTypesResponse.parse(
      (await get("/api/admin/vehicle-types")).json(),
    );
    assert.equal(meta.total, 3);
    assert.deepEqual(
      data.map((v) => v.slug),
      ["oud", "sedan", "suv"],
    ); // sort_order 0, 10, 20
    const sedan = data.find((v) => v.slug === "sedan")!;
    assert.equal(sedan.services.length, 8);
    const row = (title: string) => sedan.services.find((s) => s.title === title)!;
    assert.deepEqual([row("Wax").price, row("Wax").duration_minutes], [74.75, 60]);
    assert.equal(row("Motorruimte").available, false);
    assert.equal(row("Weg").service_active, false);
    assert.equal(row("Express").service_bookable, false);
    assert.deepEqual(data.find((v) => v.slug === "oud")!.services, []);
  });

  test("GET /api/admin/blocked-periods: latest start first", async () => {
    await db.insert(schema.blockedPeriods).values([
      { startDate: "2026-10-01", endDate: "2026-10-02" },
      { startDate: "2026-12-24", endDate: "2026-12-26", reason: "Kerst", startTime: "12:00" },
    ]);
    const { data, meta } = blockedPeriodsResponse.parse(
      (await get("/api/admin/blocked-periods")).json(),
    );
    assert.equal(meta.total, 2);
    assert.deepEqual(
      data.map((b) => [b.start_date, b.reason, b.start_time, b.end_time]),
      [
        ["2026-12-24", "Kerst", "12:00", null],
        ["2026-10-01", null, null, null],
      ],
    );
  });

  test("GET /api/admin/settings: one object; missing row → 500 SETTINGS_NOT_CONFIGURED", async () => {
    const { data } = settingsResponse.parse((await get("/api/admin/settings")).json());
    assert.equal(data.opening_hour, "10:00");
    assert.equal(data.closing_hour, "18:00");
    assert.equal(data.slot_interval_minutes, 30);
    assert.equal(data.km_fee, 1);
    assert.equal(data.free_km, 20);

    await db.delete(schema.siteSettings);
    const missing = await get("/api/admin/settings");
    assertError(missing, 500, "SETTINGS_NOT_CONFIGURED");
  });

  test("GET /api/admin/gallery: all fields incl. timestamps, by sort_order", async () => {
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
    const { data, meta } = galleryResponse.parse((await get("/api/admin/gallery")).json());
    assert.equal(meta.total, 2);
    assert.deepEqual(
      data.map((g) => [g.title, g.before_image_url, g.category, g.sort_order]),
      [
        ["A", "/a0.jpg", "Polish", 1],
        ["B", null, null, 2],
      ],
    );
  });

  test("there is no admin reviews endpoint (the current UI has no review management)", async () => {
    assertError(await get("/api/admin/reviews"), 404, "NOT_FOUND");
  });
});
