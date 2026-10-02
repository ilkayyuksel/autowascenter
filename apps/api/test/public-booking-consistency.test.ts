// Phase 7B: the public booking now goes through POST /api/bookings. These tests use the
// exact payload shape the frontend sends (src/lib/api/public-writes.ts: blank optional
// fields omitted) and check that (1) the admin API sees exactly that booking, and (2)
// GET /api/availability is only a preflight: POST /api/bookings applies the same rules again
// and stays authoritative.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { availabilityResponseSchema, bookingCreatedResponseSchema } from "@autowascenter/shared";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/app.ts";
import { bookingDetailResponse, bookingsListResponse } from "../src/contracts/admin.ts";
import type { Database } from "../src/db/index.ts";
import { createTestAuth } from "./helpers/auth.ts";
import { DAY, NOW, seedCatalog, type Catalog } from "./helpers/fixtures.ts";
import { createTestDb } from "./helpers/test-db.ts";

let db: Database;
let reset: () => Promise<unknown>;
let close: () => Promise<void>;
let app: FastifyInstance;
let token: string;
let c: Catalog;

before(async () => {
  const t = await createTestDb();
  db = t.db;
  reset = t.reset;
  close = () => t.pg.close();
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
  await app.close();
  await close();
});
beforeEach(async () => {
  await reset();
  c = await seedCatalog(db);
});

/** Exactly what toPublicBookingRequest() produces for a simple booking. */
const frontendPayload = (time = "10:00") => ({
  vehicle_type_id: c.vehicleTypes.sedan.id,
  service_ids: [c.services.wax.id, c.services.ozone.id],
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
const adminGet = (url: string) =>
  app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
const slots = async () => {
  const res = await app.inject({
    method: "GET",
    url: `/api/availability?date=${DAY}&vehicle_type_id=${c.vehicleTypes.sedan.id}&service_ids=${c.services.wax.id},${c.services.ozone.id}`,
  });
  return availabilityResponseSchema.parse(res.json()).data.slots.map((s) => s.time);
};

describe("public booking ↔ admin API consistency", () => {
  test("the booking created via POST /api/bookings is exactly what the admin API returns", async () => {
    const res = await post(frontendPayload());
    assert.equal(res.statusCode, 201, res.body);
    const created = bookingCreatedResponseSchema.parse(res.json()).data;

    const detailRes = await adminGet(`/api/admin/bookings/${created.id}`);
    assert.equal(detailRes.statusCode, 200);
    const detail = bookingDetailResponse.parse(detailRes.json()).data;
    assert.equal(detail.status, "nieuw");
    assert.equal(detail.preferred_date, created.preferred_date);
    assert.equal(detail.preferred_time, created.preferred_time);
    assert.equal(detail.start_at, created.start_at);
    assert.equal(detail.end_at, created.end_at);
    assert.equal(detail.pickup_date, created.pickup_date);
    assert.equal(detail.pickup_time, created.pickup_time);
    assert.equal(detail.total_duration_minutes, created.total_duration_minutes);
    assert.equal(detail.total_price, created.pricing.total_excl_vat);
    assert.equal(detail.customer_email, "jan@example.com");
    assert.equal(detail.vehicle_type?.id, c.vehicleTypes.sedan.id);
    assert.deepEqual(
      detail.services.map((l) => [l.service_id, l.price, l.duration_minutes]).sort(),
      created.services.map((s) => [s.service_id, s.price, s.duration_minutes]).sort(),
    );

    const list = bookingsListResponse.parse((await adminGet("/api/admin/bookings")).json());
    assert.deepEqual(
      list.data.map((b) => b.id),
      [created.id],
    );
  });

  test("availability is a preflight; POST re-checks with the same rules", async () => {
    const before = await slots();
    assert.ok(before.includes("10:00"));

    assert.equal((await post(frontendPayload("10:00"))).statusCode, 201);
    // The taken slot is no longer offered, and booking it anyway is refused (409).
    const after = await slots();
    assert.ok(!after.includes("10:00"));
    const again = await post(frontendPayload("10:00"));
    assert.equal(again.statusCode, 409);
    assert.equal(
      (again.json() as { error: { code: string } }).error.code,
      "BOOKING_SLOT_UNAVAILABLE",
    );

    // A time the availability never offers (off the grid) is refused by POST as well.
    assert.ok(!before.includes("10:10"));
    const offGrid = await post(frontendPayload("10:10"));
    assert.equal(offGrid.statusCode, 422);

    // Every slot still offered can really be booked.
    const next = after[0]!;
    assert.equal((await post(frontendPayload(next))).statusCode, 201);
  });

  test("server-only fields in the public payload are rejected (400), nothing stored", async () => {
    const res = await post({ ...frontendPayload(), total_price: 1, status: "bevestigd" });
    assert.equal(res.statusCode, 400);
    const list = bookingsListResponse.parse((await adminGet("/api/admin/bookings")).json());
    assert.equal(list.meta.total, 0);
  });
});
