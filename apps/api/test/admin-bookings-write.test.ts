// Admin booking writes: create / update (move, services, status) / delete, admin availability
// with exclude_booking_id, and read-after-write consistency. PGlite + local test Auth0.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { createApp } from "../src/app.ts";
import { bookingDetailResponse, bookingsListResponse } from "../src/contracts/admin.ts";
import {
  adminAvailabilityResponse,
  adminBookingWriteResponse,
} from "../src/contracts/admin-write.ts";
import { schema, type Database } from "../src/db/index.ts";
import { createTestAuth, type TestAuth } from "./helpers/auth.ts";
import { DAY, localIso, NOW, seedCatalog, type Catalog } from "./helpers/fixtures.ts";
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
    clock: () => NOW, // Thursday 2026-10-01 10:00 Brussels; opening 10:00–18:00, 30-min grid
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

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
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

function bookingBody(overrides: Record<string, unknown> = {}) {
  return {
    vehicle_type_id: c.vehicleTypes.sedan.id,
    service_ids: [c.services.wax.id],
    preferred_date: DAY,
    preferred_time: "10:00",
    customer_name: "Jan Peeters",
    customer_email: "jan@example.com",
    customer_phone: "0470123456",
    vehicle_brand: "BMW",
    vehicle_model: "3-Reeks",
    ...overrides,
  };
}

async function create(overrides: Record<string, unknown> = {}) {
  const res = await call("POST", "/api/admin/bookings", bookingBody(overrides));
  assert.equal(res.status, 201, res.body);
  return adminBookingWriteResponse.parse(res.json()).data;
}

async function detail(id: string) {
  return bookingDetailResponse.parse((await call("GET", `/api/admin/bookings/${id}`)).json()).data;
}

const count = async (table: typeof schema.bookings | typeof schema.bookingServices) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n;

describe("POST /api/admin/bookings", () => {
  test("creates with server-side price, duration, times, snapshots and a generated cancel token", async () => {
    const res = await call(
      "POST",
      "/api/admin/bookings",
      bookingBody({ service_ids: [c.services.wax.id, c.services.interior.id] }),
    );
    assert.equal(res.status, 201);
    const { data } = adminBookingWriteResponse.parse(res.json());
    assert.equal(data.status, "bevestigd"); // UI default
    assert.equal(data.total_duration_minutes, 150);
    assert.equal(data.total_price, 129.75);
    assert.deepEqual(data.pricing, {
      services_subtotal: 129.75,
      location_fee: 0,
      total_excl_vat: 129.75,
      vat_rate: 0.21,
      vat: 27.25,
      total_incl_vat: 157,
      currency: "EUR",
    });
    assert.equal(data.start_at, localIso(DAY, "10:00"));
    assert.equal(data.end_at, localIso(DAY, "12:30"));
    assert.deepEqual(
      data.services.map((s) => [s.service_title, s.price]),
      [
        ["Interieur", 55],
        ["Wax", 74.75],
      ],
    );
    assert.equal(data.service_title, "Interieur, Wax");
    const [row] = await db.select({ token: schema.bookings.cancelToken }).from(schema.bookings);
    assert.match(row!.token, /^[0-9a-f-]{36}$/);
    assert.ok(!res.body.includes(row!.token));
    assert.deepEqual(await detail(data.id), (({ pricing: _p, ...rest }) => rest)(data));
  });

  test("multi-day work stores the real pickup moment", async () => {
    const data = await create({ service_ids: [c.services.coating.id] }); // 900 min
    assert.equal(data.end_at, localIso("2026-10-06", "17:00"));
    assert.equal(data.pickup_date, "2026-10-06");
  });

  test("an extra alone is allowed for admins; status choice is validated", async () => {
    const extra = await create({ service_ids: [c.services.ozone.id], status: "nieuw" });
    assert.equal(extra.status, "nieuw");
    for (const status of ["geannuleerd", "confirmed"]) {
      assertError(
        await call("POST", "/api/admin/bookings", bookingBody({ status, preferred_time: "14:00" })),
        400,
        "VALIDATION_ERROR",
      );
    }
  });

  test("never trusts client price, duration, cancel token or timestamps", async () => {
    for (const extra of [
      { total_price: 1 },
      { total_duration_minutes: 5 },
      { location_fee: 0 },
      { cancel_token: UNKNOWN_ID },
      { start_at: "2026-10-05T08:00:00Z" },
      { price: 0 },
    ]) {
      assertError(
        await call("POST", "/api/admin/bookings", bookingBody(extra)),
        400,
        "VALIDATION_ERROR",
      );
    }
    assert.equal(await count(schema.bookings), 0);
  });

  test("validation, unknown references, opening hours, past and overlap", async () => {
    assertError(
      await call("POST", "/api/admin/bookings", bookingBody({ customer_email: "x" })),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await call("POST", "/api/admin/bookings", bookingBody({ customer_name: " " })),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await call("POST", "/api/admin/bookings", bookingBody({ vehicle_type_id: UNKNOWN_ID })),
      404,
      "VEHICLE_TYPE_NOT_FOUND",
    );
    assertError(
      await call(
        "POST",
        "/api/admin/bookings",
        bookingBody({ service_ids: [c.services.inactive.id] }),
      ),
      404,
      "SERVICE_NOT_FOUND",
    );
    assertError(
      await call("POST", "/api/admin/bookings", bookingBody({ preferred_time: "10:15" })),
      422,
      "BOOKING_OUTSIDE_OPENING_HOURS",
    );
    assertError(
      await call("POST", "/api/admin/bookings", bookingBody({ preferred_time: "17:30" })),
      422,
      "BOOKING_OUTSIDE_OPENING_HOURS",
    );
    assertError(
      await call("POST", "/api/admin/bookings", bookingBody({ preferred_date: "2026-09-30" })),
      422,
      "BOOKING_IN_PAST",
    );
    await create();
    assertError(
      await call("POST", "/api/admin/bookings", bookingBody({ preferred_time: "10:30" })),
      409,
      "BOOKING_SLOT_UNAVAILABLE",
    );
    assert.equal(await count(schema.bookings), 1);
  });
});

