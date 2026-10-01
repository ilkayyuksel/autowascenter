// Booking engine shared by the public booking API and the admin booking API:
// server-computed prices/durations/timestamps, one transaction per mutation, and the database
// exclusion constraint as the final guard against double booking.
// Lifecycle and rules: docs/BOOKING-BUSINESS-LOGIC.md §8–§9.

import type {
  BookingCreatedResponse,
  BookingStatus,
  ParsedBookingRequest,
} from "@autowascenter/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../db/index.ts";
import { bookings, bookingServices } from "../db/schema/index.ts";
import { AppError } from "../errors/app-error.ts";
import { timeToMinutes } from "../lib/business-time.ts";
import {
  futureStarts,
  isOccupied,
  loadOccupancy,
  loadScheduleSettings,
} from "./availability.service.ts";
import {
  assertHasMainService,
  calculateLocationFeeCents,
  calculatePricing,
  centsToEuros,
  resolveSelection,
  toPricingContract,
  type PricedLine,
  type PricingCents,
} from "./pricing.service.ts";
import { candidateStarts, planJob, type PlannedJob, type ScheduleSettings } from "./schedule.ts";

const EXCLUSION_VIOLATION = "23P01";

export const slotUnavailable = () =>
  new AppError(409, "BOOKING_SLOT_UNAVAILABLE", "The chosen time slot is no longer available.");

const outsideOpeningHours = (message: string) =>
  new AppError(422, "BOOKING_OUTSIDE_OPENING_HOURS", message);

/** True when the error (or a wrapped cause) is the bookings overlap exclusion violation. */
export function isOverlapViolation(error: unknown): boolean {
  for (let e = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if ((e as { code?: unknown }).code === EXCLUSION_VIOLATION) return true;
  }
  return false;
}

/** Runs a write and turns an exclusion-constraint violation into 409 (never a DB error). */
export async function guardOverlap<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isOverlapViolation(error)) throw slotUnavailable();
    throw error;
  }
}

/** A start fits the opening window (slots.ts rule: start ≥ open, start + min(dur, day) ≤ close). */
function fitsOpeningHours(startMinutes: number, durationMinutes: number, s: ScheduleSettings) {
  const dayLength = s.closeMinutes - s.openMinutes;
  return (
    dayLength > 0 &&
    startMinutes >= s.openMinutes &&
    startMinutes + Math.min(durationMinutes, dayLength) <= s.closeMinutes
  );
}

export interface ScheduleCheck {
  /** Require a start on the slot grid (new bookings and moves). */
  enforceGrid: boolean;
  /** Reject starts before "now" in Europe/Brussels (new bookings and moves). */
  enforceFuture: boolean;
  /** Check bookings + blocked periods (skipped when the booking is/stays cancelled). */
  checkOccupancy: boolean;
  /** The booking being edited never blocks itself. */
  excludeBookingId?: string;
}

/**
 * Validates a start against opening hours, slot grid, "now", blocked periods and other
 * bookings, and computes the absolute [start_at, end_at). Must run inside the transaction
 * that writes the booking.
 */
export async function validateSchedule(
  tx: Database,
  slot: { date: string; time: string; durationMinutes: number },
  now: Date,
  check: ScheduleCheck,
): Promise<PlannedJob> {
  const settings = await loadScheduleSettings(tx);
  const startMinutes = timeToMinutes(slot.time);

  if (check.enforceGrid) {
    if (!candidateStarts(slot.durationMinutes, settings).includes(startMinutes)) {
      throw outsideOpeningHours(
        "The chosen time is not an available start time within opening hours.",
      );
    }
  } else if (!fitsOpeningHours(startMinutes, slot.durationMinutes, settings)) {
    throw outsideOpeningHours("The booking does not fit within opening hours.");
  }
  if (check.enforceFuture && futureStarts(slot.date, [startMinutes], now).length === 0) {
    throw new AppError(422, "BOOKING_IN_PAST", "The chosen date and time are in the past.");
  }

  const job = planJob(slot.date, startMinutes, slot.durationMinutes, settings);
  if (!job) throw outsideOpeningHours("The chosen time does not exist in local time.");

  if (check.checkOccupancy) {
    // Friendly pre-check; the exclusion constraint stays the final guard.
    const occupancy = await loadOccupancy(
      tx,
      slot.date,
      slot.durationMinutes,
      settings,
      check.excludeBookingId,
    );
    if (isOccupied(job, occupancy)) throw slotUnavailable();
  }
  return job;
}

/** Customer and booking data that is not computed by the server. */
export interface BookingDetails {
  vehicleTypeId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  companyName: string | null;
  vatNumber: string | null;
  notes: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  preferredDate: string;
  preferredTime: string;
  status: BookingStatus;
  location: {
    onLocation: boolean;
    locationInSintNiklaas: boolean | null;
    locationAddress: string | null;
  };
}

/** Everything needed to insert a booking; price/duration/times are server-computed. */
export interface BookingDraft {
  details: BookingDetails;
  lines: PricedLine[];
  totalDurationMinutes: number;
  pricing: PricingCents;
  job: PlannedJob;
}

const centsToNumeric = (cents: number) => (cents / 100).toFixed(2);

/** Legacy columns, filled like routes/reservatie.tsx so the old admin UI keeps working. */
export function legacyServiceColumns(lines: PricedLine[]) {
  return {
    serviceId: lines[0]?.serviceId ?? null,
    serviceTitle: lines.map((l) => l.title).join(", "),
  };
}

