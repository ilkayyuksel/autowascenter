// HTTP tests of GET /api/availability and POST /api/bookings via app.inject() (PGlite).

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { availabilityResponseSchema, bookingCreatedResponseSchema } from "@autowascenter/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createApp } from "../src/app.ts";
import { createDb, schema, type Database } from "../src/db/index.ts";
import { DAY, insertBookingAt, NOW, seedCatalog, type Catalog } from "./helpers/fixtures.ts";
import { createTestDb } from "./helpers/test-db.ts";

const ORIGIN = "http://localhost:8080";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let db: Database;
let reset: () => Promise<unknown>;
let close: () => Promise<void>;
let app: FastifyInstance;
let c: Catalog;

before(async () => {
  const t = await createTestDb();
  db = t.db;
  reset = t.reset;
  close = () => t.pg.close();
  app = await createApp({
    db,
    corsOrigins: [ORIGIN],
    logLevel: "silent",
    clock: () => NOW,
    bookingRateLimit: { max: 1000, timeWindowMs: 60_000 },
  });
});
after(async () => {
  await app.close();
  await close();
});
beforeEach(async () => {
  await reset();
  c = await seedCatalog(db);
});

const errorSchema = z.strictObject({
  error: z.strictObject({ code: z.string(), message: z.string() }),
});
function assertError(
  res: { statusCode: number; json: () => unknown },
  status: number,
  code: string,
) {
  assert.equal(res.statusCode, status);
  const body = errorSchema.parse(res.json());
  assert.equal(body.error.code, code);
  return body.error;
}

const availability = (query: string) =>
  app.inject({ method: "GET", url: `/api/availability?${query}` });

const book = (body: Record<string, unknown>, target: FastifyInstance = app) =>
  target.inject({ method: "POST", url: "/api/bookings", payload: body });

function bookingBody(overrides: Record<string, unknown> = {}) {
  return {
    vehicle_type_id: c.vehicleTypes.sedan.id,
    service_ids: [c.services.wax.id, c.services.ozone.id],
    preferred_date: DAY,
    preferred_time: "10:00",
    customer_name: "Jan Peeters",
    customer_phone: "0470123456",
    customer_email: "jan@example.com",
    vehicle_brand: "BMW",
    vehicle_model: "3-Reeks",
    notes: "",
    company_name: "",
    vat_number: "",
    on_location: false,
    location_in_sint_niklaas: true,
    location_address: "",
    ...overrides,
  };
}

describe("GET /api/availability", () => {
  test("returns slots in the documented contract", async () => {
    const res = await availability(
      `date=${DAY}&vehicle_type_id=${c.vehicleTypes.sedan.id}&service_ids=${c.services.wax.id},${c.services.interior.id}`,
    );
    assert.equal(res.statusCode, 200);
    const body = availabilityResponseSchema.parse(res.json());
    assert.equal(body.data.total_duration_minutes, 150);
    assert.equal(body.data.slots[0]!.time, "10:00");
    assert.equal(body.data.slots.at(-1)!.time, "15:30"); // 15:30 + 2.5h = 18:00
  });

  test("accepts service_ids as a repeated parameter", async () => {
    const res = await availability(
      `date=${DAY}&vehicle_type_id=${c.vehicleTypes.sedan.id}&service_ids=${c.services.wax.id}&service_ids=${c.services.interior.id}`,
    );
    assert.equal(res.statusCode, 200);
  });

  test("validates the query", async () => {
    const vt = c.vehicleTypes.sedan.id;
    const wax = c.services.wax.id;
    for (const q of [
      `vehicle_type_id=${vt}&service_ids=${wax}`, // missing date
      `date=2026-02-30&vehicle_type_id=${vt}&service_ids=${wax}`, // impossible date
      `date=${DAY}&vehicle_type_id=not-a-uuid&service_ids=${wax}`, // malformed uuid
      `date=${DAY}&vehicle_type_id=${vt}&service_ids=`, // no services
      `date=${DAY}&vehicle_type_id=${vt}&service_ids=${wax},${wax}`, // duplicate
      `date=${DAY}&vehicle_type_id=${vt}&service_ids=${wax}&extra=1`, // unknown parameter
    ]) {
      assertError(await availability(q), 400, "VALIDATION_ERROR");
    }
  });

  test("unknown vehicle type and unavailable service are 404", async () => {
    assertError(
      await availability(
        `date=${DAY}&vehicle_type_id=${UNKNOWN_ID}&service_ids=${c.services.wax.id}`,
      ),
      404,
      "VEHICLE_TYPE_NOT_FOUND",
    );
    assertError(
      await availability(
        `date=${DAY}&vehicle_type_id=${c.vehicleTypes.sedan.id}&service_ids=${c.services.notForSedan.id}`,
      ),
      404,
      "SERVICE_NOT_FOUND",
    );
  });
});

