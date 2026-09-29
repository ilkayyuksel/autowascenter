// Server-side availability: the only reliable source of free slots.
// Algorithm: docs/BOOKING-BUSINESS-LOGIC.md §4–§7. Capacity is 1.

import type { AvailabilityResponse } from "@autowascenter/shared";
import { and, asc, gte, lte, ne, sql } from "drizzle-orm";
import { addDays, fromLocal, nowLocal } from "../lib/business-time.ts";
import type { Database } from "../db/index.ts";
import { blockedPeriods, bookings, siteSettings } from "../db/schema/index.ts";
import { resolveSelection } from "./pricing.service.ts";
import {
  candidateStarts,
  daysSpanned,
  FALLBACK_SETTINGS,
  overlapsBlockedPeriod,
  overlapsBusy,
  planJob,
  toScheduleSettings,
  type BlockedPeriod,
  type BusyInterval,
  type PlannedJob,
  type ScheduleSettings,
} from "./schedule.ts";

/** Opening window from site_settings (single row), with the frontend's fallback. */
export async function loadScheduleSettings(db: Database): Promise<ScheduleSettings> {
  const [row] = await db
    .select({
      openingHour: siteSettings.openingHour,
      closingHour: siteSettings.closingHour,
      slotInterval: siteSettings.slotIntervalMinutes,
    })
    .from(siteSettings)
    .limit(1);
  const s = row ?? FALLBACK_SETTINGS;
  return toScheduleSettings(s.openingHour, s.closingHour, s.slotInterval);
}

export interface Occupancy {
  busy: BusyInterval[];
  blocked: BlockedPeriod[];
}

/**
 * Everything that can conflict with a job starting on `date`: non-cancelled bookings whose
 * [start_at, end_at) overlaps the local days the job can span, and blocked periods on those
 * days. The booking predicate matches the partial GiST exclusion index.
 */
export async function loadOccupancy(
  db: Database,
  date: string,
  durationMinutes: number,
  settings: ScheduleSettings,
): Promise<Occupancy> {
  const lastDate = addDays(date, daysSpanned(durationMinutes, settings));
  // Midnight always exists in Europe/Brussels (DST changes at 02:00/03:00).
  const from = fromLocal(date, 0)!.toISOString();
  const to = fromLocal(addDays(lastDate, 1), 0)!.toISOString();

  const [bookingRows, blockedRows] = await Promise.all([
    db
      .select({ startAt: bookings.startAt, endAt: bookings.endAt })
      .from(bookings)
      .where(
        and(
          ne(bookings.status, "geannuleerd"),
          sql`tstzrange(${bookings.startAt}, ${bookings.endAt}, '[)') && tstzrange(${from}::timestamptz, ${to}::timestamptz, '[)')`,
        ),
      ),
    db
      .select({
        startDate: blockedPeriods.startDate,
        endDate: blockedPeriods.endDate,
        startTime: blockedPeriods.startTime,
        endTime: blockedPeriods.endTime,
      })
      .from(blockedPeriods)
      .where(and(lte(blockedPeriods.startDate, lastDate), gte(blockedPeriods.endDate, date)))
      .orderBy(asc(blockedPeriods.startDate)),
  ]);

  return {
    busy: bookingRows.map((b) => ({ startMs: b.startAt.getTime(), endMs: b.endAt.getTime() })),
    blocked: blockedRows,
  };
}

/** True when the planned job overlaps an existing booking or a blocked period. */
export function isOccupied(job: PlannedJob, occupancy: Occupancy): boolean {
  return (
    overlapsBusy(job.startAt.getTime(), job.endAt.getTime(), occupancy.busy) ||
    overlapsBlockedPeriod(job.segments, occupancy.blocked)
  );
}

/** Start minutes of `date` that are not in the past (Europe/Brussels). */
export function futureStarts(date: string, starts: number[], now: Date): number[] {
  const today = nowLocal(now);
  if (date < today.date) return [];
  if (date > today.date) return starts;
  return starts.filter((t) => t > today.minutes); // slots.ts skips t <= now
}

export async function getAvailability(
  db: Database,
  query: { date: string; vehicleTypeId: string; serviceIds: string[] },
  now: Date,
): Promise<AvailabilityResponse["data"]> {
  const { totalDurationMinutes } = await resolveSelection(
    db,
    query.vehicleTypeId,
    query.serviceIds,
  );
  const settings = await loadScheduleSettings(db);

  const starts = futureStarts(query.date, candidateStarts(totalDurationMinutes, settings), now);
  const occupancy = starts.length
    ? await loadOccupancy(db, query.date, totalDurationMinutes, settings)
    : { busy: [], blocked: [] };

  const slots = starts
    .map((t) => planJob(query.date, t, totalDurationMinutes, settings))
    .filter((job): job is PlannedJob => job !== null && !isOccupied(job, occupancy))
    .map((job) => ({
      time: job.time,
      start_at: job.startAt.toISOString(),
      end_at: job.endAt.toISOString(),
      pickup_date: job.pickupDate,
      pickup_time: job.pickupTime,
    }));

  return {
    date: query.date,
    vehicle_type_id: query.vehicleTypeId,
    total_duration_minutes: totalDurationMinutes,
    slots,
  };
}
