// Request and response contracts of the admin WRITE API (phase 6B), shared by the backend
// (request parsing) and the admin frontend (request validation before sending, response
// validation after). All request objects are strict: unknown fields (e.g. total_price, total_duration_minutes, cancel_token, start_at)
// are rejected with 400. Mapping to the current UI: docs/ADMIN-WRITE-MIGRATION-MAP.md.

import { z } from "zod";
import {
  adminBlockedPeriod,
  adminBookingDetail,
  adminGalleryItem,
  adminService,
  adminVehicleType,
  calendarDate,
  dayNumber,
  settingsResponse,
} from "./admin.ts";

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm");
const statuses = ["nieuw", "bevestigd", "voltooid", "geannuleerd"] as const;
const kinds = ["dienst", "pakket", "extra"] as const;

/** Longest duration accepted for one service row: one week. */
export const MAX_DURATION_MINUTES = 7 * 24 * 60;

/** Non-negative euro amount with at most 2 decimals that fits numeric(10,2). */
const money = z
  .number()
  .nonnegative()
  .max(99_999_999.99)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "at most 2 decimals");

const uuidList = (min: number, max: number) =>
  z
    .array(z.uuid())
    .min(min)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, "duplicate ids");

/** Optional text; "" (what the current UI sends for a cleared field) becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

const requiredText = (max: number) => z.string().trim().min(1).max(max);
const durationMinutes = z.number().int().min(1).max(MAX_DURATION_MINUTES);
const sortOrder = z.number().int().min(0).max(1_000_000);
const atLeastOneField = (value: object) => Object.keys(value).length > 0;
const nonEmpty = { message: "at least one field is required" };

/** Absolute path ("/uploads/…") or http(s) URL; storage itself moves in phase 6C. */
const imageUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (v) => (v.startsWith("/") && !v.startsWith("//")) || /^https?:\/\/[^\s]+$/i.test(v),
    "must be an absolute path or an http(s) URL",
  );

// ---------- Bookings ----------

/**
 * POST /api/admin/bookings. Only choices and customer data: price, duration, location fee,
 * start/end and cancel token are computed by the server (same engine as POST /api/bookings).
 */
export const adminBookingCreate = z.strictObject({
  vehicle_type_id: z.uuid(),
  service_ids: uuidList(1, 50),
  preferred_date: calendarDate,
  preferred_time: localTime,
  customer_name: requiredText(100),
  customer_email: z.string().trim().max(255).pipe(z.email("invalid e-mail address")),
  customer_phone: requiredText(30),
  vehicle_brand: optionalText(60),
  vehicle_model: optionalText(60),
  notes: optionalText(1000),
  /** The agenda dialog offers these three; cancelling is an update. Default as in the UI. */
  status: z.enum(["nieuw", "bevestigd", "voltooid"]).default("bevestigd"),
});

/**
 * PATCH /api/admin/bookings/:id. Fields the current admin UI can change. Duration and price
 * are never sent: they follow from service_ids (re-priced server-side).
 */
export const adminBookingPatch = z
  .strictObject({
    preferred_date: calendarDate.optional(),
    preferred_time: localTime.optional(),
    status: z.enum(statuses).optional(),
    notes: optionalText(1000),
    vehicle_type_id: z.uuid().optional(),
    service_ids: uuidList(1, 50).optional(),
  })
  .refine(atLeastOneField, nonEmpty);

/** GET /api/admin/availability: free slots, optionally ignoring the booking being moved. */
export const adminAvailabilityQuery = z
  .strictObject({
    date: calendarDate,
    exclude_booking_id: z.uuid().optional(),
    vehicle_type_id: z.uuid().optional(),
    service_ids: z
      .preprocess(
        (v) =>
          typeof v === "string"
            ? v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : v,
        uuidList(1, 50),
      )
      .optional(),
  })
  .refine((q) => Boolean(q.vehicle_type_id) === Boolean(q.service_ids), {
    message: "vehicle_type_id and service_ids must be given together",
    path: ["service_ids"],
  })
  .refine((q) => q.service_ids || q.exclude_booking_id, {
    message: "give vehicle_type_id + service_ids, or exclude_booking_id (uses its duration)",
    path: ["service_ids"],
  });

