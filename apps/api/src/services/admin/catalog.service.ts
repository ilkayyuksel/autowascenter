// Admin read access to the catalogue (services incl. packages, vehicle types with their
// pricing matrix), gallery, blocked periods and settings. All rows, inactive included.

import { asc, desc, eq, gte, lte, and } from "drizzle-orm";
import type { Database } from "../../db/index.ts";
import {
  blockedPeriods,
  galleryItems,
  packageServices,
  services,
  siteSettings,
  vehicleTypes,
  vehicleTypeServices,
} from "../../db/schema/index.ts";
import type {
  AdminBlockedPeriod,
  AdminGalleryItem,
  AdminService,
  AdminSettings,
  AdminVehicleType,
} from "../../contracts/admin.ts";
import { AppError } from "../../errors/app-error.ts";
import { hhmm, hhmmOrNull, iso, money, moneyOrNull } from "./mappers.ts";

/** All services (dienst/pakket/extra), by sort_order; packages carry their contents. */
export async function listAdminServices(db: Database): Promise<AdminService[]> {
  const [rows, contents] = await Promise.all([
    db
      .select({
        id: services.id,
        title: services.title,
        description: services.description,
        kind: services.kind,
        category: services.category,
        badge: services.badge,
        icon: services.icon,
        imageUrl: services.imageUrl,
        bookable: services.bookable,
        active: services.active,
        sortOrder: services.sortOrder,
        price: services.price,
        durationMinutes: services.durationMinutes,
        createdAt: services.createdAt,
        updatedAt: services.updatedAt,
      })
      .from(services)
      .orderBy(asc(services.sortOrder), asc(services.id)),
    db
      .select({ packageId: packageServices.packageId, serviceId: packageServices.serviceId })
      .from(packageServices)
      .orderBy(asc(packageServices.packageId), asc(packageServices.serviceId)),
  ]);

  const included = new Map<string, string[]>();
  for (const { packageId, serviceId } of contents) {
    included.set(packageId, [...(included.get(packageId) ?? []), serviceId]);
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    kind: r.kind,
    category: r.category,
    badge: r.badge,
    icon: r.icon,
    image_url: r.imageUrl,
    bookable: r.bookable,
    active: r.active,
    sort_order: r.sortOrder,
    price: moneyOrNull(r.price),
    duration_minutes: r.durationMinutes,
    included_service_ids: included.get(r.id) ?? [],
    created_at: iso(r.createdAt),
    updated_at: iso(r.updatedAt),
  }));
}

/** All vehicle types with their full pricing matrix (vehicle_type_services + service info). */
export async function listAdminVehicleTypes(db: Database): Promise<AdminVehicleType[]> {
  const [types, matrix] = await Promise.all([
    db
      .select({
        id: vehicleTypes.id,
        slug: vehicleTypes.slug,
        title: vehicleTypes.title,
        description: vehicleTypes.description,
        imageUrl: vehicleTypes.imageUrl,
        icon: vehicleTypes.icon,
        sortOrder: vehicleTypes.sortOrder,
        active: vehicleTypes.active,
        createdAt: vehicleTypes.createdAt,
        updatedAt: vehicleTypes.updatedAt,
      })
      .from(vehicleTypes)
      .orderBy(asc(vehicleTypes.sortOrder), asc(vehicleTypes.id)),
    db
      .select({
        id: vehicleTypeServices.id,
        vehicleTypeId: vehicleTypeServices.vehicleTypeId,
        serviceId: vehicleTypeServices.serviceId,
        title: services.title,
        kind: services.kind,
        serviceActive: services.active,
        serviceBookable: services.bookable,
        available: vehicleTypeServices.available,
        price: vehicleTypeServices.price,
        durationMinutes: vehicleTypeServices.durationMinutes,
      })
      .from(vehicleTypeServices)
      .innerJoin(services, eq(services.id, vehicleTypeServices.serviceId))
      .orderBy(asc(services.title), asc(vehicleTypeServices.id)),
  ]);

  const rowsByType = new Map<string, AdminVehicleType["services"]>();
  for (const m of matrix) {
    const list = rowsByType.get(m.vehicleTypeId) ?? [];
    list.push({
      id: m.id,
      service_id: m.serviceId,
      title: m.title,
      kind: m.kind,
      service_active: m.serviceActive,
      service_bookable: m.serviceBookable,
      available: m.available,
      price: money(m.price),
      duration_minutes: m.durationMinutes,
    });
    rowsByType.set(m.vehicleTypeId, list);
  }

  return types.map((t) => ({
    id: t.id,
    slug: t.slug,
    title: t.title,
    description: t.description,
    image_url: t.imageUrl,
    icon: t.icon,
    sort_order: t.sortOrder,
    active: t.active,
    created_at: iso(t.createdAt),
    updated_at: iso(t.updatedAt),
    services: rowsByType.get(t.id) ?? [],
  }));
}

