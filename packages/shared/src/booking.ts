// Booking and availability contracts shared by the backend and (later) the frontend.
// Framework-independent: only Zod. Field names are snake_case, like the rest of the API.
// Customer validation rules and messages are identical to `customerSchema` in
// src/routes/reservatie.tsx.

import { z } from "zod";
import { SERVICE_KINDS } from "./constants.ts";

const MAX_SERVICES = 50;

/** Local calendar date `YYYY-MM-DD` (Europe/Brussels) that exists in the calendar. */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ongeldige datum (verwacht JJJJ-MM-DD)")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, "Ongeldige datum");

/** Local wall-clock time `HH:MM` (Europe/Brussels). */
export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ongeldig tijdstip (verwacht UU:MM)");

const serviceIdsSchema = z
  .array(z.uuid())
  .min(1, "Kies minstens één dienst")
  .max(MAX_SERVICES)
  .refine((ids) => new Set(ids).size === ids.length, "Dezelfde dienst werd meermaals gekozen");

/** Accepts `a,b,c` (single query parameter) or a repeated parameter (array). */
const serviceIdsQuerySchema = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : value,
  serviceIdsSchema,
);

const optionalText = (max: number) => z.string().trim().max(max).optional();

/** GET /api/availability query. */
export const availabilityQuerySchema = z.strictObject({
  date: localDateSchema,
  vehicle_type_id: z.uuid(),
  service_ids: serviceIdsQuerySchema,
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/**
 * POST /api/bookings body: only what the customer chooses. Prices, durations, totals,
 * status, cancel token and start/end timestamps are computed by the server; sending
 * any of them (or any other unknown field) is a validation error.
 */
export const bookingRequestSchema = z
  .strictObject({
    vehicle_type_id: z.uuid(),
    service_ids: serviceIdsSchema,
    preferred_date: localDateSchema,
    preferred_time: localTimeSchema,

    customer_name: z.string().trim().min(2, "Naam is verplicht").max(100),
    customer_phone: z.string().trim().min(6, "GSM-nummer is verplicht").max(30),
    customer_email: z.string().trim().max(255).pipe(z.email("Ongeldig e-mailadres")),
    vehicle_brand: z.string().trim().min(1, "Merk is verplicht").max(60),
    vehicle_model: z.string().trim().min(1, "Model is verplicht").max(60),
    notes: optionalText(1000),
    company_name: optionalText(120),
    vat_number: optionalText(40),

    on_location: z.boolean().default(false),
    location_in_sint_niklaas: z.boolean().optional(),
    location_address: optionalText(255),
  })
  .refine(
    (data) =>
      !data.on_location ||
      data.location_in_sint_niklaas ||
      (data.location_address !== undefined && data.location_address.length > 5),
    { message: "Vul uw adres in", path: ["location_address"] },
  );
export type BookingRequest = z.input<typeof bookingRequestSchema>;
export type ParsedBookingRequest = z.output<typeof bookingRequestSchema>;

/** One start time offered for a date. */
export const availabilitySlotSchema = z.object({
  /** Local start time `HH:MM`, the value to send as `preferred_time`. */
  time: localTimeSchema,
  start_at: z.iso.datetime({ offset: true }),
  /** Pickup moment (end of the work), possibly on a later day. */
  end_at: z.iso.datetime({ offset: true }),
  pickup_date: localDateSchema,
  pickup_time: localTimeSchema,
});

export const availabilityResponseSchema = z.object({
  data: z.object({
    date: localDateSchema,
    vehicle_type_id: z.uuid(),
    total_duration_minutes: z.number().int().positive(),
    slots: z.array(availabilitySlotSchema),
  }),
});
export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;

export const pricingSchema = z.object({
  /** Sum of the chosen services, excl. VAT. */
  services_subtotal: z.number(),
  location_fee: z.number(),
  /** services_subtotal + location_fee; stored as bookings.total_price. */
  total_excl_vat: z.number(),
  vat_rate: z.number(),
  vat: z.number(),
  total_incl_vat: z.number(),
  currency: z.literal("EUR"),
});
export type Pricing = z.infer<typeof pricingSchema>;

export const bookingCreatedResponseSchema = z.object({
  data: z.object({
    id: z.uuid(),
    status: z.literal("nieuw"),
    preferred_date: localDateSchema,
    preferred_time: localTimeSchema,
    start_at: z.iso.datetime({ offset: true }),
    end_at: z.iso.datetime({ offset: true }),
    pickup_date: localDateSchema,
    pickup_time: localTimeSchema,
    total_duration_minutes: z.number().int().positive(),
    services: z.array(
      z.object({
        service_id: z.uuid(),
        title: z.string(),
        kind: z.enum(SERVICE_KINDS),
        price: z.number(),
        duration_minutes: z.number().int(),
      }),
    ),
    pricing: pricingSchema,
  }),
});
export type BookingCreatedResponse = z.infer<typeof bookingCreatedResponseSchema>;
