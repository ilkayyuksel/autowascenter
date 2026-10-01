// Admin booking mutations. Uses the SAME engine as POST /api/bookings (pricing, duration,
// location fee, schedule validation, overlap protection); see booking.service.ts.

import { VAT_RATE } from "@autowascenter/shared";
import { and, eq, ne, sql } from "drizzle-orm";
import type { AdminBookingCreate, AdminBookingPatch } from "../../contracts/admin-write.ts";
import type { Database } from "../../db/index.ts";
import { bookings, bookingServices } from "../../db/schema/index.ts";
import { AppError } from "../../errors/app-error.ts";
import {
  guardOverlap,
  insertBooking,
  legacyServiceColumns,
  planNewBooking,
  replaceBookingLines,
  slotUnavailable,
  validateSchedule,
} from "../booking.service.ts";
import { computeSlots } from "../availability.service.ts";
import {
  calculateLocationFeeCents,
  calculatePricing,
  resolveSelection,
  toPricingContract,
  vatCents,
  type PricedLine,
} from "../pricing.service.ts";
import { getAdminBooking } from "./bookings.service.ts";
import { hhmm } from "./mappers.ts";

const bookingNotFound = () => new AppError(404, "RESOURCE_NOT_FOUND", "Booking not found.");

/** Detail + pricing summary derived from the stored (server-computed) amounts. */
async function bookingWithPricing(db: Database, id: string) {
  const booking = await getAdminBooking(db, id);
  const totalExclVat = Math.round(booking.total_price * 100);
  const locationFee = Math.round(booking.location_fee * 100);
  const vat = vatCents(totalExclVat, VAT_RATE);
  return {
    ...booking,
    pricing: toPricingContract({
      servicesSubtotal: totalExclVat - locationFee,
      locationFee,
      totalExclVat,
      vat,
      totalInclVat: totalExclVat + vat,
    }),
  };
}

/**
 * POST /api/admin/bookings. One transaction: resolve + price services, validate opening
 * hours / grid / not-in-past / blocked periods / overlap, insert booking + snapshots.
 */
export async function createAdminBooking(db: Database, input: AdminBookingCreate, now: Date) {
  // The agenda dialog has no on-location fields: same location-fee rule as the public flow.
  const location = { onLocation: false, locationInSintNiklaas: null, locationAddress: null };
  const id = await db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    const planned = await planNewBooking(
      t,
      {
        vehicleTypeId: input.vehicle_type_id,
        serviceIds: input.service_ids,
        date: input.preferred_date,
        time: input.preferred_time,
        location,
        // The admin dialog lists every kind, extras included (agenda.tsx:510-530).
        requireMainService: false,
      },
      now,
    );
    return insertBooking(t, {
      ...planned,
      details: {
        vehicleTypeId: input.vehicle_type_id,
        customerName: input.customer_name,
        customerEmail: input.customer_email,
        customerPhone: input.customer_phone,
        companyName: null,
        vatNumber: null,
        notes: input.notes ?? null,
        vehicleBrand: input.vehicle_brand ?? null,
        vehicleModel: input.vehicle_model ?? null,
        preferredDate: input.preferred_date,
        preferredTime: input.preferred_time,
        status: input.status,
        location,
      },
    });
  });
  return bookingWithPricing(db, id);
}

/** Overlap with any other active booking (used when a cancelled booking is reactivated). */
async function assertNoOverlappingBooking(tx: Database, id: string, startAt: Date, endAt: Date) {
  const [clash] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        ne(bookings.id, id),
        ne(bookings.status, "geannuleerd"),
        sql`tstzrange(${bookings.startAt}, ${bookings.endAt}, '[)') && tstzrange(${startAt.toISOString()}::timestamptz, ${endAt.toISOString()}::timestamptz, '[)')`,
      ),
    )
    .limit(1);
  if (clash) throw slotUnavailable();
}

/**
 * PATCH /api/admin/bookings/:id. One transaction with the booking row locked.
 * - service_ids / vehicle_type_id → re-priced and re-timed from the database, snapshots
 *   replaced; the stored price is otherwise kept (moving a booking does not re-price it).
 * - preferred_date / preferred_time → opening hours, slot grid, not in the past, overlap.
 * - Every overlap check EXCLUDES this booking itself; the exclusion constraint is final.
 * - status → geannuleerd sets cancelled_at; reactivation clears it and re-checks overlap.
 */
