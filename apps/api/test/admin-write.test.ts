// Admin catalogue/content writes + the authorization matrix for EVERY admin write endpoint.
// PGlite + local test Auth0 keys.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createApp } from "../src/app.ts";
import {
  blockedPeriodResponse,
  galleryItemResponse,
  serviceResponse,
  settingsResponse,
  vehicleTypeResponse,
} from "../src/contracts/admin-write.ts";
import { schema, type Database } from "../src/db/index.ts";
import { createTestAuth, type TestAuth } from "./helpers/auth.ts";
import { DAY, insertBookingAt, NOW, seedCatalog, type Catalog } from "./helpers/fixtures.ts";
import { createTestDb } from "./helpers/test-db.ts";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let db: Database;
let reset: () => Promise<unknown>;
let closeDb: () => Promise<void>;
let app: FastifyInstance;
let auth: TestAuth;
let token: string;
let c: Catalog;

before(async () => {
  const t = await createTestDb();
  db = t.db;
  reset = t.reset;
  closeDb = () => t.pg.close();
  auth = await createTestAuth();
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
  await closeDb();
});
beforeEach(async () => {
  await reset();
  c = await seedCatalog(db);
});

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

async function call(method: Method, url: string, body?: unknown, bearer: string | null = token) {
  const res = await app.inject({
    method,
    url,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    ...(body === undefined ? {} : { payload: body as object }),
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

const rowCount = async (sqlText: string) =>
  ((await db.execute(sql.raw(sqlText))) as unknown as { rows: { n: number }[] }).rows[0]!.n;

describe("authorization matrix (every admin write endpoint)", () => {
  const endpoints = (): [Method, string, unknown][] => [
    [
      "POST",
      "/api/admin/bookings",
      {
        vehicle_type_id: c.vehicleTypes.sedan.id,
        service_ids: [c.services.wax.id],
        preferred_date: DAY,
        preferred_time: "10:00",
        customer_name: "X",
        customer_email: "x@example.com",
        customer_phone: "1",
      },
    ],
    ["PATCH", `/api/admin/bookings/${UNKNOWN_ID}`, { status: "bevestigd" }],
    ["DELETE", `/api/admin/bookings/${UNKNOWN_ID}`, undefined],
    ["GET", `/api/admin/availability?date=${DAY}&exclude_booking_id=${UNKNOWN_ID}`, undefined],
    ["POST", "/api/admin/services", { kind: "dienst" }],
    ["PATCH", `/api/admin/services/${c.services.wax.id}`, { title: "Gehackt" }],
    ["PUT", `/api/admin/services/${c.services.fullDetail.id}/package-content`, { service_ids: [] }],
    ["DELETE", `/api/admin/services/${c.services.wax.id}`, undefined],
    ["POST", "/api/admin/vehicle-types", {}],
    ["PATCH", `/api/admin/vehicle-types/${c.vehicleTypes.sedan.id}`, { title: "Gehackt" }],
    ["DELETE", `/api/admin/vehicle-types/${c.vehicleTypes.suv.id}`, undefined],
    // Interieur: Wax is deleted earlier in this list.
    [
      "PUT",
      `/api/admin/vehicle-types/${c.vehicleTypes.sedan.id}/pricing`,
      {
        rows: [
          { service_id: c.services.interior.id, available: true, price: 0, duration_minutes: 1 },
        ],
      },
    ],
    ["POST", "/api/admin/blocked-periods", { start_date: DAY, end_date: DAY }],
    ["DELETE", `/api/admin/blocked-periods/${UNKNOWN_ID}`, undefined],
    ["PATCH", "/api/admin/settings", { km_fee: 9 }],
    ["POST", "/api/admin/gallery", { image_url: "/x.jpg" }],
    ["PATCH", `/api/admin/gallery/${UNKNOWN_ID}`, { title: "x" }],
    ["DELETE", `/api/admin/gallery/${UNKNOWN_ID}`, undefined],
  ];

  test("no token → 401, invalid token → 401, no permission → 403, and nothing changes", async () => {
    const snapshot = () =>
      rowCount(`SELECT (
        (SELECT count(*) FROM bookings) + (SELECT count(*) FROM services) +
        (SELECT count(*) FROM vehicle_types) + (SELECT count(*) FROM vehicle_type_services) +
        (SELECT count(*) FROM package_services) + (SELECT count(*) FROM blocked_periods) +
        (SELECT count(*) FROM gallery_items))::int AS n`);
    const before = await snapshot();
    const foreign = await auth.foreignToken();
    const noPermission = await auth.token({ permissions: ["bookings:write"], roles: ["admin"] });
    for (const [method, url, body] of endpoints()) {
      assertError(await call(method, url, body, null), 401, "AUTHENTICATION_REQUIRED");
      assertError(await call(method, url, body, foreign), 401, "AUTHENTICATION_INVALID");
      assertError(await call(method, url, body, noPermission), 403, "AUTHORIZATION_REQUIRED");
    }
    assert.equal(await snapshot(), before);
    const [wax] = await db
      .select()
      .from(schema.services)
      .where(eq(schema.services.id, c.services.wax.id));
    assert.equal(wax!.title, "Wax");
  });

  test("admin token → success (or the documented 404 for unknown ids)", async () => {
    for (const [method, url, body] of endpoints()) {
      const res = await call(method, url, body);
      if (url.includes(UNKNOWN_ID)) assertError(res, 404, "RESOURCE_NOT_FOUND");
      else
        assert.ok(
          [200, 201, 204].includes(res.status),
          `${method} ${url}: ${res.status} ${res.body}`,
        );
    }
  });
});

describe("services", () => {
  test("POST creates the service + a pricing row for EVERY vehicle type with the UI defaults", async () => {
    const res = await call("POST", "/api/admin/services", { kind: "pakket" });
    assert.equal(res.status, 201);
    const { data } = serviceResponse.parse(res.json());
    assert.equal(data.title, "Nieuw pakket");
    assert.equal(data.icon, "sparkles");
    assert.equal(data.sort_order, 8); // number of existing services
    assert.equal(data.bookable, true);
    assert.equal(data.active, true);
    const rows = await db
      .select()
      .from(schema.vehicleTypeServices)
      .where(eq(schema.vehicleTypeServices.serviceId, data.id));
    assert.equal(rows.length, 3); // sedan, suv and the inactive type
    assert.ok(rows.every((r) => r.price === "0.00" && r.durationMinutes === 60 && r.available));
    assert.equal(
      serviceResponse.parse((await call("POST", "/api/admin/services", { kind: "extra" })).json())
        .data.title,
      "Nieuwe extra dienst",
    );
  });

  test("POST/PATCH validation", async () => {
    for (const body of [
      {},
      { kind: "anders" },
      { kind: "dienst", price: -1 },
      { kind: "dienst", price: 1.234 },
      { kind: "dienst", duration_minutes: 0 },
      { kind: "dienst", id: UNKNOWN_ID },
    ]) {
      assertError(await call("POST", "/api/admin/services", body), 400, "VALIDATION_ERROR");
    }
    assertError(
      await call("PATCH", `/api/admin/services/${c.services.wax.id}`, {}),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await call("PATCH", `/api/admin/services/${c.services.wax.id}`, { title: "" }),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await call("PATCH", `/api/admin/services/${UNKNOWN_ID}`, { title: "x" }),
      404,
      "RESOURCE_NOT_FOUND",
    );
  });

  test("PATCH updates the UI fields; '' clears optional text", async () => {
    const res = await call("PATCH", `/api/admin/services/${c.services.wax.id}`, {
      title: "Wax Premium",
      active: false,
      bookable: false,
      badge: "Nieuw",
      description: "",
      sort_order: 3,
      kind: "extra",
      price: 70.5,
    });
    const { data } = serviceResponse.parse(res.json());
    assert.deepEqual(
      [
        data.title,
        data.active,
        data.bookable,
        data.badge,
        data.description,
        data.sort_order,
        data.kind,
        data.price,
      ],
      ["Wax Premium", false, false, "Nieuw", null, 3, "extra", 70.5],
    );
  });

  test("DELETE cascades catalogue rows but keeps booking snapshots (SET NULL)", async () => {
    const created = await call("POST", "/api/admin/bookings", {
      vehicle_type_id: c.vehicleTypes.sedan.id,
      service_ids: [c.services.wax.id],
      preferred_date: DAY,
      preferred_time: "10:00",
      customer_name: "K",
      customer_email: "k@example.com",
      customer_phone: "1",
    });
    const bookingId = (created.json() as { data: { id: string } }).data.id;
    assert.equal((await call("DELETE", `/api/admin/services/${c.services.wax.id}`)).status, 204);
    const [booking] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, bookingId));
    assert.equal(booking!.serviceId, null);
    assert.equal(booking!.serviceTitle, "Wax");
    const [line] = await db
      .select()
      .from(schema.bookingServices)
      .where(eq(schema.bookingServices.bookingId, bookingId));
    assert.deepEqual([line!.serviceId, line!.serviceTitle, line!.price], [null, "Wax", "74.75"]);
    assert.equal(
      await rowCount(
        `SELECT count(*)::int AS n FROM vehicle_type_services WHERE service_id = '${c.services.wax.id}'`,
      ),
      0,
    );
    assert.equal(
      await rowCount(
        `SELECT count(*)::int AS n FROM package_services WHERE service_id = '${c.services.wax.id}'`,
      ),
      0,
    );
    assertError(
      await call("DELETE", `/api/admin/services/${c.services.wax.id}`),
      404,
      "RESOURCE_NOT_FOUND",
    );
  });
});

describe("package contents", () => {
  const url = () => `/api/admin/services/${c.services.fullDetail.id}/package-content`;
  const contents = async () =>
    (
      await db
        .select({ id: schema.packageServices.serviceId })
        .from(schema.packageServices)
        .where(eq(schema.packageServices.packageId, c.services.fullDetail.id))
    )
      .map((r) => r.id)
      .sort();

  test("replaces the complete list", async () => {
    const res = await call("PUT", url(), { service_ids: [c.services.wax.id, c.services.ozone.id] });
    const { data } = serviceResponse.parse(res.json());
    assert.deepEqual(
      [...data.included_service_ids].sort(),
      [c.services.wax.id, c.services.ozone.id].sort(),
    );
    assert.deepEqual(await contents(), [c.services.wax.id, c.services.ozone.id].sort());
    assert.deepEqual(
      serviceResponse.parse((await call("PUT", url(), { service_ids: [] })).json()).data
        .included_service_ids,
      [],
    );
  });

  test("invalid requests change nothing", async () => {
    const before = await contents();
    const otherPackage = serviceResponse.parse(
      (await call("POST", "/api/admin/services", { kind: "pakket" })).json(),
    ).data.id;
    for (const [body, status] of [
      [{ service_ids: [c.services.wax.id, UNKNOWN_ID] }, 400],
      [{ service_ids: [c.services.fullDetail.id] }, 400], // itself
      [{ service_ids: [otherPackage] }, 400], // a package in a package
      [{ service_ids: [c.services.wax.id, c.services.wax.id] }, 400], // duplicates
      [{ service_ids: ["nope"] }, 400],
    ] as const) {
      assertError(await call("PUT", url(), body), status, "VALIDATION_ERROR");
    }
    assertError(
      await call("PUT", `/api/admin/services/${c.services.wax.id}/package-content`, {
        service_ids: [],
      }),
      400,
      "VALIDATION_ERROR",
    ); // not a package
    assertError(
      await call("PUT", `/api/admin/services/${UNKNOWN_ID}/package-content`, { service_ids: [] }),
      404,
      "RESOURCE_NOT_FOUND",
    );
    assert.deepEqual(await contents(), before);
  });
});

describe("vehicle types", () => {
  test("POST creates the type + rows for active, bookable services with the UI defaults", async () => {
    const res = await call("POST", "/api/admin/vehicle-types", {});
    assert.equal(res.status, 201);
    const { data } = vehicleTypeResponse.parse(res.json());
    assert.equal(data.slug, `nieuw-${NOW.getTime()}`);
    assert.equal(data.title, "Nieuw voertuigtype");
    assert.equal(data.sort_order, 30); // 3 existing × 10
    // Active + bookable in the seed: Wax, Interieur, Full detail, Ozon, Motorruimte, Coating.
    assert.equal(data.services.length, 6);
    assert.ok(
      data.services.every((s) => s.price === 30 && s.duration_minutes === 60 && s.available),
    );
  });

  test("slug rules: format → 400, duplicate on create or update → 409 RESOURCE_CONFLICT", async () => {
    assertError(
      await call("POST", "/api/admin/vehicle-types", { slug: "Met Spaties" }),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await call("POST", "/api/admin/vehicle-types", { slug: "sedan" }),
      409,
      "RESOURCE_CONFLICT",
    );
    assertError(
      await call("PATCH", `/api/admin/vehicle-types/${c.vehicleTypes.suv.id}`, { slug: "sedan" }),
      409,
      "RESOURCE_CONFLICT",
    );
    const ok = vehicleTypeResponse.parse(
      (
        await call("PATCH", `/api/admin/vehicle-types/${c.vehicleTypes.suv.id}`, {
          slug: "suv-4x4",
          title: "SUV / 4x4",
          active: false,
        })
      ).json(),
    ).data;
    assert.deepEqual([ok.slug, ok.title, ok.active], ["suv-4x4", "SUV / 4x4", false]);
    assertError(
      await call("PATCH", `/api/admin/vehicle-types/${UNKNOWN_ID}`, { title: "x" }),
      404,
      "RESOURCE_NOT_FOUND",
    );
  });

  test("DELETE: in use by bookings → 409 RESOURCE_IN_USE (still there); otherwise 204 + rows gone", async () => {
    await insertBookingAt(db, { date: DAY, time: "10:00", endTime: "11:00" });
    await db.update(schema.bookings).set({ vehicleTypeId: c.vehicleTypes.sedan.id });
    const inUse = await call("DELETE", `/api/admin/vehicle-types/${c.vehicleTypes.sedan.id}`);
    assertError(inUse, 409, "RESOURCE_IN_USE");
    assert.doesNotMatch(inUse.body, /foreign key|constraint|23503|violates/i);
    assert.equal(
      (await call("GET", "/api/admin/vehicle-types")).body.includes(c.vehicleTypes.sedan.id),
      true,
    );

    assert.equal(
      (await call("DELETE", `/api/admin/vehicle-types/${c.vehicleTypes.suv.id}`)).status,
      204,
    );
    assert.equal(
      await rowCount(
        `SELECT count(*)::int AS n FROM vehicle_type_services WHERE vehicle_type_id = '${c.vehicleTypes.suv.id}'`,
      ),
      0,
    );
    assertError(
      await call("DELETE", `/api/admin/vehicle-types/${c.vehicleTypes.suv.id}`),
      404,
      "RESOURCE_NOT_FOUND",
    );
  });
});

describe("pricing matrix", () => {
  const url = () => `/api/admin/vehicle-types/${c.vehicleTypes.suv.id}/pricing`;
  const row = (serviceId: string, price: number, duration = 60, available = true) => ({
    service_id: serviceId,
    available,
    price,
    duration_minutes: duration,
  });

  test("updates existing rows and creates missing ones in one request", async () => {
    const res = await call("PUT", url(), {
      rows: [row(c.services.wax.id, 95.5, 80), row(c.services.interior.id, 66, 100, false)],
    });
    assert.equal(res.status, 200, res.body);
    const { data } = vehicleTypeResponse.parse(res.json());
    const byTitle = new Map(data.services.map((s) => [s.title, s]));
    assert.deepEqual([byTitle.get("Wax")!.price, byTitle.get("Wax")!.duration_minutes], [95.5, 80]);
    assert.deepEqual(
      [byTitle.get("Interieur")!.price, byTitle.get("Interieur")!.available],
      [66, false],
    ); // created
    assert.equal(byTitle.get("Full detail")!.price, 350); // untouched
  });

  test("any invalid row → 400 and NO row changes", async () => {
    const before = await rowCount(
      `SELECT count(*)::int AS n FROM vehicle_type_services WHERE price = 91`,
    );
    for (const rows of [
      [row(c.services.wax.id, 1), row(c.services.fullDetail.id, 2), row(UNKNOWN_ID, 3)], // unknown service
      [row(c.services.wax.id, 1), row(c.services.wax.id, 2)], // duplicate
      [row(c.services.wax.id, 1), row(c.services.fullDetail.id, -2)], // negative price
      [row(c.services.wax.id, 1), row(c.services.fullDetail.id, 2, 0)], // duration 0
      [row(c.services.wax.id, 1.005)], // 3 decimals
      [],
    ]) {
      assertError(await call("PUT", url(), { rows }), 400, "VALIDATION_ERROR");
    }
    assert.equal(
      await rowCount(`SELECT count(*)::int AS n FROM vehicle_type_services WHERE price = 91`),
      before,
    );
    const [wax] = await db
      .select()
      .from(schema.vehicleTypeServices)
      .where(
        and(
          eq(schema.vehicleTypeServices.vehicleTypeId, c.vehicleTypes.suv.id),
          eq(schema.vehicleTypeServices.serviceId, c.services.wax.id),
        ),
      );
    assert.equal(wax!.price, "91.00");
    assertError(
      await call("PUT", `/api/admin/vehicle-types/${UNKNOWN_ID}/pricing`, {
        rows: [row(c.services.wax.id, 1)],
      }),
      404,
      "RESOURCE_NOT_FOUND",
    );
  });
});

describe("blocked periods", () => {
  test("create whole-day, time range and one-sided; delete; 404", async () => {
    const whole = blockedPeriodResponse.parse(
      (
        await call("POST", "/api/admin/blocked-periods", {
          start_date: DAY,
          end_date: "2026-10-07",
          reason: "Vakantie",
        })
      ).json(),
    ).data;
    assert.deepEqual([whole.start_time, whole.end_time, whole.reason], [null, null, "Vakantie"]);
    const range = blockedPeriodResponse.parse(
      (
        await call("POST", "/api/admin/blocked-periods", {
          start_date: DAY,
          end_date: DAY,
          start_time: "14:00",
          end_time: "15:30",
        })
      ).json(),
    ).data;
    assert.deepEqual([range.start_time, range.end_time], ["14:00", "15:30"]);
    const oneSided = await call("POST", "/api/admin/blocked-periods", {
      start_date: DAY,
      end_date: DAY,
      start_time: "16:00",
    });
    assert.equal(oneSided.status, 201);

    assert.equal((await call("DELETE", `/api/admin/blocked-periods/${whole.id}`)).status, 204);
    assertError(
      await call("DELETE", `/api/admin/blocked-periods/${whole.id}`),
      404,
      "RESOURCE_NOT_FOUND",
    );
  });

  test("validation", async () => {
    for (const body of [
      { start_date: "2026-10-06", end_date: DAY },
      { start_date: DAY, end_date: DAY, start_time: "15:00", end_time: "14:00" },
      { start_date: DAY, end_date: DAY, start_time: "14:00", end_time: "14:00" },
      { start_date: "2026-02-30", end_date: "2026-03-01" },
      { start_date: DAY, end_date: DAY, start_time: "25:00" },
      { start_date: DAY },
      { start_date: DAY, end_date: DAY, id: UNKNOWN_ID },
    ]) {
      assertError(await call("POST", "/api/admin/blocked-periods", body), 400, "VALIDATION_ERROR");
    }
  });
});

describe("settings", () => {
  test("partial update in place; other values unchanged; '' e-mail → null", async () => {
    const [before] = await db.select().from(schema.siteSettings);
    const { data } = settingsResponse.parse(
      (
        await call("PATCH", "/api/admin/settings", {
          km_fee: 1.5,
          free_km: 25,
          notification_email: "",
        })
      ).json(),
    );
    assert.deepEqual(
      [data.km_fee, data.free_km, data.notification_email, data.opening_hour, data.closing_hour],
      [1.5, 25, null, "10:00", "18:00"],
    );
    assert.equal(data.id, before!.id); // same row, not delete + insert
    const mail = settingsResponse.parse(
      (
        await call("PATCH", "/api/admin/settings", {
          notification_email: "info@autowascenter.be",
          opening_hour: "09:00",
        })
      ).json(),
    ).data;
    assert.deepEqual(
      [mail.notification_email, mail.opening_hour],
      ["info@autowascenter.be", "09:00"],
    );
  });

  test("invalid settings are rejected (also against stored values)", async () => {
    for (const body of [
      {},
      { closing_hour: "09:00" }, // stored opening 10:00
      { opening_hour: "18:00" }, // stored closing 18:00
      { opening_hour: "12:00", closing_hour: "11:00" },
      { slot_interval_minutes: 0 },
      { km_fee: -1 },
      { free_km: -5 },
      { notification_email: "geen-email" },
      { base_city: " " },
      { opening_hour: "8:00" },
    ]) {
      assertError(await call("PATCH", "/api/admin/settings", body), 400, "VALIDATION_ERROR");
    }
    const [after] = await db.select().from(schema.siteSettings);
    assert.equal(after!.openingHour.slice(0, 5), "10:00");
  });

  test("missing settings row → 500 SETTINGS_NOT_CONFIGURED", async () => {
    await db.delete(schema.siteSettings);
    assertError(
      await call("PATCH", "/api/admin/settings", { km_fee: 2 }),
      500,
      "SETTINGS_NOT_CONFIGURED",
    );
  });
});

describe("gallery metadata (no uploads)", () => {
  test("create / update / delete", async () => {
    await db.insert(schema.galleryItems).values({ imageUrl: "/a.jpg" });
    const created = galleryItemResponse.parse(
      (
        await call("POST", "/api/admin/gallery", {
          image_url: "https://cdn.example/b.jpg",
          title: "B",
        })
      ).json(),
    ).data;
    assert.equal(created.sort_order, 1); // galerij.tsx: items.length
    const updated = galleryItemResponse.parse(
      (
        await call("PATCH", `/api/admin/gallery/${created.id}`, {
          title: "Polish",
          description: "",
          sort_order: 5,
        })
      ).json(),
    ).data;
    assert.deepEqual(
      [updated.title, updated.description, updated.sort_order, updated.image_url],
      ["Polish", null, 5, "https://cdn.example/b.jpg"],
    );
    assert.equal((await call("DELETE", `/api/admin/gallery/${created.id}`)).status, 204);
    assertError(
      await call("DELETE", `/api/admin/gallery/${created.id}`),
      404,
      "RESOURCE_NOT_FOUND",
    );
  });

  test("validation: URL/path only, editable fields only", async () => {
    for (const body of [
      {},
      { image_url: "" },
      { image_url: "javascript:alert(1)" },
      { image_url: "//evil.example/x.jpg" },
      { image_url: "x.jpg" },
    ]) {
      assertError(await call("POST", "/api/admin/gallery", body), 400, "VALIDATION_ERROR");
    }
    const item = galleryItemResponse.parse(
      (await call("POST", "/api/admin/gallery", { image_url: "/c.jpg" })).json(),
    ).data;
    assertError(
      await call("PATCH", `/api/admin/gallery/${item.id}`, { image_url: "/other.jpg" }),
      400,
      "VALIDATION_ERROR",
    );
    assertError(await call("PATCH", `/api/admin/gallery/${item.id}`, {}), 400, "VALIDATION_ERROR");
  });
});
