/** Values of the PostgreSQL enum `booking_status` (unchanged from Supabase). */
export const BOOKING_STATUSES = ["nieuw", "bevestigd", "voltooid", "geannuleerd"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Allowed values of `services.kind` (text column with a CHECK constraint). */
export const SERVICE_KINDS = ["dienst", "pakket", "extra"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/** Business time zone used to interpret booking dates and times. */
export const BUSINESS_TIME_ZONE = "Europe/Brussels";

/** Belgian VAT rate applied to booking totals (same as the current frontend). */
export const VAT_RATE = 0.21;

export const CURRENCY = "EUR";

/** Error codes returned by the booking/availability endpoints (see docs/API-V1.md). */
export const BOOKING_ERROR_CODES = [
  "VALIDATION_ERROR",
  "VEHICLE_TYPE_NOT_FOUND",
  "SERVICE_NOT_FOUND",
  "BOOKING_SLOT_UNAVAILABLE",
  "BOOKING_OUTSIDE_OPENING_HOURS",
  "BOOKING_IN_PAST",
  "MAIN_SERVICE_REQUIRED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "DATABASE_UNAVAILABLE",
] as const;
export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number];
