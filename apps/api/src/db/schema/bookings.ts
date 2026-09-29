import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { services, vehicleTypes } from "./catalog.ts";
import { createdAt, id, updatedAt } from "./columns.ts";

/** Unchanged from Supabase (M1). */
export const bookingStatus = pgEnum("booking_status", [
  "nieuw",
  "bevestigd",
  "voltooid",
  "geannuleerd",
]);

/**
 * Reservation header. Source: Supabase M1 + M3.
 *
 * Changes versus Supabase (see docs/DATABASE-MIGRATION-MAP.md):
 * - `preferred_time` is `time` instead of `text`.
 * - `end_time text` is replaced by `start_at` / `end_at timestamptz`: the real occupied
 *   interval, which can span several business days. The overlap exclusion constraint is
 *   defined on this range (custom migration `0001_booking_integrity.sql`).
 * - `preferred_date` + `preferred_time` stay as the local (Europe/Brussels) wall-clock
 *   start and must match `start_at` (CHECK).
 * - `cancel_token` is UNIQUE; `vehicle_type_id` is ON DELETE RESTRICT.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone").notNull(),
    companyName: text("company_name"),
    vatNumber: text("vat_number"),
    notes: text("notes"),

    vehicleTypeId: uuid("vehicle_type_id").references(() => vehicleTypes.id, {
      onDelete: "restrict",
    }),
    vehicleBrand: text("vehicle_brand"),
    vehicleModel: text("vehicle_model"),
    /** LEGACY: "<brand> <model>", kept for bookings created before brand/model existed. */
    vehicleInfo: text("vehicle_info"),

    /** LEGACY: first chosen service only. Use booking_services instead. */
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    /** LEGACY snapshot: comma-joined service titles. Use booking_services instead. */
    serviceTitle: text("service_title"),

    /** Local start date (Europe/Brussels). */
    preferredDate: date("preferred_date").notNull(),
    /** Local start time (Europe/Brussels). */
    preferredTime: time("preferred_time").notNull(),
    /** Start of the occupied interval. */
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    /** Pickup moment: end of the occupied interval, possibly on a later business day. */
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    totalDurationMinutes: integer("total_duration_minutes").notNull(),

    /** Excluding VAT. */
    totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull().default("0"),
    locationFee: numeric("location_fee", { precision: 10, scale: 2 }).notNull().default("0"),
    onLocation: boolean("on_location").notNull().default(false),
    locationInSintNiklaas: boolean("location_in_sint_niklaas"),
    locationAddress: text("location_address"),
    locationDistanceKm: numeric("location_distance_km", { precision: 10, scale: 2 }),

    status: bookingStatus("status").notNull().default("nieuw"),
    cancelToken: uuid("cancel_token").notNull().defaultRandom().unique("bookings_cancel_token_key"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("bookings_preferred_date_idx").on(t.preferredDate),
    index("bookings_vehicle_type_id_idx").on(t.vehicleTypeId),
    index("bookings_service_id_idx").on(t.serviceId),
    index("bookings_status_idx").on(t.status),
    check("bookings_total_price_check", sql`${t.totalPrice} >= 0`),
    check("bookings_location_fee_check", sql`${t.locationFee} >= 0`),
    check(
      "bookings_location_distance_km_check",
      sql`${t.locationDistanceKm} IS NULL OR ${t.locationDistanceKm} >= 0`,
    ),
    check("bookings_total_duration_check", sql`${t.totalDurationMinutes} > 0`),
    check("bookings_interval_check", sql`${t.endAt} > ${t.startAt}`),
    check(
      "bookings_start_matches_local_check",
      sql`${t.startAt} = ((${t.preferredDate} + ${t.preferredTime}) AT TIME ZONE 'Europe/Brussels')`,
    ),
  ],
);

/** Snapshot of each service chosen in a booking (title/price/duration at booking time). Source: M3. */
export const bookingServices = pgTable(
  "booking_services",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    serviceTitle: text("service_title").notNull(),
    price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
    durationMinutes: integer("duration_minutes").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("booking_services_booking_id_idx").on(t.bookingId),
    index("booking_services_service_id_idx").on(t.serviceId),
    check("booking_services_price_check", sql`${t.price} >= 0`),
    check("booking_services_duration_check", sql`${t.durationMinutes} >= 0`),
  ],
);

/**
 * Unavailable periods. Source: M3; times changed from `text` to `time`.
 * A NULL start_time means "from 00:00", a NULL end_time means "until 24:00",
 * applied to every day in [start_date, end_date] (same semantics as src/lib/slots.ts).
 */
export const blockedPeriods = pgTable(
  "blocked_periods",
  {
    id: id(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"),
    reason: text("reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("blocked_periods_dates_idx").on(t.startDate, t.endDate),
    check("blocked_periods_dates_check", sql`${t.startDate} <= ${t.endDate}`),
    check(
      "blocked_periods_times_check",
      sql`${t.startTime} IS NULL OR ${t.endTime} IS NULL OR ${t.startTime} < ${t.endTime}`,
    ),
  ],
);
