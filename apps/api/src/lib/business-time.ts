// Calendar and clock helpers in the business time zone (Europe/Brussels).
//
// Dates are `YYYY-MM-DD` strings and times are minutes since local midnight, exactly like
// the former src/lib/slots.ts (removed in phase 7C), so the slot algorithm could be ported
// one-to-one. Conversion to absolute instants uses the IANA rules built into Node (Intl),
// so CET/CEST offsets are correct on every date. `new Date().toISOString()` is never used
// to decide the local calendar day.

import { BUSINESS_TIME_ZONE } from "@autowascenter/shared";

const MINUTES_PER_DAY = 24 * 60;
const HOUR_MS = 60 * 60 * 1000;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" or "HH:MM:SS" (PostgreSQL `time`) → minutes. "24:00" → 1440. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Minutes → "HH:MM" (0–1439). */
export function minutesToTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Adds calendar days to a `YYYY-MM-DD` date (no time zone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** The local calendar date and minute-of-day of an instant, in Europe/Brussels. */
export function toLocal(instant: Date): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Offset of Europe/Brussels from UTC at an instant, in milliseconds (e.g. +2h in summer). */
function offsetAt(utcMs: number): number {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Local Brussels date + minutes (0–1440) → absolute instant.
 * Returns null for a local time that does not exist (spring-forward gap) or that exists twice
 * (fall-back overlap): both only occur between 02:00 and 03:00, outside any opening window,
 * and rejecting them guarantees the result matches PostgreSQL's `AT TIME ZONE` conversion
 * enforced by the bookings_start_matches_local_check constraint.
 * Minutes = 1440 means midnight at the start of the next day.
 */
export function fromLocal(date: string, minutes: number): Date | null {
  if (minutes === MINUTES_PER_DAY) return fromLocal(addDays(date, 1), 0);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wallClockAsUtc = Date.UTC(y, m - 1, d, 0, minutes);
  // Two passes resolve the offset at the target instant (it can differ from the guess near DST).
  const firstGuess = wallClockAsUtc - offsetAt(wallClockAsUtc);
  const utcMs = wallClockAsUtc - offsetAt(firstGuess);
  const instant = new Date(utcMs);
  const sameLocal = (ms: number) => {
    const local = toLocal(new Date(ms));
    return local.date === date && local.minutes === minutes;
  };
  if (!sameLocal(utcMs)) return null; // does not exist
  if (sameLocal(utcMs - HOUR_MS) || sameLocal(utcMs + HOUR_MS)) return null; // ambiguous
  return instant;
}

/** "Today" and the current minute in Europe/Brussels. */
export function nowLocal(now: Date): { date: string; minutes: number } {
  return toLocal(now);
}
