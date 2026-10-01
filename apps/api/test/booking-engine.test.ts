// Pricing, availability and booking services against PGlite (real PostgreSQL, all migrations).

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { bookingRequestSchema, type ParsedBookingRequest } from "@autowascenter/shared";
import { eq, sql } from "drizzle-orm";
import { schema, type Database } from "../src/db/index.ts";
import { AppError } from "../src/errors/app-error.ts";
import { getAvailability } from "../src/services/availability.service.ts";
import {
  createBooking,
  insertBooking,
  type BookingDetails,
  type BookingDraft,
} from "../src/services/booking.service.ts";
import { calculatePricing, resolveSelection } from "../src/services/pricing.service.ts";
import { planJob, toScheduleSettings } from "../src/services/schedule.ts";
import {
  DAY,
  insertBookingAt,
  localIso,
  NOW,
  seedCatalog,
  type Catalog,
} from "./helpers/fixtures.ts";
import { createTestDb } from "./helpers/test-db.ts";

let db: Database;
let reset: () => Promise<unknown>;
let close: () => Promise<void>;
let c: Catalog;

before(async () => {
  const t = await createTestDb();
  db = t.db;
  reset = t.reset;
  close = () => t.pg.close();
});
after(() => close());
beforeEach(async () => {
  await reset();
  c = await seedCatalog(db);
});

async function rejectsWith(promise: Promise<unknown>, status: number, code: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof AppError, `expected AppError, got ${String(err)}`);
    assert.equal(err.statusCode, status);
    assert.equal(err.code, code);
    return true;
  });
}

function request(overrides: Partial<Record<string, unknown>> = {}): ParsedBookingRequest {
  return bookingRequestSchema.parse({
    vehicle_type_id: c.vehicleTypes.sedan.id,
    service_ids: [c.services.wax.id],
    preferred_date: DAY,
    preferred_time: "10:00",
    customer_name: "Jan Peeters",
    customer_phone: "0470123456",
    customer_email: "jan@example.com",
    vehicle_brand: "BMW",
    vehicle_model: "3-Reeks",
    ...overrides,
  });
}

/** Booking details for a direct insertBooking() call (bypassing the schedule pre-check). */
function detailsFor(req: ParsedBookingRequest): BookingDetails {
  return {
    vehicleTypeId: req.vehicle_type_id,
    customerName: req.customer_name,
    customerEmail: req.customer_email,
    customerPhone: req.customer_phone,
    companyName: null,
    vatNumber: null,
    notes: null,
    vehicleBrand: req.vehicle_brand,
    vehicleModel: req.vehicle_model,
    preferredDate: req.preferred_date,
    preferredTime: req.preferred_time,
    status: "nieuw",
    location: { onLocation: false, locationInSintNiklaas: null, locationAddress: null },
  };
}

const count = async (table: typeof schema.bookings | typeof schema.bookingServices) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n;