describe("PATCH /api/admin/bookings/:id — moving (exclude_booking_id)", () => {
  // A = 10:00–12:00 and B = 13:00–15:00 (wax + ozone = 120 min).
  const twoHours = () => [c.services.wax.id, c.services.ozone.id];

  test("move into another booking → 409; overlapping its OWN old time → allowed", async () => {
    const a = await create({ service_ids: twoHours(), preferred_time: "10:00" });
    await create({ service_ids: twoHours(), preferred_time: "13:00", customer_name: "B" });

    assertError(
      await call("PATCH", `/api/admin/bookings/${a.id}`, { preferred_time: "13:30" }),
      409,
      "BOOKING_SLOT_UNAVAILABLE",
    );
    assertError(
      await call("PATCH", `/api/admin/bookings/${a.id}`, { preferred_time: "12:00" }),
      409,
      "BOOKING_SLOT_UNAVAILABLE",
    ); // 12–14 hits B
    assert.equal((await detail(a.id)).preferred_time, "10:00"); // unchanged after 409s

    const moved = await call("PATCH", `/api/admin/bookings/${a.id}`, { preferred_time: "11:00" });
    assert.equal(moved.status, 200, moved.body);
    const { data } = adminBookingWriteResponse.parse(moved.json());
    assert.equal(data.start_at, localIso(DAY, "11:00"));
    assert.equal(data.end_at, localIso(DAY, "13:00")); // adjacent to B is fine

    const back = await call("PATCH", `/api/admin/bookings/${a.id}`, { preferred_time: "10:00" });
    assert.equal(back.status, 200);
    assert.equal((await detail(a.id)).end_at, localIso(DAY, "12:00"));
  });

  test("date change, past and off-grid moves; price is kept when only moving", async () => {
    const a = await create();
    await db.update(schema.vehicleTypeServices).set({ price: "99.00" });
    const moved = adminBookingWriteResponse.parse(
      (
        await call("PATCH", `/api/admin/bookings/${a.id}`, {
          preferred_date: "2026-10-06",
          preferred_time: "14:00",
        })
      ).json(),
    ).data;
    assert.equal(moved.preferred_date, "2026-10-06");
    assert.equal(moved.start_at, localIso("2026-10-06", "14:00"));
    assert.equal(moved.total_price, 74.75); // not re-priced by a move
    assertError(
      await call("PATCH", `/api/admin/bookings/${a.id}`, { preferred_date: "2026-09-29" }),
      422,
      "BOOKING_IN_PAST",
    );
    assertError(
      await call("PATCH", `/api/admin/bookings/${a.id}`, { preferred_time: "14:10" }),
      422,
      "BOOKING_OUTSIDE_OPENING_HOURS",
    );
  });

  test("service change re-prices, re-times and replaces snapshots server-side", async () => {
    const a = await create();
    const res = await call("PATCH", `/api/admin/bookings/${a.id}`, {
      service_ids: [c.services.interior.id, c.services.ozone.id],
    });
    assert.equal(res.status, 200, res.body);
    const { data } = adminBookingWriteResponse.parse(res.json());
    assert.equal(data.total_price, 130);
    assert.equal(data.total_duration_minutes, 150);
    assert.equal(data.end_at, localIso(DAY, "12:30"));
    assert.equal(data.service_title, "Interieur, Ozon");
    assert.deepEqual(
      data.services.map((s) => s.service_title),
      ["Interieur", "Ozon"],
    );
    assert.equal(await count(schema.bookingServices), 2);

    const suv = adminBookingWriteResponse.parse(
      (
        await call("PATCH", `/api/admin/bookings/${a.id}`, {
          vehicle_type_id: c.vehicleTypes.suv.id,
          service_ids: [c.services.wax.id],
        })
      ).json(),
    ).data;
    assert.equal(suv.vehicle_type?.slug, "suv");
    assert.equal(suv.total_price, 91);
    assert.equal(suv.total_duration_minutes, 75);
  });

  test("a longer service selection that would overlap another booking → 409, nothing changes", async () => {
    const a = await create({ preferred_time: "10:00" }); // 10–11
    await create({ preferred_time: "11:00", customer_name: "B" }); // 11–12
    assertError(
      await call("PATCH", `/api/admin/bookings/${a.id}`, { service_ids: [c.services.interior.id] }),
      409,
      "BOOKING_SLOT_UNAVAILABLE",
    );
    const after = await detail(a.id);
    assert.equal(after.total_duration_minutes, 60);
    assert.deepEqual(
      after.services.map((s) => s.service_title),
      ["Wax"],
    );
  });

  test("validation and unknown ids", async () => {
    const a = await create();
    assertError(await call("PATCH", `/api/admin/bookings/${a.id}`, {}), 400, "VALIDATION_ERROR");
    assertError(
      await call("PATCH", `/api/admin/bookings/${a.id}`, { total_price: 1 }),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await call("PATCH", `/api/admin/bookings/${a.id}`, { total_duration_minutes: 30 }),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await call("PATCH", `/api/admin/bookings/${a.id}`, { status: "done" }),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await call("PATCH", "/api/admin/bookings/not-a-uuid", { status: "bevestigd" }),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await call("PATCH", `/api/admin/bookings/${UNKNOWN_ID}`, { status: "bevestigd" }),
      404,
      "RESOURCE_NOT_FOUND",
    );
    assertError(
      await call("PATCH", `/api/admin/bookings/${a.id}`, { service_ids: [UNKNOWN_ID] }),
      404,
      "SERVICE_NOT_FOUND",
    );
  });
});

