import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  numeric,
  pgTable,
  text,
  time,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./columns.ts";

/**
 * Global configuration, exactly one row. Source: M3 + M5.
 *
 * Opening hours: a single daily window (opening_hour/closing_hour) for all days, as today.
 * Per-weekday opening hours are a DEFERRED BUSINESS DECISION (docs/MIGRATION-STATUS.md).
 */
export const siteSettings = pgTable(
  "site_settings",
  {
    id: id(),
    kmFee: numeric("km_fee", { precision: 10, scale: 2 }).notNull().default("1.00"),
    freeKm: numeric("free_km", { precision: 10, scale: 2 }).notNull().default("20"),
    baseAddress: text("base_address").notNull().default("Raapstraat 34, 9100 Sint-Niklaas"),
    baseCity: text("base_city").notNull().default("Sint-Niklaas"),
    openingHour: time("opening_hour").notNull().default("08:00"),
    closingHour: time("closing_hour").notNull().default("22:00"),
    slotIntervalMinutes: integer("slot_interval_minutes").notNull().default(30),
    notificationEmail: text("notification_email"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // At most one row: every row indexes the same constant value.
    uniqueIndex("site_settings_singleton_idx").using("btree", sql`(true)`),
    check("site_settings_hours_check", sql`${t.closingHour} > ${t.openingHour}`),
    check("site_settings_slot_interval_check", sql`${t.slotIntervalMinutes} > 0`),
    check("site_settings_km_fee_check", sql`${t.kmFee} >= 0`),
    check("site_settings_free_km_check", sql`${t.freeKm} >= 0`),
  ],
);

/** Gallery ("realisaties"). Source: M1 + M2. `image_url` will point to self-hosted uploads. */
export const galleryItems = pgTable("gallery_items", {
  id: id(),
  title: text("title"),
  description: text("description"),
  imageUrl: text("image_url").notNull(),
  beforeImageUrl: text("before_image_url"),
  category: text("category"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Customer reviews; only `approved` ones are public. Source: M1. */
export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    customerName: text("customer_name").notNull(),
    rating: integer("rating").notNull(),
    content: text("content").notNull(),
    approved: boolean("approved").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("reviews_rating_check", sql`${t.rating} BETWEEN 1 AND 5`)],
);
