// Admin catalogue mutations: services, package contents, vehicle types, pricing matrix.
// Multi-table changes run in ONE Drizzle transaction each (visible below); UI defaults are
// copied exactly from src/routes/admin/diensten.tsx and voertuigen.tsx.

import { and, count, eq, inArray } from "drizzle-orm";
import type {
  PricingRow,
  ServiceCreate,
  ServicePatch,
  VehicleTypeCreate,
  VehicleTypePatch,
} from "../../contracts/admin-write.ts";
import type { Database } from "../../db/index.ts";
import {
  packageServices,
  services,
  vehicleTypes,
  vehicleTypeServices,
} from "../../db/schema/index.ts";
import { AppError } from "../../errors/app-error.ts";
import { pgErrorCode } from "../../errors/error-handler.ts";
import { getAdminService, getAdminVehicleType } from "./catalog.service.ts";

const notFound = (what: string) => new AppError(404, "RESOURCE_NOT_FOUND", `${what} not found.`);
const invalid = (message: string) =>
  new AppError(400, "VALIDATION_ERROR", `Invalid request: ${message}`);

const toNumeric = (euros: number) => euros.toFixed(2);
const numericOrNull = (euros: number | null | undefined) =>
  euros === undefined ? undefined : euros === null ? null : toNumeric(euros);

/** Drops undefined keys so a PATCH only touches the fields that were sent. */
function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Default titles of diensten.tsx `addNew`. */
const DEFAULT_SERVICE_TITLE = {
  pakket: "Nieuw pakket",
  dienst: "Nieuwe dienst",
  extra: "Nieuwe extra dienst",
} as const;
/** diensten.tsx: price rows for every vehicle type, price 0, duration 60, available. */
const NEW_SERVICE_ROW = { available: true, price: "0.00", durationMinutes: 60 };
/** voertuigen.tsx: price rows for every active+bookable service, price 30, duration 60. */
const NEW_VEHICLE_ROW = { available: true, price: "30.00", durationMinutes: 60 };

// ---------- Services ----------

/**
 * POST /api/admin/services: the service + a pricing row for EVERY vehicle type, in one
 * transaction. If any pricing row fails, the service is not created either.
 */
export async function createService(db: Database, input: ServiceCreate) {
  const id = await db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    const [{ total }] = (await t.select({ total: count() }).from(services)) as [{ total: number }];
    const [created] = await t
      .insert(services)
      .values({
        kind: input.kind,
        title: input.title ?? DEFAULT_SERVICE_TITLE[input.kind],
        description: input.description ?? null,
        icon: input.icon === undefined ? "sparkles" : input.icon,
        category: input.category ?? null,
        badge: input.badge ?? null,
        imageUrl: input.image_url ?? null,
        bookable: input.bookable ?? true,
        active: input.active ?? true,
        sortOrder: input.sort_order ?? total, // diensten.tsx: items.length
        price: numericOrNull(input.price) ?? null,
        durationMinutes: input.duration_minutes ?? null,
      })
      .returning({ id: services.id });
    const serviceId = created!.id;

    const types = await t.select({ id: vehicleTypes.id }).from(vehicleTypes);
    if (types.length > 0) {
      await t
        .insert(vehicleTypeServices)
        .values(types.map((v) => ({ vehicleTypeId: v.id, serviceId, ...NEW_SERVICE_ROW })));
    }
    return serviceId;
  });
  return getAdminService(db, id);
}

/** PATCH /api/admin/services/:id (fields of diensten.tsx "Opslaan"; package contents separate). */
export async function updateService(db: Database, id: string, patch: ServicePatch) {
  const set = defined({
    title: patch.title,
    description: patch.description,
    icon: patch.icon,
    category: patch.category,
    badge: patch.badge,
    imageUrl: patch.image_url,
    bookable: patch.bookable,
    active: patch.active,
    sortOrder: patch.sort_order,
    kind: patch.kind,
    price: numericOrNull(patch.price),
    durationMinutes: patch.duration_minutes,
  });
  const [row] = await db
    .update(services)
    .set(set)
    .where(eq(services.id, id))
    .returning({ id: services.id });
  if (!row) throw notFound("Service");
  return getAdminService(db, id);
}

/**
 * PUT /api/admin/services/:id/package-content. Validates everything first, then replaces the
 * rows (DELETE + INSERT) in one transaction: never a half-updated package.
 */
export async function replacePackageContent(db: Database, id: string, serviceIds: string[]) {
  await db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    const [pkg] = await t
      .select({ kind: services.kind })
      .from(services)
      .where(eq(services.id, id))
      .for("update");
    if (!pkg) throw notFound("Service");
    if (pkg.kind !== "pakket")
      throw invalid("only a service of kind 'pakket' has package contents.");
    if (serviceIds.includes(id)) throw invalid("a package cannot contain itself.");

    if (serviceIds.length > 0) {
      const found = await t
        .select({ id: services.id, kind: services.kind })
        .from(services)
        .where(inArray(services.id, serviceIds));
      if (found.length !== serviceIds.length)
        throw invalid("one or more service_ids do not exist.");
      // diensten.tsx only offers non-package services as contents.
      if (found.some((s) => s.kind === "pakket"))
        throw invalid("a package cannot contain a package.");
    }

    await t.delete(packageServices).where(eq(packageServices.packageId, id));
    if (serviceIds.length > 0) {
      await t
        .insert(packageServices)
        .values(serviceIds.map((serviceId) => ({ packageId: id, serviceId })));
    }
  });
  return getAdminService(db, id);
}

