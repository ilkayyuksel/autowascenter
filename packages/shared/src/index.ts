// Shared contracts between the future backend (apps/api) and the frontend.
//
// Phase 2 intentionally keeps this package minimal: only domain constants that
// already exist in the current database. Zod schemas and API/booking/pricing/
// availability contracts are added when the backend endpoints are built.

/** Values of the PostgreSQL enum `booking_status` (unchanged from Supabase). */
export const BOOKING_STATUSES = ["nieuw", "bevestigd", "voltooid", "geannuleerd"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Allowed values of `services.kind` (text column with a CHECK constraint). */
export const SERVICE_KINDS = ["dienst", "pakket", "extra"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/** Business time zone used to interpret booking dates and times. */
export const BUSINESS_TIME_ZONE = "Europe/Brussels";