describe("pricing", () => {
  const price = async (vehicle: "sedan" | "suv", ids: string[]) => {
    const sel = await resolveSelection(db, c.vehicleTypes[vehicle].id, ids);
    return { ...sel, totals: calculatePricing(sel.lines, 0) };
  };

  test("one service uses vehicle_type_services, not the legacy services.price", async () => {
    const p = await price("sedan", [c.services.wax.id]);
    assert.equal(p.totals.servicesSubtotal, 7475); // not 65.00
    assert.equal(p.totalDurationMinutes, 60);
    assert.equal(p.totals.vat, 1570);
    assert.equal(p.totals.totalInclVat, 9045);
  });

  test("several services are summed (price and duration)", async () => {
    const p = await price("sedan", [c.services.wax.id, c.services.interior.id]);
    assert.equal(p.totals.servicesSubtotal, 12975);
    assert.equal(p.totalDurationMinutes, 150);
  });

  test("a package is priced by its own row, not by its contents", async () => {
    const p = await price("sedan", [c.services.fullDetail.id]);
    assert.equal(p.totals.servicesSubtotal, 25000);
    assert.equal(p.totalDurationMinutes, 240);
  });

  test("package + extra, and package + included service (both counted, as today)", async () => {
    const withExtra = await price("sedan", [c.services.fullDetail.id, c.services.ozone.id]);
    assert.equal(withExtra.totals.servicesSubtotal, 32500);
    assert.equal(withExtra.totalDurationMinutes, 300);

    const withIncluded = await price("sedan", [c.services.fullDetail.id, c.services.wax.id]);
    assert.equal(withIncluded.totals.servicesSubtotal, 25000 + 7475);
    assert.equal(withIncluded.totalDurationMinutes, 300);
  });

  test("the vehicle type determines price and duration", async () => {
    const suv = await price("suv", [c.services.wax.id]);
    assert.equal(suv.totals.servicesSubtotal, 9100);
    assert.equal(suv.totalDurationMinutes, 75);
  });

  test("lines are ordered by title (legacy 'first service' semantics)", async () => {
    const p = await price("sedan", [
      c.services.wax.id,
      c.services.interior.id,
      c.services.ozone.id,
    ]);
    assert.deepEqual(
      p.lines.map((l) => l.title),
      ["Interieur", "Ozon", "Wax"],
    );
  });

  test("unknown, inactive, walk-in and unavailable services are SERVICE_NOT_FOUND", async () => {
    for (const id of [
      "00000000-0000-4000-8000-000000000000",
      c.services.inactive.id,
      c.services.walkIn.id,
      c.services.notForSedan.id,
      c.services.interior.id, // no row for SUV
    ]) {
      const vehicle =
        id === c.services.interior.id ? c.vehicleTypes.suv.id : c.vehicleTypes.sedan.id;
      await rejectsWith(
        resolveSelection(db, vehicle, [c.services.wax.id, id]),
        404,
        "SERVICE_NOT_FOUND",
      );
    }
  });

  test("unknown or inactive vehicle type is VEHICLE_TYPE_NOT_FOUND", async () => {
    await rejectsWith(
      resolveSelection(db, c.vehicleTypes.inactive.id, [c.services.wax.id]),
      404,
      "VEHICLE_TYPE_NOT_FOUND",
    );
  });

  test("a catalogue price change does not alter existing bookings (snapshot)", async () => {
    const first = await createBooking(db, request(), NOW);
    await db
      .update(schema.vehicleTypeServices)
      .set({ price: "99.00" })
      .where(eq(schema.vehicleTypeServices.serviceId, c.services.wax.id));

    const [snapshot] = await db
      .select({ price: schema.bookingServices.price })
      .from(schema.bookingServices)
      .where(eq(schema.bookingServices.bookingId, first.id));
    assert.equal(snapshot!.price, "74.75");
    const [booking] = await db
      .select({ total: schema.bookings.totalPrice })
      .from(schema.bookings)
      .where(eq(schema.bookings.id, first.id));
    assert.equal(booking!.total, "74.75");

    const second = await createBooking(db, request({ preferred_time: "12:00" }), NOW);
    assert.equal(second.pricing.total_excl_vat, 99);
  });
});

