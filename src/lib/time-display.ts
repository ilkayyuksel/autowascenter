// Pure display helpers for the admin UI (agenda grid, durations). The admin no longer imports
// src/lib/slots.ts: that module (and its Supabase reads) is only used by the public booking
// page until that page is migrated. Admin availability comes from GET /api/admin/availability.

export function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(m: number) {
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

/** Friendly Dutch duration: "2u 30min", "1u", "45min". */
export function formatDuration(totalMin: number): string {
  if (!totalMin || totalMin <= 0) return "0min";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}u`;
  return `${h}u ${m}min`;
}