// ---------- Services & packages ----------

const serviceFields = {
  title: requiredText(200),
  description: optionalText(2000),
  icon: optionalText(50),
  category: optionalText(100),
  badge: optionalText(50),
  image_url: optionalText(2048),
  bookable: z.boolean(),
  active: z.boolean(),
  sort_order: sortOrder,
  kind: z.enum(kinds),
  /** LEGACY base price/duration (home page only). */
  price: money.nullable(),
  duration_minutes: durationMinutes.nullable(),
};

export const serviceCreate = z.strictObject({
  ...serviceFields,
  kind: z.enum(kinds),
  title: serviceFields.title.optional(),
  bookable: serviceFields.bookable.optional(),
  active: serviceFields.active.optional(),
  sort_order: sortOrder.optional(),
  price: serviceFields.price.optional(),
  duration_minutes: serviceFields.duration_minutes.optional(),
});

export const servicePatch = z
  .strictObject({
    title: serviceFields.title.optional(),
    description: serviceFields.description,
    icon: serviceFields.icon,
    category: serviceFields.category,
    badge: serviceFields.badge,
    image_url: serviceFields.image_url,
    bookable: serviceFields.bookable.optional(),
    active: serviceFields.active.optional(),
    sort_order: sortOrder.optional(),
    kind: serviceFields.kind.optional(),
    price: serviceFields.price.optional(),
    duration_minutes: serviceFields.duration_minutes.optional(),
  })
  .refine(atLeastOneField, nonEmpty);

/** PUT /api/admin/services/:id/package-content: the complete list of contained services. */
export const packageContentPut = z.strictObject({ service_ids: uuidList(0, 100) });

// ---------- Vehicle types & pricing ----------

const slug = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, digits and single hyphens");

export const vehicleTypeCreate = z.strictObject({
  slug: slug.optional(),
  title: requiredText(200).optional(),
  description: optionalText(2000),
  image_url: optionalText(2048),
  active: z.boolean().optional(),
  sort_order: sortOrder.optional(),
});

export const vehicleTypePatch = z
  .strictObject({
    slug: slug.optional(),
    title: requiredText(200).optional(),
    description: optionalText(2000),
    image_url: optionalText(2048),
    active: z.boolean().optional(),
    sort_order: sortOrder.optional(),
  })
  .refine(atLeastOneField, nonEmpty);

/** PUT /api/admin/vehicle-types/:id/pricing: saved all-or-nothing. */
export const pricingMatrixPut = z.strictObject({
  rows: z
    .array(
      z.strictObject({
        service_id: z.uuid(),
        available: z.boolean(),
        price: money,
        duration_minutes: durationMinutes,
      }),
    )
    .min(1)
    .max(500)
    .refine((rows) => new Set(rows.map((r) => r.service_id)).size === rows.length, {
      message: "duplicate service_id",
    }),
});

// ---------- Blocked periods, settings, gallery ----------

export const blockedPeriodCreate = z
  .strictObject({
    start_date: calendarDate,
    end_date: calendarDate,
    start_time: localTime.nullable().optional(),
    end_time: localTime.nullable().optional(),
    reason: optionalText(500),
  })
  .refine((b) => dayNumber(b.start_date)! <= dayNumber(b.end_date)!, {
    message: "start_date must be on or before end_date",
    path: ["end_date"],
  })
  .refine((b) => !b.start_time || !b.end_time || b.start_time < b.end_time, {
    message: "start_time must be before end_time",
    path: ["end_time"],
  });

export const settingsPatch = z
  .strictObject({
    km_fee: money.optional(),
    free_km: money.optional(),
    base_address: requiredText(255).optional(),
    base_city: requiredText(100).optional(),
    opening_hour: localTime.optional(),
    closing_hour: localTime.optional(),
    slot_interval_minutes: z.number().int().min(1).max(1440).optional(),
    /** "" (cleared field in the UI) or null removes the address. */
    notification_email: z
      .union([z.literal(""), z.null(), z.string().trim().max(255).pipe(z.email())])
      .optional()
      .transform((v) => (v === "" ? null : v)),
  })
  .refine(atLeastOneField, nonEmpty);

