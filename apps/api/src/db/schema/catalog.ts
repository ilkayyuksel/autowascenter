import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./columns.ts";

/** Catalogue of services, packages and extras (`kind`). Source: Supabase M1 + M2 + M5. */
export const services = pgTable(
  "services",
  {
    id: id(),
    title: text("title").notNull(),
    description: text("description"),
    /** LEGACY: base price, only shown on the home page. Real prices live in vehicle_type_services. */
    price: numeric("price", { precision: 10, scale: 2 }),
    /** LEGACY: base duration, only shown on the home page. Real durations live in vehicle_type_services. */
    durationMinutes: integer("duration_minutes"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    /** false = walk-in only ("vrij binnenlopen"), not offered in the online booking flow. */
    bookable: boolean("bookable").notNull().default(true),
    category: text("category"),
    imageUrl: text("image_url"),
    badge: text("badge"),
    kind: text("kind", { enum: ["dienst", "pakket", "extra"] })
      .notNull()
      .default("dienst"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("services_kind_check", sql`${t.kind} IN ('dienst', 'pakket', 'extra')`)],
);

/** Which services a package contains. Display only: does not affect price or duration. Source: M5. */
export const packageServices = pgTable(
  "package_services",
  {
    id: id(),
    packageId: uuid("package_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("package_services_package_id_service_id_key").on(t.packageId, t.serviceId),
    check("package_services_not_self_check", sql`${t.packageId} <> ${t.serviceId}`),
    index("package_services_service_id_idx").on(t.serviceId),
  ],
);

/** Vehicle categories chosen in step 1 of the booking flow. Source: M3. */
export const vehicleTypes = pgTable("vehicle_types", {
  id: id(),
  slug: text("slug").notNull().unique("vehicle_types_slug_key"),
  title: text("title").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Price and duration per (vehicle type, service): the source of truth for pricing. Source: M3. */
export const vehicleTypeServices = pgTable(
  "vehicle_type_services",
  {
    id: id(),
    vehicleTypeId: uuid("vehicle_type_id")
      .notNull()
      .references(() => vehicleTypes.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    available: boolean("available").notNull().default(true),
    price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Leading column vehicle_type_id also serves lookups by vehicle type (replaces idx_vts_vehicle).
    unique("vehicle_type_services_vehicle_type_id_service_id_key").on(t.vehicleTypeId, t.serviceId),
    index("vehicle_type_services_service_id_idx").on(t.serviceId),
    check("vehicle_type_services_price_check", sql`${t.price} >= 0`),
    check("vehicle_type_services_duration_check", sql`${t.durationMinutes} > 0`),
  ],
);
