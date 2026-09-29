// Admin read access to bookings: paginated list, detail with snapshot lines, agenda range.
// Explicit columns only; bookings.cancel_token is never selected.

import { asc, count, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/index.ts";
import { bookings, bookingServices, vehicleTypes } from "../../db/schema/index.ts";
import type { AdminBooking, PaginationMeta } from "../../contracts/admin.ts";
import { AppError } from "../../errors/app-error.ts";
import { hhmm, iso, isoOrNull, localParts, money, moneyOrNull } from "./mappers.ts";

const bookingColumns = {
  id: bookings.id,
  status: bookings.status,
  customerName: bookings.customerName,
  customerEmail: bookings.customerEmail,
  customerPhone: bookings.customerPhone,
  companyName: bookings.companyName,
  vatNumber: bookings.vatNumber,
  notes: bookings.notes,
  vehicleType: { id: vehicleTypes.id, slug: vehicleTypes.slug, title: vehicleTypes.title },
  vehicleBrand: bookings.vehicleBrand,
  vehicleModel: bookings.vehicleModel,
  vehicleInfo: bookings.vehicleInfo,
  serviceId: bookings.serviceId,
  serviceTitle: bookings.serviceTitle,
  preferredDate: bookings.preferredDate,
  preferredTime: bookings.preferredTime,
  startAt: bookings.startAt,
  endAt: bookings.endAt,
  totalDurationMinutes: bookings.totalDurationMinutes,
  totalPrice: bookings.totalPrice,
  locationFee: bookings.locationFee,
  onLocation: bookings.onLocation,
  locationInSintNiklaas: bookings.locationInSintNiklaas,
  locationAddress: bookings.locationAddress,
  locationDistanceKm: bookings.locationDistanceKm,
  cancelledAt: bookings.cancelledAt,
  createdAt: bookings.createdAt,
  updatedAt: bookings.updatedAt,
};

function selectBookings(db: Database) {
  return db
    .select(bookingColumns)
    .from(bookings)
    .leftJoin(vehicleTypes, eq(vehicleTypes.id, bookings.vehicleTypeId));
}

type BookingRow = Awaited<ReturnType<typeof selectBookings>>[number];

function toAdminBooking(row: BookingRow): AdminBooking {
  const pickup = localParts(row.endAt);
  return {
    id: row.id,
    status: row.status,
    customer_name: row.customerName,
    customer_email: row.customerEmail,
    customer_phone: row.customerPhone,
    company_name: row.companyName,
    vat_number: row.vatNumber,
    notes: row.notes,
    vehicle_type: row.vehicleType,
    vehicle_brand: row.vehicleBrand,
    vehicle_model: row.vehicleModel,
    vehicle_info: row.vehicleInfo,
    service_id: row.serviceId,
    service_title: row.serviceTitle,
    preferred_date: row.preferredDate,
    preferred_time: hhmm(row.preferredTime),
    start_at: iso(row.startAt),
    end_at: iso(row.endAt),
    pickup_date: pickup.date,
    pickup_time: pickup.time,
    total_duration_minutes: row.totalDurationMinutes,
    total_price: money(row.totalPrice),
    location_fee: money(row.locationFee),
    on_location: row.onLocation,
    location_in_sint_niklaas: row.locationInSintNiklaas,
    location_address: row.locationAddress,
    location_distance_km: moneyOrNull(row.locationDistanceKm),
    cancelled_at: isoOrNull(row.cancelledAt),
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  };
}

/**
 * All bookings, newest appointment first (same order as admin/reservaties.tsx, plus id as a
 * stable tiebreak), paginated with LIMIT/OFFSET in SQL.
 */
export async function listAdminBookings(
  db: Database,
  { page, limit }: { page: number; limit: number },
): Promise<{ data: AdminBooking[]; meta: PaginationMeta }> {
  const [[totalRow], rows] = await Promise.all([
    db.select({ total: count() }).from(bookings),
    selectBookings(db)
      .orderBy(desc(bookings.preferredDate), desc(bookings.preferredTime), desc(bookings.id))
      .limit(limit)
      .offset((page - 1) * limit),
  ]);
  const total = totalRow?.total ?? 0;
  return {
    data: rows.map(toAdminBooking),
    meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export async function getAdminBooking(db: Database, id: string) {
  const [row] = await selectBookings(db).where(eq(bookings.id, id)).limit(1);
  if (!row) throw new AppError(404, "RESOURCE_NOT_FOUND", "Booking not found.");

  const lines = await db
    .select({
      id: bookingServices.id,
      serviceId: bookingServices.serviceId,
      serviceTitle: bookingServices.serviceTitle,
      price: bookingServices.price,
      durationMinutes: bookingServices.durationMinutes,
    })
    .from(bookingServices)
    .where(eq(bookingServices.bookingId, id))
    .orderBy(asc(bookingServices.serviceTitle), asc(bookingServices.id));

  return {
    ...toAdminBooking(row),
    services: lines.map((l) => ({
      id: l.id,
      service_id: l.serviceId,
      service_title: l.serviceTitle,
      price: money(l.price),
      duration_minutes: l.durationMinutes,
    })),
  };
}

/**
 * Bookings of every status whose [start_at, end_at) overlaps [from, to): multi-day bookings
 * also appear on their later days. Ordered by start.
 */
export async function listBookingsOverlapping(db: Database, from: Date, to: Date) {
  const rows = await selectBookings(db)
    .where(
      sql`tstzrange(${bookings.startAt}, ${bookings.endAt}, '[)') && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')`,
    )
    .orderBy(asc(bookings.startAt), asc(bookings.id));
  return rows.map(toAdminBooking);
}
