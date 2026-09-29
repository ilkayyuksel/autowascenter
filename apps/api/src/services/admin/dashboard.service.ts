// Admin dashboard (src/routes/admin/index.tsx): counts, this week's bookings and revenue,
// today's appointments and the next appointment. Aggregates are computed in PostgreSQL.

import { and, asc, between, count, eq, gte, ne, sql } from "drizzle-orm";
import type { Database } from "../../db/index.ts";
import { bookings, galleryItems, services, vehicleTypes } from "../../db/schema/index.ts";
import type { DashboardData } from "../../contracts/admin.ts";
import { addDays, nowLocal } from "../../lib/business-time.ts";
import { toCents } from "../pricing.service.ts";
import { hhmm, iso } from "./mappers.ts";

const notCancelled = ne(bookings.status, "geannuleerd");

/** Monday of the ISO week containing `date` (YYYY-MM-DD), like date-fns weekStartsOn: 1. */
function mondayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

export async function getDashboard(db: Database, now: Date): Promise<DashboardData> {
  const today = nowLocal(now).date;
  const weekStart = mondayOf(today);
  const weekEnd = addDays(weekStart, 6);
  const inWeek = between(bookings.preferredDate, weekStart, weekEnd);

  const [activeServices, galleryCount, activeVehicleTypes, perDay, todayRows, [next]] =
    await Promise.all([
      db.$count(services, eq(services.active, true)),
      db.$count(galleryItems),
      db.$count(vehicleTypes, eq(vehicleTypes.active, true)),
      db
        .select({
          date: bookings.preferredDate,
          bookingCount: count(),
          // Exact numeric sum in SQL, returned as text to avoid float rounding.
          revenue: sql<string>`coalesce(sum(${bookings.totalPrice}), 0)::text`,
        })
        .from(bookings)
        .where(and(notCancelled, inWeek))
        .groupBy(bookings.preferredDate)
        .orderBy(asc(bookings.preferredDate)),
      db
        .select({
          id: bookings.id,
          customerName: bookings.customerName,
          serviceTitle: bookings.serviceTitle,
          preferredTime: bookings.preferredTime,
          status: bookings.status,
        })
        .from(bookings)
        .where(and(notCancelled, eq(bookings.preferredDate, today)))
        .orderBy(asc(bookings.preferredTime), asc(bookings.id)),
      // First appointment of this week that has not started yet (admin/index.tsx `upcoming`).
      db
        .select({
          id: bookings.id,
          customerName: bookings.customerName,
          serviceTitle: bookings.serviceTitle,
          preferredDate: bookings.preferredDate,
          preferredTime: bookings.preferredTime,
          startAt: bookings.startAt,
          status: bookings.status,
        })
        .from(bookings)
        .where(and(notCancelled, inWeek, gte(bookings.startAt, now)))
        .orderBy(asc(bookings.startAt), asc(bookings.id))
        .limit(1),
    ]);

  const byDate = new Map(perDay.map((d) => [d.date, d]));
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const row = byDate.get(date);
    return {
      date,
      booking_count: row?.bookingCount ?? 0,
      revenueCents: row ? toCents(row.revenue) : 0,
    };
  });
  const revenueCents = days.reduce((sum, d) => sum + d.revenueCents, 0);

  return {
    today,
    week_start: weekStart,
    week_end: weekEnd,
    counts: {
      active_services: activeServices,
      gallery_items: galleryCount,
      active_vehicle_types: activeVehicleTypes,
    },
    week: {
      booking_count: days.reduce((sum, d) => sum + d.booking_count, 0),
      revenue_excl_vat: revenueCents / 100,
      days: days.map((d) => ({
        date: d.date,
        booking_count: d.booking_count,
        revenue_excl_vat: d.revenueCents / 100,
      })),
    },
    today_bookings: todayRows.map((r) => ({
      id: r.id,
      customer_name: r.customerName,
      service_title: r.serviceTitle,
      preferred_time: hhmm(r.preferredTime),
      status: r.status,
    })),
    next_booking: next
      ? {
          id: next.id,
          customer_name: next.customerName,
          service_title: next.serviceTitle,
          preferred_date: next.preferredDate,
          preferred_time: hhmm(next.preferredTime),
          start_at: iso(next.startAt),
          status: next.status,
        }
      : null,
  };
}