export const galleryCreate = z.strictObject({
  image_url: imageUrl,
  title: optionalText(200),
  description: optionalText(2000),
  sort_order: sortOrder.optional(),
});

/** The current UI edits title, description and sort order only. */
export const galleryPatch = z
  .strictObject({
    title: optionalText(200),
    description: optionalText(2000),
    sort_order: sortOrder.optional(),
  })
  .refine(atLeastOneField, nonEmpty);

/**
 * Text fields of POST /api/admin/gallery/upload (multipart: every value is a string). Only
 * what the current UI uses; the image URL is generated by the server, never sent.
 */
export const galleryUploadFields = z.strictObject({
  title: optionalText(200),
  description: optionalText(2000),
  sort_order: z
    .string()
    .regex(/^\d{1,7}$/, "expected a non-negative integer")
    .transform(Number)
    .pipe(sortOrder)
    .optional(),
});

// ---------- Responses ----------

export const adminPricing = z.strictObject({
  services_subtotal: z.number(),
  location_fee: z.number(),
  /** = bookings.total_price */
  total_excl_vat: z.number(),
  vat_rate: z.number(),
  vat: z.number(),
  total_incl_vat: z.number(),
  currency: z.literal("EUR"),
});

export const adminBookingWriteResponse = z.strictObject({
  data: adminBookingDetail.extend({ pricing: adminPricing }),
});

export const adminAvailabilityResponse = z.strictObject({
  data: z.strictObject({
    date: calendarDate,
    total_duration_minutes: z.number().int(),
    exclude_booking_id: z.uuid().nullable(),
    slots: z.array(
      z.strictObject({
        time: localTime,
        start_at: z.iso.datetime({ offset: true }),
        end_at: z.iso.datetime({ offset: true }),
        pickup_date: calendarDate,
        pickup_time: localTime,
      }),
    ),
  }),
});

export const serviceResponse = z.strictObject({ data: adminService });
export const vehicleTypeResponse = z.strictObject({ data: adminVehicleType });
export const blockedPeriodResponse = z.strictObject({ data: adminBlockedPeriod });
export const galleryItemResponse = z.strictObject({ data: adminGalleryItem });
export { settingsResponse };

export type AdminBookingCreate = z.output<typeof adminBookingCreate>;
export type AdminBookingPatch = z.output<typeof adminBookingPatch>;
export type ServiceCreate = z.output<typeof serviceCreate>;
export type ServicePatch = z.output<typeof servicePatch>;
export type VehicleTypeCreate = z.output<typeof vehicleTypeCreate>;
export type VehicleTypePatch = z.output<typeof vehicleTypePatch>;
export type PricingRow = z.output<typeof pricingMatrixPut>["rows"][number];
export type BlockedPeriodCreate = z.output<typeof blockedPeriodCreate>;
export type SettingsPatch = z.output<typeof settingsPatch>;
export type GalleryCreate = z.output<typeof galleryCreate>;
export type GalleryPatch = z.output<typeof galleryPatch>;
export type GalleryUploadFields = z.output<typeof galleryUploadFields>;

/** What a client may pass in (before defaults/transforms). */
export type AdminBookingCreateInput = z.input<typeof adminBookingCreate>;
export type AdminBookingPatchInput = z.input<typeof adminBookingPatch>;
export type AdminAvailabilityQueryInput = z.input<typeof adminAvailabilityQuery>;
export type ServiceCreateInput = z.input<typeof serviceCreate>;
export type ServicePatchInput = z.input<typeof servicePatch>;
export type VehicleTypeCreateInput = z.input<typeof vehicleTypeCreate>;
export type VehicleTypePatchInput = z.input<typeof vehicleTypePatch>;
export type PricingRowInput = z.input<typeof pricingMatrixPut>["rows"][number];
export type BlockedPeriodCreateInput = z.input<typeof blockedPeriodCreate>;
export type SettingsPatchInput = z.input<typeof settingsPatch>;
export type GalleryCreateInput = z.input<typeof galleryCreate>;
export type GalleryPatchInput = z.input<typeof galleryPatch>;
export type AdminPricing = z.output<typeof adminPricing>;
export type AdminBookingWrite = z.output<typeof adminBookingWriteResponse>["data"];
export type AdminAvailability = z.output<typeof adminAvailabilityResponse>["data"];
