// Shared slot-computation logic used by both public booking flow and admin agenda.
// Single source of truth: free slots are computed from real DB data
// (bookings + blocked_periods + site_settings).

import { supabase } from "@/integrations/supabase/client";

export type BusyBooking = {
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

/**
 * Compute the available slots for a given date based on real DB data.
 * - excludes overlap with existing bookings
 * - excludes blocked periods
 * - excludes past times (when date is today)
 * - optionally ignores a booking by id (used when editing/moving an existing appointment)
 */
export function computeAvailableSlots(opts: {
  date: string; // yyyy-MM-dd
  durationMinutes: number;
  bookings: BusyBooking[];
  blocked: BusyBlocked[];
  settings: SlotSettings;
}): string[] {
  const { date, durationMinutes, bookings, blocked, settings } = opts;
  if (!date || durationMinutes <= 0) return [];

  const open = timeToMinutes(settings.opening_hour);
  const close = timeToMinutes(settings.closing_hour);
  const interval = Math.max(5, settings.slot_interval_minutes);

  const busy: Array<[number, number]> = [];
  for (const b of bookings) {
    const s = timeToMinutes(b.preferred_time);
    busy.push([s, s + b.total_duration_minutes]);
  }
  for (const bp of blocked) {
    if (date >= bp.start_date && date <= bp.end_date) {
      const s = bp.start_time ? timeToMinutes(bp.start_time) : 0;
      const e = bp.end_time ? timeToMinutes(bp.end_time) : 24 * 60;
      busy.push([s, e]);
    }
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const nowMin =
    date === todayStr
      ? new Date().getHours() * 60 + new Date().getMinutes()
      : -1;

  const slots: string[] = [];
  for (let t = open; t + durationMinutes <= close; t += interval) {
    if (t <= nowMin) continue;
    const slotEnd = t + durationMinutes;
    const overlaps = busy.some(([bs, be]) => t < be && slotEnd > bs);
    if (!overlaps) slots.push(minutesToTime(t));
  }
  return slots;
}

/**
 * Fetch the data needed to compute slots for a given date.
 * `excludeBookingId` lets callers ignore a booking they are editing.
 */
export async function fetchSlotData(date: string, excludeBookingId?: string) {
  const [bookingsRes, blockedRes, settingsRes] = await Promise.all([
    supabase
      .from("bookings")
      .select("id,preferred_time,total_duration_minutes")
      .eq("preferred_date", date)
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
    preferred_time: string;
    total_duration_minutes: number;
  }> | null) ?? [])
    .filter((b) => !excludeBookingId || b.id !== excludeBookingId)
    .map((b) => ({
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
    : { opening_hour: "08:00", closing_hour: "22:00", slot_interval_minutes: 30 };

  return { bookings, blocked, settings };
}