describe("POST /api/bookings", () => {
  test("creates a booking and returns the documented contract (no secrets)", async () => {
    const res = await book(bookingBody());
    assert.equal(res.statusCode, 201);
    const body = bookingCreatedResponseSchema.parse(res.json());
    assert.equal(body.data.status, "nieuw");
    assert.equal(body.data.total_duration_minutes, 120);
    assert.deepEqual(body.data.pricing, {
      services_subtotal: 149.75,
      location_fee: 0,
      total_excl_vat: 149.75,
      vat_rate: 0.21,
      vat: 31.45,
      total_incl_vat: 181.2,
      currency: "EUR",
    });
    assert.doesNotMatch(res.body, /cancel_token|cancelToken/);
  });

  test("rejects client-supplied price, total, duration, status or cancel token", async () => {
    for (const field of [
      { total_price: 1 },
      { total_duration_minutes: 1 },
      { status: "bevestigd" },
      { cancel_token: UNKNOWN_ID },
      { location_fee: 0 },
      { start_at: "2026-10-05T08:00:00Z" },
      { price: 0 },
    ]) {
      const res = await book(bookingBody(field));
      assertError(res, 400, "VALIDATION_ERROR");
    }
    assert.equal((await db.select().from(schema.bookings)).length, 0);
  });

  test("validates customer fields like the current frontend", async () => {
    const cases: Record<string, unknown>[] = [
      { customer_name: "J" },
      { customer_phone: "123" },
      { customer_email: "geen-email" },
      { vehicle_brand: " " },
      { on_location: true, location_in_sint_niklaas: false, location_address: "kort" },
      { preferred_time: "25:00" },
      { preferred_date: "05-10-2026" },
      { service_ids: [] },
      { vehicle_type_id: "not-a-uuid" },
    ];
    for (const override of cases) {
      assertError(await book(bookingBody(override)), 400, "VALIDATION_ERROR");
    }
    const malformed = await app.inject({
      method: "POST",
      url: "/api/bookings",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    assert.equal(malformed.statusCode, 400);
    errorSchema.parse(malformed.json());
  });

  test("unknown vehicle type, unavailable service, extras only", async () => {
    assertError(
      await book(bookingBody({ vehicle_type_id: UNKNOWN_ID })),
      404,
      "VEHICLE_TYPE_NOT_FOUND",
    );
    assertError(
      await book(bookingBody({ service_ids: [c.services.walkIn.id] })),
      404,
      "SERVICE_NOT_FOUND",
    );
    assertError(
      await book(bookingBody({ service_ids: [c.services.ozone.id] })),
      422,
      "MAIN_SERVICE_REQUIRED",
    );
  });

  test("slot conflict, outside opening hours and past", async () => {
    await insertBookingAt(db, { date: DAY, time: "11:00", endTime: "12:00" });
    assertError(await book(bookingBody()), 409, "BOOKING_SLOT_UNAVAILABLE");
    assertError(
      await book(bookingBody({ preferred_time: "07:00" })),
      422,
      "BOOKING_OUTSIDE_OPENING_HOURS",
    );
    assertError(await book(bookingBody({ preferred_date: "2026-09-01" })), 422, "BOOKING_IN_PAST");
  });

  test("two simultaneous requests for the same slot: exactly one 201", async () => {
    const [a, b] = await Promise.all([
      book(bookingBody()),
      book(bookingBody({ customer_name: "Ander" })),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409]);
    const conflict = a.statusCode === 409 ? a : b;
    assert.doesNotMatch(conflict.body, /23P01|exclusion|constraint|tstzrange/i);
  });

  test("CORS preflight allows POST from the configured origin only", async () => {
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/bookings",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers["access-control-allow-origin"], ORIGIN);
    assert.match(String(preflight.headers["access-control-allow-methods"]), /POST/);

    const other = await app.inject({
      method: "OPTIONS",
      url: "/api/bookings",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    assert.equal(other.headers["access-control-allow-origin"], undefined);
  });

  test("rate limit returns 429 RATE_LIMITED in the error shape", async () => {
    const limited = await createApp({
      db,
      corsOrigins: [ORIGIN],
      logLevel: "silent",
      clock: () => NOW,
      bookingRateLimit: { max: 2, timeWindowMs: 60_000 },
    });
    try {
      // Non-overlapping 2-hour bookings, so only the limiter can reject the third.
      const first = await book(bookingBody({ preferred_time: "10:00" }), limited);
      const second = await book(bookingBody({ preferred_time: "13:00" }), limited);
      assert.deepEqual([first.statusCode, second.statusCode], [201, 201]);
      const third = await book(bookingBody({ preferred_time: "16:00" }), limited);
      assertError(third, 429, "RATE_LIMITED");
      // Other endpoints are not limited.
      assert.equal((await limited.inject({ method: "GET", url: "/api/services" })).statusCode, 200);
    } finally {
      await limited.close();
    }
  });

  test("database failures return 503/500 without internals and store nothing", async () => {
    const { db: downDb, pool } = createDb("postgres://user:s3cret@127.0.0.1:1/nope", {
      connectionTimeoutMillis: 2_000,
    });
    const downApp = await createApp({
      db: downDb,
      corsOrigins: [ORIGIN],
      logLevel: "silent",
      clock: () => NOW,
    });
    try {
      const res = await book(bookingBody(), downApp);
      assertError(res, 503, "DATABASE_UNAVAILABLE");
      assert.doesNotMatch(res.body, /s3cret|127\.0\.0\.1|ECONNREFUSED|stack/i);
      assertError(
        await downApp.inject({
          method: "GET",
          url: `/api/availability?date=${DAY}&vehicle_type_id=${UNKNOWN_ID}&service_ids=${UNKNOWN_ID}`,
        }),
        503,
        "DATABASE_UNAVAILABLE",
      );
    } finally {
      await downApp.close();
      await pool.end();
    }
  });
});
