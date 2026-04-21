// Shared slot-computation logic used by both public booking flow and admin agenda.
// Single source of truth: free slots are computed from real DB data
// (bookings + blocked_periods + site_settings).
//
// IMPORTANT: services can run longer than a single business day (e.g. 15u, 20u).
// In that case the work continues the next business day, again between the
// configured opening/closing hours. The pickup time reflects when the work
// finishes, accounting for the daily window.

import { supabase } from "@/integrations/supabase/client";

export type BusyBooking = {
  preferred_date: string;
  preferred_time: string;
  total_duration_minutes: number;
};

export type BusyBlocked = {
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
};

export type SlotSettings = {
  opening_hour: string;
  closing_hour: string;
  slot_interval_minutes: number;
};

export function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(m: number) {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

/** Format minutes into a friendly Dutch duration: "2u 30min", "1u", "45min". */
export function formatDuration(totalMin: number): string {
  if (!totalMin || totalMin <= 0) return "0min";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}u`;
  return `${h}u ${m}min`;
}

// ---------- Date helpers (work in yyyy-MM-dd strings, local-safe) ----------
function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Build the busy intervals for a given date from the provided bookings + blocked periods.
 * Bookings that started on a previous date but spill over (multi-day services)
 * are accounted for via `bookings` that include their full duration; the caller
 * passes them all and we map them onto the requested day window.
 */
function busyForDate(
  date: string,
  bookings: BusyBooking[],
  blocked: BusyBlocked[],
  settings: SlotSettings,
): Array<[number, number]> {
  const busy: Array<[number, number]> = [];
  const open = timeToMinutes(settings.opening_hour);
  const close = timeToMinutes(settings.closing_hour);
  const dayLen = close - open;

  for (const b of bookings) {
    // Compute which day-segments this booking occupies, expanding across days.
    const startDate = b.preferred_date;
    const startMin = timeToMinutes(b.preferred_time);
    let remaining = b.total_duration_minutes;
    let curDate = startDate;
    let curStart = startMin;
    while (remaining > 0) {
      const segmentEnd = Math.min(curStart + remaining, close);
      const consumed = segmentEnd - curStart;
      if (curDate === date) busy.push([curStart, segmentEnd]);
      remaining -= consumed;
      if (remaining <= 0) break;
      // Next business day continues at opening
      curDate = addDaysISO(curDate, 1);
      curStart = open;
      // safety: avoid infinite loop if dayLen <= 0
      if (dayLen <= 0) break;
    }
  }

  for (const bp of blocked) {
    if (date >= bp.start_date && date <= bp.end_date) {
      const s = bp.start_time ? timeToMinutes(bp.start_time) : 0;
      const e = bp.end_time ? timeToMinutes(bp.end_time) : 24 * 60;
      busy.push([s, e]);
    }
  }
  return busy;
}

/**
 * Compute the available start-times for a given date.
 * A start-time is valid if every minute of its duration (possibly across
 * multiple business days) falls inside the open window AND does not overlap
 * with any other booking or blocked period.
 */
export function computeAvailableSlots(opts: {
  date: string;
  durationMinutes: number;
  bookings: BusyBooking[];
  blocked: BusyBlocked[];
  settings: SlotSettings;
}): string[] {
  const { date, durationMinutes, bookings, blocked, settings } = opts;
  if (!date || durationMinutes <= 0) return [];

  const open = timeToMinutes(settings.opening_hour);
  const close = timeToMinutes(settings.closing_hour);
  const dayLen = close - open;
  const interval = Math.max(5, settings.slot_interval_minutes);
  if (dayLen <= 0) return [];

  const todayStr = new Date().toISOString().split("T")[0];
  const nowMin =
    date === todayStr
      ? new Date().getHours() * 60 + new Date().getMinutes()
      : -1;

  const slots: string[] = [];
  for (let t = open; t + Math.min(durationMinutes, dayLen) <= close; t += interval) {
    if (t <= nowMin) continue;
    // Verify each consumed segment day-by-day.
    let remaining = durationMinutes;
    let curDate = date;
    let curStart = t;
    let conflict = false;
    while (remaining > 0 && !conflict) {
      const segmentEnd = Math.min(curStart + remaining, close);
      const consumed = segmentEnd - curStart;
      const dayBusy = busyForDate(curDate, bookings, blocked, settings);
      if (dayBusy.some(([bs, be]) => curStart < be && segmentEnd > bs)) {
        conflict = true;
        break;
      }
      remaining -= consumed;
      if (remaining <= 0) break;
      curDate = addDaysISO(curDate, 1);
      curStart = open;
    }
    if (!conflict) slots.push(minutesToTime(t));
  }
  return slots;
}

/**
 * Compute when the customer can pick up the car given a start-date/time and
 * total duration. Returns the wall-clock pickup date+time, wrapping across
 * business days when the duration exceeds the daily window.
 */
export function computePickup(
  date: string,
  time: string,
  durationMinutes: number,
  settings: SlotSettings,
): { date: string; time: string } {
  const open = timeToMinutes(settings.opening_hour);
  const close = timeToMinutes(settings.closing_hour);
  const dayLen = close - open;
  let remaining = durationMinutes;
  let curDate = date;
  let curStart = timeToMinutes(time);
  while (remaining > 0) {
    const segmentEnd = Math.min(curStart + remaining, close);
    const consumed = segmentEnd - curStart;
    remaining -= consumed;
    if (remaining <= 0) {
      return { date: curDate, time: minutesToTime(segmentEnd) };
    }
    curDate = addDaysISO(curDate, 1);
    curStart = open;
    if (dayLen <= 0) break; // safety
  }
  return { date: curDate, time: minutesToTime(curStart) };
}

/**
 * Fetch the data needed to compute slots for a given date.
 * `excludeBookingId` lets callers ignore a booking they are editing.
 *
 * NOTE: we now also fetch bookings from earlier dates whose duration could
 * spill over into `date` (multi-day services). We look back enough days to
 * cover the longest realistic service.
 */
export async function fetchSlotData(date: string, excludeBookingId?: string) {
  const lookbackDays = 7; // covers the longest multi-day service (max ~20u)
  const fromDate = (() => {
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - lookbackDays);
    return dt.toISOString().split("T")[0];
  })();

  const [bookingsRes, blockedRes, settingsRes] = await Promise.all([
    supabase
      .from("bookings")
      .select("id,preferred_date,preferred_time,total_duration_minutes")
      .gte("preferred_date", fromDate)
      .lte("preferred_date", date)
      .neq("status", "geannuleerd"),
    supabase
      .from("blocked_periods")
      .select("start_date,end_date,start_time,end_time")
      .lte("start_date", date)
      .gte("end_date", date),
    supabase
      .from("site_settings")
      .select("opening_hour,closing_hour,slot_interval_minutes")
      .limit(1)
      .single(),
  ]);

  const bookings: BusyBooking[] = ((bookingsRes.data as Array<{
    id: string;
    preferred_date: string;
    preferred_time: string;
    total_duration_minutes: number;
  }> | null) ?? [])
    .filter((b) => !excludeBookingId || b.id !== excludeBookingId)
    .map((b) => ({
      preferred_date: b.preferred_date,
      preferred_time: b.preferred_time,
      total_duration_minutes: b.total_duration_minutes,
    }));

  const blocked: BusyBlocked[] = (blockedRes.data as BusyBlocked[]) ?? [];

  const settings: SlotSettings = settingsRes.data
    ? {
        opening_hour: settingsRes.data.opening_hour,
        closing_hour: settingsRes.data.closing_hour,
        slot_interval_minutes: settingsRes.data.slot_interval_minutes,
      }
    : { opening_hour: "10:00", closing_hour: "21:00", slot_interval_minutes: 30 };

  return { bookings, blocked, settings };
}