describe("availability", () => {
  const slotsFor = async (serviceIds: string[], date = DAY, now = NOW) =>
    (
      await getAvailability(db, { date, vehicleTypeId: c.vehicleTypes.sedan.id, serviceIds }, now)
    ).slots.map((s) => s.time);

  const allWaxSlots = Array.from({ length: 15 }, (_, i) => {
    const m = 600 + i * 30;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  });

  test("a free day offers every grid start whose work ends by closing time", async () => {
    assert.deepEqual(await slotsFor([c.services.wax.id]), allWaxSlots); // 10:00 … 17:00
  });

  test("returns absolute start/end and pickup", async () => {
    const data = await getAvailability(
      db,
      { date: DAY, vehicleTypeId: c.vehicleTypes.sedan.id, serviceIds: [c.services.wax.id] },
      NOW,
    );
    assert.equal(data.total_duration_minutes, 60);
    assert.deepEqual(data.slots[0], {
      time: "10:00",
      start_at: localIso(DAY, "10:00"),
      end_at: localIso(DAY, "11:00"),
      pickup_date: DAY,
      pickup_time: "11:00",
    });
  });

  test("an existing booking removes overlapping starts; adjacent starts stay", async () => {
    await insertBookingAt(db, { date: DAY, time: "12:00", endTime: "14:00" });
    const slots = await slotsFor([c.services.wax.id]);
    for (const t of ["11:30", "12:00", "12:30", "13:00", "13:30"]) assert.ok(!slots.includes(t), t);
    assert.ok(slots.includes("11:00")); // ends exactly at 12:00
    assert.ok(slots.includes("14:00")); // starts exactly at 14:00
  });

  test("overlap at the start, at the end and full containment are all conflicts", async () => {
    await insertBookingAt(db, { date: DAY, time: "12:00", endTime: "13:00" });
    const slots = await slotsFor([c.services.interior.id]); // 90 min
    assert.ok(!slots.includes("11:00")); // 11:00-12:30 overlaps its start
    assert.ok(!slots.includes("12:30")); // 12:30-14:00 overlaps its end
    assert.ok(!slots.includes("11:30")); // 11:30-13:00 contains it
    assert.ok(slots.includes("10:30")); // 10:30-12:00 adjacent
    assert.ok(slots.includes("13:00"));
  });

  test("cancelled bookings do not block", async () => {
    await insertBookingAt(db, {
      date: DAY,
      time: "10:00",
      endTime: "18:00",
      status: "geannuleerd",
    });
    assert.deepEqual(await slotsFor([c.services.wax.id]), allWaxSlots);
  });

  test("blocked periods: whole day, time range and multi-day", async () => {
    await db
      .insert(schema.blockedPeriods)
      .values({ startDate: DAY, endDate: DAY, startTime: "14:00", endTime: "15:00" });
    const slots = await slotsFor([c.services.wax.id]);
    assert.ok(!slots.includes("13:30") && !slots.includes("14:30"));
    assert.ok(slots.includes("13:00") && slots.includes("15:00"));

    await db
      .insert(schema.blockedPeriods)
      .values({ startDate: "2026-10-04", endDate: "2026-10-06" });
    assert.deepEqual(await slotsFor([c.services.wax.id]), []);
  });

  test("nothing outside opening hours", async () => {
    const slots = await slotsFor([c.services.fullDetail.id]); // 240 min
    assert.equal(slots.at(-1), "14:00"); // 14:00 + 4h = 18:00 closing
    assert.ok(!slots.includes("14:30"));
  });

  test("multi-day work starts at opening and respects bookings on later days", async () => {
    assert.deepEqual(await slotsFor([c.services.coating.id]), ["10:00"]); // 900 min → until next day 17:00
    // A booking on the NEXT day (ignored by the old frontend) now blocks the slot.
    await insertBookingAt(db, { date: "2026-10-06", time: "16:00", endTime: "17:00" });
    assert.deepEqual(await slotsFor([c.services.coating.id]), []);
  });

  test("a multi-day booking from an earlier day blocks the following day", async () => {
    await insertBookingAt(db, {
      date: "2026-10-04",
      time: "10:00",
      endDate: DAY,
      endTime: "12:00",
    });
    const slots = await slotsFor([c.services.wax.id]);
    assert.equal(slots[0], "12:00");
  });

  test("today: only starts after the current Brussels minute; past dates: none", async () => {
    const today = await slotsFor([c.services.wax.id], "2026-10-01"); // NOW = 10:00 local
    assert.equal(today[0], "10:30");
    assert.deepEqual(await slotsFor([c.services.wax.id], "2026-09-30"), []);
    // 23:30 UTC is already the next day in Brussels: that day is "today" at 01:30.
    const late = await slotsFor(
      [c.services.wax.id],
      "2026-10-02",
      new Date("2026-10-01T23:30:00Z"),
    );
    assert.equal(late[0], "10:00");
  });

  test("DST change day uses local slot times", async () => {
    const data = await getAvailability(
      db,
      {
        date: "2026-10-25",
        vehicleTypeId: c.vehicleTypes.sedan.id,
        serviceIds: [c.services.wax.id],
      },
      NOW,
    );
    assert.equal(data.slots[0]!.time, "10:00");
    assert.equal(data.slots[0]!.start_at, "2026-10-25T09:00:00.000Z"); // CET after the change
  });
});

