// Server-side pricing. Prices and durations come only from PostgreSQL
// (vehicle_type_services); nothing price-related is ever taken from the client.
// Rules: docs/BOOKING-BUSINESS-LOGIC.md §2–§3.

import { CURRENCY, VAT_RATE, type Pricing, type ServiceKind } from "@autowascenter/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/index.ts";
import { services, vehicleTypes, vehicleTypeServices } from "../db/schema/index.ts";
import { AppError, notFound } from "../errors/app-error.ts";

/** A chosen service priced for the chosen vehicle type (also the booking_services snapshot). */
export interface PricedLine {
  serviceId: string;
  title: string;
  kind: ServiceKind;
  priceCents: number;
  durationMinutes: number;
}

export interface PricedSelection {
  lines: PricedLine[];
  totalDurationMinutes: number;
}

/** Exact conversion of a numeric(10,2) string ("74.75", "30", "-1.5") to integer cents. */
export function toCents(value: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid money value: ${value}`);
  const [, sign, euros, cents = ""] = match;
  const total = Number(euros) * 100 + Number(cents.padEnd(2, "0"));
  return sign ? -total : total;
}

export const centsToEuros = (cents: number) => cents / 100;

/**
 * Resolves the chosen services for a vehicle type, with the same filters as the booking flow:
 * vehicle type active; combination available; service active and bookable.
 * Lines are ordered by title (the order of the option list in routes/reservatie.tsx).
 */
export async function resolveSelection(
  db: Database,
  vehicleTypeId: string,
  serviceIds: string[],
): Promise<PricedSelection> {
  const [vehicleType] = await db
    .select({ id: vehicleTypes.id })
    .from(vehicleTypes)
    .where(and(eq(vehicleTypes.id, vehicleTypeId), eq(vehicleTypes.active, true)))
    .limit(1);
  if (!vehicleType) throw notFound("VEHICLE_TYPE_NOT_FOUND", "Vehicle type not found.");

  const rows = await db
    .select({
      serviceId: services.id,
      title: services.title,
      kind: services.kind,
      price: vehicleTypeServices.price,
      durationMinutes: vehicleTypeServices.durationMinutes,
    })
    .from(vehicleTypeServices)
    .innerJoin(services, eq(services.id, vehicleTypeServices.serviceId))
    .where(
      and(
        eq(vehicleTypeServices.vehicleTypeId, vehicleTypeId),
        inArray(vehicleTypeServices.serviceId, serviceIds),
        eq(vehicleTypeServices.available, true),
        eq(services.active, true),
        eq(services.bookable, true),
      ),
    )
    .orderBy(asc(services.title), asc(services.id));

  if (rows.length !== serviceIds.length) {
    throw notFound(
      "SERVICE_NOT_FOUND",
      "One or more services are not available for this vehicle type.",
    );
  }

  const lines = rows.map((row) => ({
    serviceId: row.serviceId,
    title: row.title,
    kind: row.kind,
    priceCents: toCents(row.price),
    durationMinutes: row.durationMinutes,
  }));
  return {
    lines,
    totalDurationMinutes: lines.reduce((sum, line) => sum + line.durationMinutes, 0),
  };
}

/** The booking flow requires at least one non-extra (reservatie.tsx `canNext`, step 2). */
export function assertHasMainService(lines: PricedLine[]) {
  if (!lines.some((line) => line.kind !== "extra")) {
    throw new AppError(
      422,
      "MAIN_SERVICE_REQUIRED",
      "Choose at least one service or package; extras cannot be booked on their own.",
    );
  }
}

export interface LocationChoice {
  onLocation: boolean;
  locationInSintNiklaas: boolean | null;
  locationAddress: string | null;
}

/**
 * Location fee in cents. The current application always charges 0 (reservatie.tsx:277);
 * km_fee/free_km are only shown as information and agreed with the customer afterwards.
 * This is the single place where a server-side distance calculation can be added later.
 */
export function calculateLocationFeeCents(_choice: LocationChoice): number {
  return 0;
}

/**
 * VAT in cents, rounded half-up. Integer arithmetic (amount × percent / 100) so that exact
 * half-cent cases like 250 × 21 % = 52.5 are not skewed by binary floating point.
 */
export function vatCents(amountCents: number, rate = VAT_RATE): number {
  const percent = Math.round(rate * 100);
  return Math.round((amountCents * percent) / 100);
}

export interface PricingCents {
  servicesSubtotal: number;
  locationFee: number;
  totalExclVat: number;
  vat: number;
  totalInclVat: number;
}

export function calculatePricing(lines: PricedLine[], locationFeeCents: number): PricingCents {
  const servicesSubtotal = lines.reduce((sum, line) => sum + line.priceCents, 0);
  const totalExclVat = servicesSubtotal + locationFeeCents;
  const vat = vatCents(totalExclVat);
  return {
    servicesSubtotal,
    locationFee: locationFeeCents,
    totalExclVat,
    vat,
    totalInclVat: totalExclVat + vat,
  };
}

export function toPricingContract(p: PricingCents): Pricing {
  return {
    services_subtotal: centsToEuros(p.servicesSubtotal),
    location_fee: centsToEuros(p.locationFee),
    total_excl_vat: centsToEuros(p.totalExclVat),
    vat_rate: VAT_RATE,
    vat: centsToEuros(p.vat),
    total_incl_vat: centsToEuros(p.totalInclVat),
    currency: CURRENCY,
  };
}