describe("PATCH /api/admin/bookings/:id — status and notes", () => {
  test("nieuw → bevestigd → voltooid, and notes", async () => {
    const a = await create({ status: "nieuw" });
    for (const status of ["bevestigd", "voltooid"] as const) {
      const res = await call("PATCH", `/api/admin/bookings/${a.id}`, { status });
      assert.equal(adminBookingWriteResponse.parse(res.json()).data.status, status);
    }
    const noted = adminBookingWriteResponse.parse(
      (await call("PATCH", `/api/admin/bookings/${a.id}`, { notes: "Sleutel bij buren" })).json(),
    ).data;
    assert.equal(noted.notes, "Sleutel bij buren");
    const cleared = adminBookingWriteResponse.parse(
      (await call("PATCH", `/api/admin/bookings/${a.id}`, { notes: "" })).json(),
    ).data;
    assert.equal(cleared.notes, null);
  });

  test("cancel sets cancelled_at and frees the slot; reactivation clears it and re-checks overlap", async () => {
    const a = await create({ status: "nieuw" });
    const cancelled = adminBookingWriteResponse.parse(
      (await call("PATCH", `/api/admin/bookings/${a.id}`, { status: "geannuleerd" })).json(),
    ).data;
    assert.equal(cancelled.status, "geannuleerd");
    assert.equal(cancelled.cancelled_at, NOW.toISOString());

    // Reactivate while the slot is free → OK, cancelled_at cleared.
    const back = adminBookingWriteResponse.parse(
      (await call("PATCH", `/api/admin/bookings/${a.id}`, { status: "bevestigd" })).json(),
    ).data;
    assert.equal(back.status, "bevestigd");
    assert.equal(back.cancelled_at, null);

    // Cancel again, someone else takes the slot, reactivation must fail.
    await call("PATCH", `/api/admin/bookings/${a.id}`, { status: "geannuleerd" });
    await create({ customer_name: "Nieuwe klant" });
    assertError(
      await call("PATCH", `/api/admin/bookings/${a.id}`, { status: "bevestigd" }),
      409,
      "BOOKING_SLOT_UNAVAILABLE",
    );
    assert.equal((await detail(a.id)).status, "geannuleerd");
  });

  test("updated_at is maintained by the database", async () => {
    const a = await create();
    await db.execute(sql`UPDATE bookings SET updated_at = '2000-01-01' WHERE id = ${a.id}`);
    await call("PATCH", `/api/admin/bookings/${a.id}`, { notes: "x" });
    assert.ok(new Date((await detail(a.id)).updated_at).getUTCFullYear() > 2000);
  });
});