describe("booking creation", () => {
  test("stores server-computed values, snapshots and legacy fields", async () => {
    const res = await createBooking(
      db,
      request({ service_ids: [c.services.wax.id, c.services.interior.id], notes: "" }),
      NOW,
    );
    assert.equal(res.status, "nieuw");
    assert.equal(res.total_duration_minutes, 150);
    assert.equal(res.pricing.total_excl_vat, 129.75);
    assert.equal(res.pricing.total_incl_vat, 157); // 129.75 + 27.25 (27.2475 → 27.25)

    const [row] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, res.id));
    assert.equal(row!.status, "nieuw");
    assert.equal(row!.totalPrice, "129.75");
    assert.equal(row!.locationFee, "0.00");
    assert.equal(row!.totalDurationMinutes, 150);
    assert.equal(row!.startAt.toISOString(), localIso(DAY, "10:00"));
    assert.equal(row!.endAt.toISOString(), localIso(DAY, "12:30"));
    assert.equal(row!.serviceId, c.services.interior.id); // first by title
    assert.equal(row!.serviceTitle, "Interieur, Wax");
    assert.equal(row!.vehicleInfo, "BMW 3-Reeks");
    assert.equal(row!.notes, null);
    assert.match(row!.cancelToken, /^[0-9a-f-]{36}$/);

    const lines = await db
      .select()
      .from(schema.bookingServices)
      .where(eq(schema.bookingServices.bookingId, res.id));
    assert.deepEqual(lines.map((l) => [l.serviceTitle, l.price, l.durationMinutes]).sort(), [
      ["Interieur", "55.00", 90],
      ["Wax", "74.75", 60],
    ]);
  });

  test("location fields follow the frontend payload rules; fee stays 0", async () => {
    const inSn = await createBooking(
      db,
      request({ on_location: true, location_in_sint_niklaas: true }),
      NOW,
    );
    const other = await createBooking(
      db,
      request({
        preferred_time: "12:00",
        on_location: true,
        location_in_sint_niklaas: false,
        location_address: "Straat 12, 9000 Gent",
      }),
      NOW,
    );
    const rows = await db.select().from(schema.bookings);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get(inSn.id)!.locationInSintNiklaas, true);
    assert.equal(byId.get(inSn.id)!.locationAddress, null);
    assert.equal(byId.get(other.id)!.locationAddress, "Straat 12, 9000 Gent");
    assert.equal(other.pricing.location_fee, 0);
  });

  test("a multi-day booking stores the real pickup moment", async () => {
    const res = await createBooking(db, request({ service_ids: [c.services.coating.id] }), NOW);
    assert.equal(res.end_at, localIso("2026-10-06", "17:00"));
    assert.equal(res.pickup_date, "2026-10-06");
    assert.equal(res.pickup_time, "17:00");
  });

  test("rejects extras only, past times, off-grid times and outside hours", async () => {
    await rejectsWith(
      createBooking(db, request({ service_ids: [c.services.ozone.id] }), NOW),
      422,
      "MAIN_SERVICE_REQUIRED",
    );
    await rejectsWith(
      createBooking(db, request({ preferred_date: "2026-10-01", preferred_time: "10:00" }), NOW),
      422,
      "BOOKING_IN_PAST",
    );
    await rejectsWith(
      createBooking(db, request({ preferred_time: "10:15" }), NOW),
      422,
      "BOOKING_OUTSIDE_OPENING_HOURS",
    );
    await rejectsWith(
      createBooking(db, request({ preferred_time: "17:30" }), NOW),
      422,
      "BOOKING_OUTSIDE_OPENING_HOURS",
    );
    await rejectsWith(
      createBooking(db, request({ preferred_time: "08:00" }), NOW),
      422,
      "BOOKING_OUTSIDE_OPENING_HOURS",
    );
    assert.equal(await count(schema.bookings), 0);
  });

  test("rejects a slot taken by a booking or a blocked period with 409", async () => {
    await insertBookingAt(db, { date: DAY, time: "10:30", endTime: "11:30" });
    await rejectsWith(createBooking(db, request(), NOW), 409, "BOOKING_SLOT_UNAVAILABLE");
    await db
      .insert(schema.blockedPeriods)
      .values({ startDate: DAY, endDate: DAY, startTime: "15:00" });
    await rejectsWith(
      createBooking(db, request({ preferred_time: "15:00" }), NOW),
      409,
      "BOOKING_SLOT_UNAVAILABLE",
    );
  });
});

