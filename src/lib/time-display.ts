// Pure display helpers (agenda grid, durations). Availability is never computed in the
// browser: admin and public pages get their slots from the API (GET /api/admin/availability,
// GET /api/availability).

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
