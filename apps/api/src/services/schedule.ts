// Pure scheduling rules, ported from src/lib/slots.ts (see docs/BOOKING-BUSINESS-LOGIC.md).
// No database access: callers pass settings, bookings and blocked periods.

import { addDays, fromLocal, minutesToTime, timeToMinutes } from "../lib/business-time.ts";

const MINUTES_PER_DAY = 24 * 60;
const MIN_INTERVAL = 5; // slots.ts: Math.max(5, slot_interval_minutes)

/** Opening window for every day, in local minutes. */
export interface ScheduleSettings {
  openMinutes: number;
  closeMinutes: number;
  intervalMinutes: number;
}

/** Same fallback as src/lib/slots.ts when site_settings has no row. */
export const FALLBACK_SETTINGS = { openingHour: "10:00", closingHour: "21:00", slotInterval: 30 };

export function toScheduleSettings(openingHour: string, closingHour: string, slotInterval: number) {
  return {
    openMinutes: timeToMinutes(openingHour),
    closeMinutes: timeToMinutes(closingHour),
    intervalMinutes: Math.max(MIN_INTERVAL, slotInterval),
  } satisfies ScheduleSettings;
}

/** A piece of work on one local day: [start, end) in minutes. */
export interface WorkSegment {
  date: string;
  start: number;
  end: number;
}

/**
 * Splits a job into per-day segments: work runs until closing time and continues the next
 * calendar day at opening time (slots.ts busyForDate/computePickup).
 */
export function workSegments(
  date: string,
  startMinutes: number,
  durationMinutes: number,
  { openMinutes, closeMinutes }: ScheduleSettings,
): WorkSegment[] {
  const segments: WorkSegment[] = [];
  let remaining = durationMinutes;
  let currentDate = date;
  let currentStart = startMinutes;
  while (remaining > 0) {
    const end = Math.min(currentStart + remaining, closeMinutes);
    segments.push({ date: currentDate, start: currentStart, end });
    remaining -= end - currentStart;
    currentDate = addDays(currentDate, 1);
    currentStart = openMinutes;
  }
  return segments;
}

/**
 * Candidate start minutes of a day (slots.ts:140): on the grid `open + k × interval`, and
 * `start + min(duration, dayLength) <= close`. A job shorter than a day must end the same
 * day; a longer job can only start at opening time.
 */
export function candidateStarts(durationMinutes: number, s: ScheduleSettings): number[] {
  const dayLength = s.closeMinutes - s.openMinutes;
  if (durationMinutes <= 0 || dayLength <= 0) return [];
  const starts: number[] = [];
  for (
    let t = s.openMinutes;
    t + Math.min(durationMinutes, dayLength) <= s.closeMinutes;
    t += s.intervalMinutes
  ) {
    starts.push(t);
  }
  return starts;
}

/** Local blocked period as stored in blocked_periods. */
export interface BlockedPeriod {
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
}

/** True when any work segment overlaps a blocked interval on the same day (slots.ts:101-107). */
export function overlapsBlockedPeriod(segments: WorkSegment[], blocked: BlockedPeriod[]): boolean {
  return segments.some((seg) =>
    blocked.some((bp) => {
      if (seg.date < bp.startDate || seg.date > bp.endDate) return false;
      const blockStart = bp.startTime ? timeToMinutes(bp.startTime) : 0;
      const blockEnd = bp.endTime ? timeToMinutes(bp.endTime) : MINUTES_PER_DAY;
      return seg.start < blockEnd && seg.end > blockStart;
    }),
  );
}

/** An occupied absolute interval [startMs, endMs). */
export interface BusyInterval {
  startMs: number;
  endMs: number;
}

export function overlapsBusy(startMs: number, endMs: number, busy: BusyInterval[]): boolean {
  return busy.some((b) => startMs < b.endMs && endMs > b.startMs);
}

/** A concrete, resolvable start: local segments plus absolute [start_at, end_at). */
export interface PlannedJob {
  time: string;
  segments: WorkSegment[];
  startAt: Date;
  endAt: Date;
  pickupDate: string;
  pickupTime: string;
}

/**
 * Plans a job starting at `startMinutes` on `date`. Returns null when a boundary does not
 * exist in local time (DST transition hour), which never happens inside opening hours.
 */
export function planJob(
  date: string,
  startMinutes: number,
  durationMinutes: number,
  s: ScheduleSettings,
): PlannedJob | null {
  const segments = workSegments(date, startMinutes, durationMinutes, s);
  const last = segments[segments.length - 1];
  if (!last) return null;
  const startAt = fromLocal(date, startMinutes);
  const endAt = fromLocal(last.date, last.end);
  if (!startAt || !endAt) return null;
  const pickupAtMidnight = last.end === MINUTES_PER_DAY;
  return {
    time: minutesToTime(startMinutes),
    segments,
    startAt,
    endAt,
    pickupDate: pickupAtMidnight ? addDays(last.date, 1) : last.date,
    pickupTime: minutesToTime(pickupAtMidnight ? 0 : last.end),
  };
}

/** Number of calendar days a job can span (to size database lookups). */
export function daysSpanned(durationMinutes: number, s: ScheduleSettings): number {
  const dayLength = s.closeMinutes - s.openMinutes;
  return dayLength > 0 ? Math.ceil(durationMinutes / dayLength) + 1 : 1;
}