describe("transaction and concurrency", () => {
  test("two simultaneous bookings for the same slot: one succeeds, one conflicts", async () => {
    const results = await Promise.allSettled([
      createBooking(db, request(), NOW),
      createBooking(db, request({ customer_name: "Tweede Klant" }), NOW),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    assert.equal(ok.length, 1);
    assert.equal(failed.length, 1);
    const reason = (failed[0] as PromiseRejectedResult).reason as AppError;
    assert.equal(reason.statusCode, 409);
    assert.equal(reason.code, "BOOKING_SLOT_UNAVAILABLE");
    assert.equal(await count(schema.bookings), 1);
  });

  test("an overlap that slips past the pre-check is stopped by the exclusion constraint → 409", async () => {
    // Simulates a competing transaction that committed after our availability check:
    // the draft is inserted directly, bypassing the pre-check.
    await insertBookingAt(db, { date: DAY, time: "10:00", endTime: "11:00" });
    const req = request();
    const sel = await resolveSelection(db, req.vehicle_type_id, req.service_ids);
    const draft: BookingDraft = {
      details: detailsFor(req),
      lines: sel.lines,
      totalDurationMinutes: sel.totalDurationMinutes,
      pricing: calculatePricing(sel.lines, 0),
      job: planJob(DAY, 600, 60, toScheduleSettings("10:00", "18:00", 30))!,
    };
    await rejectsWith(
      db.transaction((tx) => insertBooking(tx as unknown as Database, draft)),
      409,
      "BOOKING_SLOT_UNAVAILABLE",
    );
    assert.equal(await count(schema.bookings), 1);
  });

  test("a failure after the booking insert rolls everything back", async () => {
    const req = request();
    const sel = await resolveSelection(db, req.vehicle_type_id, req.service_ids);
    const broken: BookingDraft = {
      details: detailsFor(req),
      // Unknown service id → booking_services FK violation after the booking row was inserted.
      lines: [{ ...sel.lines[0]!, serviceId: "00000000-0000-4000-8000-000000000000" }],
      totalDurationMinutes: sel.totalDurationMinutes,
      pricing: calculatePricing(sel.lines, 0),
      job: planJob(DAY, 600, 60, toScheduleSettings("10:00", "18:00", 30))!,
    };
    await assert.rejects(db.transaction((tx) => insertBooking(tx as unknown as Database, broken)));
    assert.equal(await count(schema.bookings), 0);
    assert.equal(await count(schema.bookingServices), 0);
  });
});
