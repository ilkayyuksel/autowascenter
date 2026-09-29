// Row → contract helpers shared by the admin read services.

import { toLocal } from "../../lib/business-time.ts";
import { centsToEuros, toCents } from "../pricing.service.ts";

/** numeric(10,2) string → euros as a JSON number (exact via integer cents). */
export const money = (value: string) => centsToEuros(toCents(value));
export const moneyOrNull = (value: string | null) => (value === null ? null : money(value));

/** PostgreSQL `time` ("HH:MM:SS") → local "HH:MM". */
export const hhmm = (value: string) => value.slice(0, 5);
export const hhmmOrNull = (value: string | null) => (value === null ? null : hhmm(value));

export const iso = (value: Date) => value.toISOString();
export const isoOrNull = (value: Date | null) => (value === null ? null : iso(value));

/** Local (Europe/Brussels) date and "HH:MM" of an instant. */
export function localParts(instant: Date) {
  const { date, minutes } = toLocal(instant);
  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return { date, time };
}