export async function listAdminGallery(db: Database): Promise<AdminGalleryItem[]> {
  const rows = await db
    .select({
      id: galleryItems.id,
      title: galleryItems.title,
      description: galleryItems.description,
      imageUrl: galleryItems.imageUrl,
      beforeImageUrl: galleryItems.beforeImageUrl,
      category: galleryItems.category,
      sortOrder: galleryItems.sortOrder,
      createdAt: galleryItems.createdAt,
      updatedAt: galleryItems.updatedAt,
    })
    .from(galleryItems)
    .orderBy(asc(galleryItems.sortOrder), asc(galleryItems.id));
  return rows.map((g) => ({
    id: g.id,
    title: g.title,
    description: g.description,
    image_url: g.imageUrl,
    before_image_url: g.beforeImageUrl,
    category: g.category,
    sort_order: g.sortOrder,
    created_at: iso(g.createdAt),
    updated_at: iso(g.updatedAt),
  }));
}

function selectBlocked(db: Database) {
  return db
    .select({
      id: blockedPeriods.id,
      startDate: blockedPeriods.startDate,
      endDate: blockedPeriods.endDate,
      startTime: blockedPeriods.startTime,
      endTime: blockedPeriods.endTime,
      reason: blockedPeriods.reason,
      createdAt: blockedPeriods.createdAt,
      updatedAt: blockedPeriods.updatedAt,
    })
    .from(blockedPeriods);
}

type BlockedRow = Awaited<ReturnType<typeof selectBlocked>>[number];

function toAdminBlocked(b: BlockedRow): AdminBlockedPeriod {
  return {
    id: b.id,
    start_date: b.startDate,
    end_date: b.endDate,
    start_time: hhmmOrNull(b.startTime),
    end_time: hhmmOrNull(b.endTime),
    reason: b.reason,
    created_at: iso(b.createdAt),
    updated_at: iso(b.updatedAt),
  };
}

/** All blocked periods, latest start first (admin/blokkades.tsx order). */
export async function listAdminBlockedPeriods(db: Database): Promise<AdminBlockedPeriod[]> {
  const rows = await selectBlocked(db).orderBy(
    desc(blockedPeriods.startDate),
    desc(blockedPeriods.id),
  );
  return rows.map(toAdminBlocked);
}

/** Blocked periods overlapping the inclusive local date range (SQL `date` comparison). */
export async function listBlockedPeriodsBetween(
  db: Database,
  start: string,
  end: string,
): Promise<AdminBlockedPeriod[]> {
  const rows = await selectBlocked(db)
    .where(and(lte(blockedPeriods.startDate, end), gte(blockedPeriods.endDate, start)))
    .orderBy(asc(blockedPeriods.startDate), asc(blockedPeriods.id));
  return rows.map(toAdminBlocked);
}

/**
 * The single site_settings row. A missing row is a server-side configuration error: no
 * defaults are invented here (unlike the public availability fallback, which is documented).
 */
export async function getAdminSettings(db: Database): Promise<AdminSettings> {
  const [s] = await db
    .select({
      id: siteSettings.id,
      openingHour: siteSettings.openingHour,
      closingHour: siteSettings.closingHour,
      slotIntervalMinutes: siteSettings.slotIntervalMinutes,
      kmFee: siteSettings.kmFee,
      freeKm: siteSettings.freeKm,
      baseAddress: siteSettings.baseAddress,
      baseCity: siteSettings.baseCity,
      notificationEmail: siteSettings.notificationEmail,
      createdAt: siteSettings.createdAt,
      updatedAt: siteSettings.updatedAt,
    })
    .from(siteSettings)
    .limit(1);
  if (!s) {
    throw new AppError(500, "SETTINGS_NOT_CONFIGURED", "Site settings are not configured.");
  }
  return {
    id: s.id,
    opening_hour: hhmm(s.openingHour),
    closing_hour: hhmm(s.closingHour),
    slot_interval_minutes: s.slotIntervalMinutes,
    km_fee: money(s.kmFee),
    free_km: money(s.freeKm),
    base_address: s.baseAddress,
    base_city: s.baseCity,
    notification_email: s.notificationEmail,
    created_at: iso(s.createdAt),
    updated_at: iso(s.updatedAt),
  };
}