describe("DELETE /api/admin/bookings/:id", () => {
  test("deletes booking + snapshot rows; reads reflect it; unknown → 404", async () => {
    const a = await create();
    const del = await call("DELETE", `/api/admin/bookings/${a.id}`);
    assert.equal(del.status, 204);
    assert.equal(del.body, "");
    assertError(await call("GET", `/api/admin/bookings/${a.id}`), 404, "RESOURCE_NOT_FOUND");
    assert.equal(
      bookingsListResponse.parse((await call("GET", "/api/admin/bookings")).json()).meta.total,
      0,
    );
    assert.equal(await count(schema.bookingServices), 0);
    assertError(await call("DELETE", `/api/admin/bookings/${a.id}`), 404, "RESOURCE_NOT_FOUND");
    assertError(await call("DELETE", "/api/admin/bookings/nope"), 400, "VALIDATION_ERROR");
  });
});

describe("GET /api/admin/availability (exclude_booking_id)", () => {
  test("the booking being moved does not block its own slot", async () => {
    const a = await create(); // 10:00–11:00
    const withExclude = adminAvailabilityResponse.parse(
      (await call("GET", `/api/admin/availability?date=${DAY}&exclude_booking_id=${a.id}`)).json(),
    ).data;
    assert.equal(withExclude.total_duration_minutes, 60);
    assert.equal(withExclude.slots[0]!.time, "10:00");

    const forOthers = adminAvailabilityResponse.parse(
      (
        await call(
          "GET",
          `/api/admin/availability?date=${DAY}&vehicle_type_id=${c.vehicleTypes.sedan.id}&service_ids=${c.services.wax.id}`,
        )
      ).json(),
    ).data;
    assert.equal(forOthers.slots[0]!.time, "11:00");
    assert.equal(forOthers.exclude_booking_id, null);
  });

  test("validation and unknown booking", async () => {
    assertError(await call("GET", `/api/admin/availability?date=${DAY}`), 400, "VALIDATION_ERROR");
    assertError(
      await call("GET", `/api/admin/availability?date=${DAY}&service_ids=${c.services.wax.id}`),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await call("GET", `/api/admin/availability?date=${DAY}&exclude_booking_id=${UNKNOWN_ID}`),
      404,
      "RESOURCE_NOT_FOUND",
    );
  });
});

describe("data integrity after booking writes", () => {
  test("no orphan snapshot rows and every booking has its lines", async () => {
    const a = await create({ service_ids: [c.services.wax.id, c.services.interior.id] });
    await call("PATCH", `/api/admin/bookings/${a.id}`, { service_ids: [c.services.ozone.id] });
    const b = await create({ preferred_time: "14:00" });
    await call("DELETE", `/api/admin/bookings/${b.id}`);
    const [orphans] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.bookingServices)
      .leftJoin(schema.bookings, eq(schema.bookings.id, schema.bookingServices.bookingId))
      .where(isNull(schema.bookings.id));
    assert.equal(orphans!.n, 0);
    const lines = await db
      .select()
      .from(schema.bookingServices)
      .where(eq(schema.bookingServices.bookingId, a.id));
    assert.deepEqual(
      lines.map((l) => l.serviceTitle),
      ["Ozon"],
    );
  });
});
