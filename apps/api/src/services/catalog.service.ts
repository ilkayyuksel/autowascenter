import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/index.ts";
import {
  packageServices,
  services,
  vehicleTypes,
  vehicleTypeServices,
} from "../db/schema/index.ts";
import type {
  PublicService,
  PublicVehicleType,
  VehicleTypeServiceOption,
} from "../contracts/public.ts";

/** numeric columns come back as strings from PostgreSQL; the contract uses numbers. */
const toNumber = (value: string) => Number(value);
const toNumberOrNull = (value: string | null) => (value === null ? null : Number(value));

/** Active services, ordered like the current frontend (sort_order); id as a stable tiebreak. */
export async function listPublicServices(
  db: Database,
  { limit }: { limit?: number } = {},
): Promise<PublicService[]> {
  const query = db
    .select({
      id: services.id,
      title: services.title,
      description: services.description,
      category: services.category,
      badge: services.badge,
      icon: services.icon,
      image_url: services.imageUrl,
      bookable: services.bookable,
      kind: services.kind,
      price: services.price,
      duration_minutes: services.durationMinutes,
    })
    .from(services)
    .where(eq(services.active, true))
    .orderBy(asc(services.sortOrder), asc(services.id));

  const rows = limit ? await query.limit(limit) : await query;
  return rows.map((row) => ({ ...row, price: toNumberOrNull(row.price) }));
}

/** Active vehicle types, ordered by sort_order. */
export async function listPublicVehicleTypes(db: Database): Promise<PublicVehicleType[]> {
  return db
    .select({
      id: vehicleTypes.id,
      slug: vehicleTypes.slug,
      title: vehicleTypes.title,
      description: vehicleTypes.description,
      image_url: vehicleTypes.imageUrl,
    })
    .from(vehicleTypes)
    .where(eq(vehicleTypes.active, true))
    .orderBy(asc(vehicleTypes.sortOrder), asc(vehicleTypes.id));
}

export async function isActiveVehicleType(db: Database, vehicleTypeId: string): Promise<boolean> {
  const rows = await db
    .select({ id: vehicleTypes.id })
    .from(vehicleTypes)
    .where(and(eq(vehicleTypes.id, vehicleTypeId), eq(vehicleTypes.active, true)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Bookable options for one vehicle type, as used by the booking flow (steps 2-3):
 * price/duration from vehicle_type_services, only where the combination is `available`
 * and the service is `active` and `bookable`. Same filters as routes/reservatie.tsx,
 * but applied in the database instead of the browser. Ordered by title.
 */
export async function listVehicleTypeServiceOptions(
  db: Database,
  vehicleTypeId: string,
): Promise<VehicleTypeServiceOption[]> {
  const rows = await db
    .select({
      id: vehicleTypeServices.id,
      service_id: vehicleTypeServices.serviceId,
      title: services.title,
      description: services.description,
      category: services.category,
      badge: services.badge,
      kind: services.kind,
      price: vehicleTypeServices.price,
      duration_minutes: vehicleTypeServices.durationMinutes,
    })
    .from(vehicleTypeServices)
    .innerJoin(services, eq(services.id, vehicleTypeServices.serviceId))
    .where(
      and(
        eq(vehicleTypeServices.vehicleTypeId, vehicleTypeId),
        eq(vehicleTypeServices.available, true),
        eq(services.active, true),
        eq(services.bookable, true),
      ),
    )
    .orderBy(asc(services.title), asc(vehicleTypeServices.id));

  const includes = await listPackageContents(
    db,
    rows.filter((r) => r.kind === "pakket").map((r) => r.service_id),
  );

  return rows.map((row) => ({
    ...row,
    price: toNumber(row.price),
    includes: includes.get(row.service_id) ?? [],
  }));
}

/**
 * Titles of the active services contained in each package. Display only; mirrors the
 * current frontend, which only sees active services through Supabase RLS.
 */
async function listPackageContents(
  db: Database,
  packageIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (packageIds.length === 0) return result;

  const rows = await db
    .select({ packageId: packageServices.packageId, title: services.title })
    .from(packageServices)
    .innerJoin(services, eq(services.id, packageServices.serviceId))
    .where(and(inArray(packageServices.packageId, packageIds), eq(services.active, true)))
    .orderBy(asc(services.sortOrder), asc(services.title));

  for (const { packageId, title } of rows) {
    const titles = result.get(packageId) ?? [];
    titles.push(title);
    result.set(packageId, titles);
  }
  return result;
}
