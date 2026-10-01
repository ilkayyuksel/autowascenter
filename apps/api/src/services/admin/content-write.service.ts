// Admin mutations for blocked periods, site settings and gallery items (+ managed files).

import { count, eq, or } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type {
  BlockedPeriodCreate,
  GalleryCreate,
  GalleryPatch,
  SettingsPatch,
} from "../../contracts/admin-write.ts";
import type { Database } from "../../db/index.ts";
import {
  blockedPeriods,
  galleryItems,
  services,
  siteSettings,
  vehicleTypes,
} from "../../db/schema/index.ts";
import { AppError } from "../../errors/app-error.ts";
import type { StorageProvider } from "../../storage/storage-provider.ts";
import { getAdminBlockedPeriod, getAdminGalleryItem, getAdminSettings } from "./catalog.service.ts";
import { hhmm } from "./mappers.ts";

const notFound = (what: string) => new AppError(404, "RESOURCE_NOT_FOUND", `${what} not found.`);

// ---------- Blocked periods (create + delete: the UI has no edit) ----------

export async function createBlockedPeriod(db: Database, input: BlockedPeriodCreate) {
  const [row] = await db
    .insert(blockedPeriods)
    .values({
      startDate: input.start_date,
      endDate: input.end_date,
      // NULL keeps today's meaning: from 00:00 / until 24:00.
      startTime: input.start_time ?? null,
      endTime: input.end_time ?? null,
      reason: input.reason ?? null,
    })
    .returning({ id: blockedPeriods.id });
  return getAdminBlockedPeriod(db, row!.id);
}

export async function deleteBlockedPeriod(db: Database, id: string) {
  const [row] = await db
    .delete(blockedPeriods)
    .where(eq(blockedPeriods.id, id))
    .returning({ id: blockedPeriods.id });
  if (!row) throw notFound("Blocked period");
}

// ---------- Settings (the single row, updated in place) ----------

/**
 * PATCH /api/admin/settings. Locks the one row, merges the patch, validates the resulting
 * opening window, and updates in place (never delete + insert). No row → 500.
 */
export async function updateSettings(db: Database, patch: SettingsPatch) {
  await db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    const [current] = await t
      .select({
        id: siteSettings.id,
        openingHour: siteSettings.openingHour,
        closingHour: siteSettings.closingHour,
      })
      .from(siteSettings)
      .limit(1)
      .for("update");
    if (!current) {
      throw new AppError(500, "SETTINGS_NOT_CONFIGURED", "Site settings are not configured.");
    }
    const opening = patch.opening_hour ?? hhmm(current.openingHour);
    const closing = patch.closing_hour ?? hhmm(current.closingHour);
    if (!(opening < closing)) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "Invalid request: opening_hour must be before closing_hour.",
      );
    }

    const set = Object.fromEntries(
      Object.entries({
        kmFee: patch.km_fee?.toFixed(2),
        freeKm: patch.free_km?.toFixed(2),
        baseAddress: patch.base_address,
        baseCity: patch.base_city,
        openingHour: patch.opening_hour,
        closingHour: patch.closing_hour,
        slotIntervalMinutes: patch.slot_interval_minutes,
        notificationEmail: patch.notification_email,
      }).filter(([, v]) => v !== undefined),
    );
    await t.update(siteSettings).set(set).where(eq(siteSettings.id, current.id));
  });
  return getAdminSettings(db);
}

// ---------- Gallery ----------

/** Inserts a gallery row and returns its id (also used by the upload flow). */
export async function insertGalleryRow(db: Database, input: GalleryCreate) {
  const sortOrder =
    input.sort_order ??
    // galerij.tsx: sort_order = items.length
    (await db.select({ total: count() }).from(galleryItems))[0]?.total ??
    0;
  const [row] = await db
    .insert(galleryItems)
    .values({
      imageUrl: input.image_url,
      title: input.title ?? null,
      description: input.description ?? null,
      sortOrder,
    })
    .returning({ id: galleryItems.id });
  return row!.id;
}

export async function createGalleryItem(db: Database, input: GalleryCreate) {
  return getAdminGalleryItem(db, await insertGalleryRow(db, input));
}

export async function updateGalleryItem(db: Database, id: string, patch: GalleryPatch) {
  const set = Object.fromEntries(
    Object.entries({
      title: patch.title,
      description: patch.description,
      sortOrder: patch.sort_order,
    }).filter(([, v]) => v !== undefined),
  );
  const [row] = await db
    .update(galleryItems)
    .set(set)
    .where(eq(galleryItems.id, id))
    .returning({ id: galleryItems.id });
  if (!row) throw notFound("Gallery item");
  return getAdminGalleryItem(db, id);
}

/** Number of rows (gallery, services, vehicle types) that still point at `url`. */
async function countImageReferences(db: Database, url: string) {
  const [gallery, service, vehicle] = await Promise.all([
    db
      .select({ n: count() })
      .from(galleryItems)
      .where(or(eq(galleryItems.imageUrl, url), eq(galleryItems.beforeImageUrl, url))),
    db.select({ n: count() }).from(services).where(eq(services.imageUrl, url)),
    db.select({ n: count() }).from(vehicleTypes).where(eq(vehicleTypes.imageUrl, url)),
  ]);
  return (gallery[0]?.n ?? 0) + (service[0]?.n ?? 0) + (vehicle[0]?.n ?? 0);
}

/**
 * Deletes the row, then the files it referenced, but only files this API's storage manages
 * (ownership check via `storage.keyFromPublicUrl`). External URLs, e.g. old Supabase
 * Storage files, are never touched. A file still referenced by another row is kept. File
 * problems after the committed row delete are logged, never turned into an error response:
 * at worst a file stays behind as an orphan (see npm run storage:orphans).
 */
export async function deleteGalleryItem(
  db: Database,
  id: string,
  storage: StorageProvider | null,
  log: FastifyBaseLogger,
) {
  const [row] = await db
    .delete(galleryItems)
    .where(eq(galleryItems.id, id))
    .returning({ imageUrl: galleryItems.imageUrl, beforeImageUrl: galleryItems.beforeImageUrl });
  if (!row) throw notFound("Gallery item");

  const urls = new Set([row.imageUrl, row.beforeImageUrl].filter((u): u is string => !!u));
  for (const url of urls) {
    const key = storage?.keyFromPublicUrl(url) ?? null;
    if (!storage || !key) continue; // not a managed file: nothing to delete
    try {
      if ((await countImageReferences(db, url)) > 0) {
        log.info({ galleryItemId: id, key }, "gallery file kept: still referenced");
        continue;
      }
      const result = await storage.delete(key);
      if (result === "missing") {
        log.warn({ galleryItemId: id, key }, "gallery file already missing");
      } else {
        log.info({ galleryItemId: id, key }, "gallery file deleted");
      }
    } catch (err) {
      log.error({ err, galleryItemId: id, key }, "gallery file delete failed (orphan left)");
    }
  }
}