export async function updateAdminBooking(
  db: Database,
  id: string,
  patch: AdminBookingPatch,
  now: Date,
) {
  await db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    const [current] = await t
      .select({
        status: bookings.status,
        vehicleTypeId: bookings.vehicleTypeId,
        preferredDate: bookings.preferredDate,
        preferredTime: bookings.preferredTime,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        totalDurationMinutes: bookings.totalDurationMinutes,
        onLocation: bookings.onLocation,
        locationInSintNiklaas: bookings.locationInSintNiklaas,
        locationAddress: bookings.locationAddress,
      })
      .from(bookings)
      .where(eq(bookings.id, id))
      .for("update");
    if (!current) throw bookingNotFound();

    const set: Partial<typeof bookings.$inferInsert> = {};
    const status = patch.status ?? current.status;
    const active = status !== "geannuleerd";
    const reactivated = current.status === "geannuleerd" && active;

    // 1. Services / vehicle type → re-price from the database.
    let lines: PricedLine[] | undefined;
    let durationMinutes = current.totalDurationMinutes;
    const servicesChanged = patch.service_ids !== undefined || patch.vehicle_type_id !== undefined;
    if (servicesChanged) {
      const vehicleTypeId = patch.vehicle_type_id ?? current.vehicleTypeId;
      if (!vehicleTypeId) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Invalid request: vehicle_type_id is required for this booking.",
        );
      }
      const serviceIds = patch.service_ids ?? (await currentServiceIds(t, id));
      const selection = await resolveSelection(t, vehicleTypeId, serviceIds);
      lines = selection.lines;
      durationMinutes = selection.totalDurationMinutes;
      const pricing = calculatePricing(
        lines,
        calculateLocationFeeCents({
          onLocation: current.onLocation,
          locationInSintNiklaas: current.locationInSintNiklaas,
          locationAddress: current.locationAddress,
        }),
      );
      Object.assign(set, {
        vehicleTypeId,
        totalDurationMinutes: durationMinutes,
        totalPrice: (pricing.totalExclVat / 100).toFixed(2),
        locationFee: (pricing.locationFee / 100).toFixed(2),
        ...legacyServiceColumns(lines),
      });
    }

    // 2. Schedule → validate (excluding this booking) and recompute start_at/end_at.
    const date = patch.preferred_date ?? current.preferredDate;
    const time = patch.preferred_time ?? hhmm(current.preferredTime);
    const timeChanged = date !== current.preferredDate || time !== hhmm(current.preferredTime);
    if (timeChanged || servicesChanged) {
      const job = await validateSchedule(t, { date, time, durationMinutes }, now, {
        enforceGrid: timeChanged,
        enforceFuture: timeChanged,
        checkOccupancy: active,
        excludeBookingId: id,
      });
      Object.assign(set, {
        preferredDate: date,
        preferredTime: time,
        startAt: job.startAt,
        endAt: job.endAt,
      });
    } else if (reactivated) {
      await assertNoOverlappingBooking(t, id, current.startAt, current.endAt);
    }

    // 3. Status and notes.
    if (patch.status !== undefined && patch.status !== current.status) {
      set.status = patch.status;
      if (patch.status === "geannuleerd") set.cancelledAt = now;
      else if (current.status === "geannuleerd") set.cancelledAt = null;
    }
    if (patch.notes !== undefined) set.notes = patch.notes;

    if (Object.keys(set).length > 0) {
      await guardOverlap(() => t.update(bookings).set(set).where(eq(bookings.id, id)));
    }
    if (lines) await replaceBookingLines(t, id, lines);
  });
  return bookingWithPricing(db, id);
}

async function currentServiceIds(tx: Database, bookingId: string): Promise<string[]> {
  const rows = await tx
    .select({ serviceId: bookingServices.serviceId })
    .from(bookingServices)
    .where(eq(bookingServices.bookingId, bookingId));
  const ids = rows.map((r) => r.serviceId);
  if (ids.length === 0 || ids.some((s) => s === null)) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Invalid request: service_ids is required because the booking's services cannot be re-resolved.",
    );
  }
  return ids as string[];
}

/** DELETE /api/admin/bookings/:id. booking_services rows go with it (FK CASCADE). */
export async function deleteAdminBooking(db: Database, id: string) {
  const [row] = await db.delete(bookings).where(eq(bookings.id, id)).returning({ id: bookings.id });
  if (!row) throw bookingNotFound();
}

/**
 * GET /api/admin/availability. Same slot engine as the public endpoint; the duration comes
 * from the chosen services or, when only exclude_booking_id is given, from that booking.
 * The excluded booking never blocks its own move.
 */
export async function getAdminAvailability(
  db: Database,
  query: {
    date: string;
    excludeBookingId?: string;
    vehicleTypeId?: string;
    serviceIds?: string[];
  },
  now: Date,
) {
  let durationMinutes: number;
  if (query.vehicleTypeId && query.serviceIds) {
    durationMinutes = (await resolveSelection(db, query.vehicleTypeId, query.serviceIds))
      .totalDurationMinutes;
  } else {
    const [booking] = await db
      .select({ duration: bookings.totalDurationMinutes })
      .from(bookings)
      .where(eq(bookings.id, query.excludeBookingId!))
      .limit(1);
    if (!booking) throw bookingNotFound();
    durationMinutes = booking.duration;
  }
  if (query.excludeBookingId && query.serviceIds) {
    const [exists] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.id, query.excludeBookingId))
      .limit(1);
    if (!exists) throw bookingNotFound();
  }

  const slots = await computeSlots(
    db,
    { date: query.date, durationMinutes, excludeBookingId: query.excludeBookingId },
    now,
  );
  return {
    date: query.date,
    total_duration_minutes: durationMinutes,
    exclude_booking_id: query.excludeBookingId ?? null,
    slots,
  };
}
