// Contracts of the admin read API (/api/admin/*). All objects are strict: a field that is
// not listed here can never reach a response. Notably absent: bookings.cancel_token.
// Conventions: docs/ADMIN-API.md.

import { z } from "zod";

const isoDateTime = z.iso.datetime({ offset: true });
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Days since epoch of an existing calendar date `YYYY-MM-DD`, or null (e.g. 2026-02-30). */
function dayNumber(value: string): number | null {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  const dt = new Date(ms);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    ? ms / 86_400_000
    : null;
}
const calendarDate = localDate.refine((v) => dayNumber(v) !== null, "invalid calendar date");
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const money = z.number();
const bookingStatus = z.enum(["nieuw", "bevestigd", "voltooid", "geannuleerd"]);
const serviceKind = z.enum(["dienst", "pakket", "extra"]);

// ---------- Requests ----------

export const noQuery = z.strictObject({});

export const paginationQuery = z.strictObject({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const idParams = z.strictObject({ id: z.uuid() });

export const MAX_AGENDA_DAYS = 62;

/** Inclusive local-date range (Europe/Brussels), at most MAX_AGENDA_DAYS days. */
export const agendaQuery = z
  .strictObject({ start: calendarDate, end: calendarDate })
  .refine((q) => dayNumber(q.start)! <= dayNumber(q.end)!, {
    message: "start must be on or before end",
    path: ["end"],
  })
  .refine((q) => dayNumber(q.end)! - dayNumber(q.start)! < MAX_AGENDA_DAYS, {
    message: `range may span at most ${MAX_AGENDA_DAYS} days`,
    path: ["end"],
  });

// ---------- Shared shapes ----------

export const paginationMeta = z.strictObject({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  total_pages: z.number().int(),
});

export const countMeta = z.strictObject({ total: z.number().int() });

const vehicleTypeRef = z.strictObject({ id: z.uuid(), slug: z.string(), title: z.string() });

/** A booking as the admin sees it. Local date/time fields are Europe/Brussels. */
export const adminBooking = z.strictObject({
  id: z.uuid(),
  status: bookingStatus,
  customer_name: z.string(),
  customer_email: z.string(),
  customer_phone: z.string(),
  company_name: z.string().nullable(),
  vat_number: z.string().nullable(),
  notes: z.string().nullable(),
  vehicle_type: vehicleTypeRef.nullable(),
  vehicle_brand: z.string().nullable(),
  vehicle_model: z.string().nullable(),
  /** LEGACY "brand model" text. */
  vehicle_info: z.string().nullable(),
  /** LEGACY: first service / joined titles (see booking_services for the real lines). */
  service_id: z.uuid().nullable(),
  service_title: z.string().nullable(),
  preferred_date: localDate,
  preferred_time: localTime,
  start_at: isoDateTime,
  end_at: isoDateTime,
  /** Local pickup moment = end_at in Europe/Brussels (replaces the old end_time text). */
  pickup_date: localDate,
  pickup_time: localTime,
  total_duration_minutes: z.number().int(),
  /** Excluding VAT (bookings.total_price). */
  total_price: money,
  location_fee: money,
  on_location: z.boolean(),
  location_in_sint_niklaas: z.boolean().nullable(),
  location_address: z.string().nullable(),
  location_distance_km: z.number().nullable(),
  cancelled_at: isoDateTime.nullable(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});

export const adminBookingLine = z.strictObject({
  id: z.uuid(),
  service_id: z.uuid().nullable(),
  service_title: z.string(),
  price: money,
  duration_minutes: z.number().int(),
});

export const adminBookingDetail = adminBooking.extend({ services: z.array(adminBookingLine) });

export const adminBlockedPeriod = z.strictObject({
  id: z.uuid(),
  start_date: localDate,
  end_date: localDate,
  /** null = from 00:00 */
  start_time: localTime.nullable(),
  /** null = until 24:00 */
  end_time: localTime.nullable(),
  reason: z.string().nullable(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});

// ---------- Responses ----------

export const dashboardResponse = z.strictObject({
  data: z.strictObject({
    today: localDate,
    week_start: localDate,
    week_end: localDate,
    counts: z.strictObject({
      active_services: z.number().int(),
      gallery_items: z.number().int(),
      active_vehicle_types: z.number().int(),
    }),
    week: z.strictObject({
      booking_count: z.number().int(),
      /** Sum of total_price (excl. VAT) of non-cancelled bookings starting this week. */
      revenue_excl_vat: money,
      days: z.array(
        z.strictObject({
          date: localDate,
          booking_count: z.number().int(),
          revenue_excl_vat: money,
        }),
      ),
    }),
    today_bookings: z.array(
      z.strictObject({
        id: z.uuid(),
        customer_name: z.string(),
        service_title: z.string().nullable(),
        preferred_time: localTime,
        status: bookingStatus,
      }),
    ),
    next_booking: z
      .strictObject({
        id: z.uuid(),
        customer_name: z.string(),
        service_title: z.string().nullable(),
        preferred_date: localDate,
        preferred_time: localTime,
        start_at: isoDateTime,
        status: bookingStatus,
      })
      .nullable(),
  }),
});

export const bookingsListResponse = z.strictObject({
  data: z.array(adminBooking),
  meta: paginationMeta,
});

export const bookingDetailResponse = z.strictObject({ data: adminBookingDetail });

export const agendaResponse = z.strictObject({
  data: z.strictObject({
    start: localDate,
    end: localDate,
    bookings: z.array(adminBooking),
    blocked_periods: z.array(adminBlockedPeriod),
  }),
});

export const adminService = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  kind: serviceKind,
  category: z.string().nullable(),
  badge: z.string().nullable(),
  icon: z.string().nullable(),
  image_url: z.string().nullable(),
  bookable: z.boolean(),
  active: z.boolean(),
  sort_order: z.number().int(),
  /** LEGACY base price/duration (home page only). */
  price: money.nullable(),
  duration_minutes: z.number().int().nullable(),
  /** For packages: ids of the contained services (package_services). */
  included_service_ids: z.array(z.uuid()),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});

export const servicesResponse = z.strictObject({ data: z.array(adminService), meta: countMeta });

export const adminVehicleType = z.strictObject({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  image_url: z.string().nullable(),
  icon: z.string().nullable(),
  sort_order: z.number().int(),
  active: z.boolean(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
  /** Pricing matrix rows (vehicle_type_services) for this type, by service title. */
  services: z.array(
    z.strictObject({
      id: z.uuid(),
      service_id: z.uuid(),
      title: z.string(),
      kind: serviceKind,
      service_active: z.boolean(),
      service_bookable: z.boolean(),
      available: z.boolean(),
      price: money,
      duration_minutes: z.number().int(),
    }),
  ),
});

export const vehicleTypesResponse = z.strictObject({
  data: z.array(adminVehicleType),
  meta: countMeta,
});

export const blockedPeriodsResponse = z.strictObject({
  data: z.array(adminBlockedPeriod),
  meta: countMeta,
});

export const settingsResponse = z.strictObject({
  data: z.strictObject({
    id: z.uuid(),
    opening_hour: localTime,
    closing_hour: localTime,
    slot_interval_minutes: z.number().int(),
    km_fee: money,
    free_km: z.number(),
    base_address: z.string(),
    base_city: z.string(),
    notification_email: z.string().nullable(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  }),
});

export const adminGalleryItem = z.strictObject({
  id: z.uuid(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  image_url: z.string(),
  before_image_url: z.string().nullable(),
  category: z.string().nullable(),
  sort_order: z.number().int(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});

export const galleryResponse = z.strictObject({
  data: z.array(adminGalleryItem),
  meta: countMeta,
});

export type AdminBooking = z.infer<typeof adminBooking>;
export type AdminBlockedPeriod = z.infer<typeof adminBlockedPeriod>;
export type DashboardData = z.infer<typeof dashboardResponse>["data"];
export type AdminService = z.infer<typeof adminService>;
export type AdminVehicleType = z.infer<typeof adminVehicleType>;
export type AdminGalleryItem = z.infer<typeof adminGalleryItem>;
export type AdminSettings = z.infer<typeof settingsResponse>["data"];
export type PaginationMeta = z.infer<typeof paginationMeta>;