/**
 * DELETE /api/admin/services/:id. FK semantics (phase 2): pricing rows and package contents
 * CASCADE; booking_services.service_id and bookings.service_id SET NULL, so booking
 * snapshots (title, price, duration) are preserved.
 */
export async function deleteService(db: Database, id: string) {
  const [row] = await db.delete(services).where(eq(services.id, id)).returning({ id: services.id });
  if (!row) throw notFound("Service");
}

// ---------- Vehicle types ----------

const slugTaken = () =>
  new AppError(409, "RESOURCE_CONFLICT", "A vehicle type with this slug already exists.");

async function mapSlugConflict<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (pgErrorCode(error) === "23505") throw slugTaken();
    throw error;
  }
}

/**
 * POST /api/admin/vehicle-types: the type + pricing rows for every ACTIVE, BOOKABLE service
 * (voertuigen.tsx defaults), in one transaction.
 */
export async function createVehicleType(db: Database, input: VehicleTypeCreate, now: Date) {
  const id = await mapSlugConflict(() =>
    db.transaction(async (tx) => {
      const t = tx as unknown as Database;
      const [{ total }] = (await t.select({ total: count() }).from(vehicleTypes)) as [
        { total: number },
      ];
      const [created] = await t
        .insert(vehicleTypes)
        .values({
          slug: input.slug ?? `nieuw-${now.getTime()}`, // voertuigen.tsx: nieuw-${Date.now()}
          title: input.title ?? "Nieuw voertuigtype",
          description: input.description ?? null,
          imageUrl: input.image_url ?? null,
          active: input.active ?? true,
          sortOrder: input.sort_order ?? total * 10, // voertuigen.tsx: vehicles.length * 10
        })
        .returning({ id: vehicleTypes.id });
      const vehicleTypeId = created!.id;

      const bookable = await t
        .select({ id: services.id })
        .from(services)
        .where(and(eq(services.active, true), eq(services.bookable, true)));
      if (bookable.length > 0) {
        await t
          .insert(vehicleTypeServices)
          .values(bookable.map((s) => ({ vehicleTypeId, serviceId: s.id, ...NEW_VEHICLE_ROW })));
      }
      return vehicleTypeId;
    }),
  );
  return getAdminVehicleType(db, id);
}

/** PATCH /api/admin/vehicle-types/:id. A duplicate slug → 409 RESOURCE_CONFLICT. */
export async function updateVehicleType(db: Database, id: string, patch: VehicleTypePatch) {
  const set = defined({
    slug: patch.slug,
    title: patch.title,
    description: patch.description,
    imageUrl: patch.image_url,
    active: patch.active,
    sortOrder: patch.sort_order,
  });
  const [row] = await mapSlugConflict(() =>
    db
      .update(vehicleTypes)
      .set(set)
      .where(eq(vehicleTypes.id, id))
      .returning({ id: vehicleTypes.id }),
  );
  if (!row) throw notFound("Vehicle type");
  return getAdminVehicleType(db, id);
}

/**
 * DELETE /api/admin/vehicle-types/:id. bookings.vehicle_type_id is ON DELETE RESTRICT: a type
 * that bookings still refer to cannot be deleted → 409 RESOURCE_IN_USE (no DB details).
 */
export async function deleteVehicleType(db: Database, id: string) {
  try {
    const [row] = await db
      .delete(vehicleTypes)
      .where(eq(vehicleTypes.id, id))
      .returning({ id: vehicleTypes.id });
    if (!row) throw notFound("Vehicle type");
  } catch (error) {
    // 23001 = restrict_violation (ON DELETE RESTRICT), 23503 = foreign_key_violation.
    const code = pgErrorCode(error);
    if (code === "23001" || code === "23503") {
      throw new AppError(
        409,
        "RESOURCE_IN_USE",
        "This vehicle type is used by existing bookings and cannot be deleted.",
      );
    }
    throw error;
  }
}

/**
 * PUT /api/admin/vehicle-types/:id/pricing: all rows saved in ONE transaction (replaces the
 * UI's parallel per-row updates). Rows are upserted per (vehicle type, service); rows not in
 * the request stay unchanged. Any failure rolls back every row.
 */
export async function savePricingMatrix(db: Database, vehicleTypeId: string, rows: PricingRow[]) {
  await db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    // Lock the vehicle type so two matrix saves for it serialize.
    const [vt] = await t
      .select({ id: vehicleTypes.id })
      .from(vehicleTypes)
      .where(eq(vehicleTypes.id, vehicleTypeId))
      .for("update");
    if (!vt) throw notFound("Vehicle type");

    const serviceIds = rows.map((r) => r.service_id);
    const found = await t
      .select({ id: services.id })
      .from(services)
      .where(inArray(services.id, serviceIds));
    if (found.length !== serviceIds.length) throw invalid("one or more service_ids do not exist.");

    for (const row of rows) {
      const values = {
        available: row.available,
        price: toNumeric(row.price),
        durationMinutes: row.duration_minutes,
      };
      await t
        .insert(vehicleTypeServices)
        .values({ vehicleTypeId, serviceId: row.service_id, ...values })
        .onConflictDoUpdate({
          target: [vehicleTypeServices.vehicleTypeId, vehicleTypeServices.serviceId],
          set: values,
        });
    }
  });
  return getAdminVehicleType(db, vehicleTypeId);
}