export function vehicleInfo(brand: string | null, model: string | null) {
  return `${brand ?? ""} ${model ?? ""}`.trim() || null;
}

/** Replaces the booking_services snapshot rows of a booking (inside a transaction). */
export async function replaceBookingLines(tx: Database, bookingId: string, lines: PricedLine[]) {
  await tx.delete(bookingServices).where(eq(bookingServices.bookingId, bookingId));
  await tx.insert(bookingServices).values(
    lines.map((line) => ({
      bookingId,
      serviceId: line.serviceId,
      serviceTitle: line.title,
      price: centsToNumeric(line.priceCents),
      durationMinutes: line.durationMinutes,
    })),
  );
}

/**
 * Inserts the booking and its booking_services snapshot rows. Must run inside a transaction.
 * cancel_token is never accepted from a client: the database default generates it.
 */
export async function insertBooking(tx: Database, draft: BookingDraft): Promise<string> {
  const { details: d, lines, job, pricing } = draft;
  return guardOverlap(async () => {
    const [row] = await tx
      .insert(bookings)
      .values({
        customerName: d.customerName,
        customerEmail: d.customerEmail,
        customerPhone: d.customerPhone,
        companyName: d.companyName,
        vatNumber: d.vatNumber,
        notes: d.notes,
        vehicleTypeId: d.vehicleTypeId,
        vehicleBrand: d.vehicleBrand,
        vehicleModel: d.vehicleModel,
        vehicleInfo: vehicleInfo(d.vehicleBrand, d.vehicleModel),
        ...legacyServiceColumns(lines),
        preferredDate: d.preferredDate,
        preferredTime: d.preferredTime,
        startAt: job.startAt,
        endAt: job.endAt,
        totalDurationMinutes: draft.totalDurationMinutes,
        totalPrice: centsToNumeric(pricing.totalExclVat),
        locationFee: centsToNumeric(pricing.locationFee),
        onLocation: d.location.onLocation,
        locationInSintNiklaas: d.location.locationInSintNiklaas,
        locationAddress: d.location.locationAddress,
        status: d.status,
      })
      .returning({ id: bookings.id });
    const bookingId = row!.id;
    await replaceBookingLines(tx, bookingId, lines);
    return bookingId;
  });
}

/**
 * Prices a selection and validates its schedule: the common core of public and admin
 * booking creation (same pricing engine, same duration and location-fee rules).
 */
export async function planNewBooking(
  tx: Database,
  input: {
    vehicleTypeId: string;
    serviceIds: string[];
    date: string;
    time: string;
    location: BookingDetails["location"];
    requireMainService: boolean;
  },
  now: Date,
) {
  const { lines, totalDurationMinutes } = await resolveSelection(
    tx,
    input.vehicleTypeId,
    input.serviceIds,
  );
  if (input.requireMainService) assertHasMainService(lines);
  const pricing = calculatePricing(lines, calculateLocationFeeCents(input.location));
  const job = await validateSchedule(
    tx,
    { date: input.date, time: input.time, durationMinutes: totalDurationMinutes },
    now,
    { enforceGrid: true, enforceFuture: true, checkOccupancy: true },
  );
  return { lines, totalDurationMinutes, pricing, job };
}

const emptyToNull = (value: string | undefined) => (value ? value : null);

/**
 * Validates, prices and stores a public booking atomically. Every step runs in one
 * transaction: any error rolls back everything, so no half booking can remain.
 */
export async function createBooking(
  db: Database,
  request: ParsedBookingRequest,
  now: Date,
): Promise<BookingCreatedResponse["data"]> {
  const draft = await db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    const location = {
      onLocation: request.on_location,
      locationInSintNiklaas: request.on_location ? Boolean(request.location_in_sint_niklaas) : null,
      locationAddress:
        request.on_location && !request.location_in_sint_niklaas
          ? emptyToNull(request.location_address)
          : null,
    };
    const planned = await planNewBooking(
      t,
      {
        vehicleTypeId: request.vehicle_type_id,
        serviceIds: request.service_ids,
        date: request.preferred_date,
        time: request.preferred_time,
        location,
        requireMainService: true,
      },
      now,
    );
    const result: BookingDraft = {
      ...planned,
      details: {
        vehicleTypeId: request.vehicle_type_id,
        customerName: request.customer_name,
        customerEmail: request.customer_email,
        customerPhone: request.customer_phone,
        companyName: emptyToNull(request.company_name),
        vatNumber: emptyToNull(request.vat_number),
        notes: emptyToNull(request.notes),
        vehicleBrand: request.vehicle_brand,
        vehicleModel: request.vehicle_model,
        preferredDate: request.preferred_date,
        preferredTime: request.preferred_time,
        // Server-controlled: a public booking always starts as 'nieuw'.
        status: "nieuw",
        location,
      },
    };
    const id = await insertBooking(t, result);
    return { ...result, id };
  });

  return {
    id: draft.id,
    status: "nieuw",
    preferred_date: request.preferred_date,
    preferred_time: request.preferred_time,
    start_at: draft.job.startAt.toISOString(),
    end_at: draft.job.endAt.toISOString(),
    pickup_date: draft.job.pickupDate,
    pickup_time: draft.job.pickupTime,
    total_duration_minutes: draft.totalDurationMinutes,
    services: draft.lines.map((l) => ({
      service_id: l.serviceId,
      title: l.title,
      kind: l.kind,
      price: centsToEuros(l.priceCents),
      duration_minutes: l.durationMinutes,
    })),
    pricing: toPricingContract(draft.pricing),
  };
}
