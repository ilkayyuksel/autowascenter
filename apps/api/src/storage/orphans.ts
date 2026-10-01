// Read-only consistency report between stored gallery files and database references.
// It never deletes anything: a future cleanup must be an explicit, reviewed action
// (see docs/GALLERY-STORAGE-MIGRATION.md "Orphan files").

import type { Database } from "../db/index.ts";
import { galleryItems, services, vehicleTypes } from "../db/schema/index.ts";
import type { StorageProvider } from "./storage-provider.ts";

export interface OrphanReport {
  /** Stored files no row refers to (e.g. a failed compensation or a failed file delete). */
  orphanFiles: string[];
  /** Managed URLs in the database whose file does not exist. */
  missingFiles: { table: string; id: string; key: string }[];
  /** Image URLs not managed by this storage (old Supabase URLs, external links). */
  externalReferences: number;
}

export async function findOrphanUploads(
  db: Database,
  storage: StorageProvider,
): Promise<OrphanReport> {
  const stored = new Set(await storage.list("gallery"));
  const [gallery, serviceRows, vehicleRows] = await Promise.all([
    db
      .select({ id: galleryItems.id, a: galleryItems.imageUrl, b: galleryItems.beforeImageUrl })
      .from(galleryItems),
    db.select({ id: services.id, a: services.imageUrl }).from(services),
    db.select({ id: vehicleTypes.id, a: vehicleTypes.imageUrl }).from(vehicleTypes),
  ]);
  const references: { table: string; id: string; url: string }[] = [
    ...gallery.flatMap((r) => [r.a, r.b].map((url) => ({ table: "gallery_items", id: r.id, url }))),
    ...serviceRows.map((r) => ({ table: "services", id: r.id, url: r.a })),
    ...vehicleRows.map((r) => ({ table: "vehicle_types", id: r.id, url: r.a })),
  ].filter((r): r is { table: string; id: string; url: string } => !!r.url);

  const referenced = new Set<string>();
  const missingFiles: OrphanReport["missingFiles"] = [];
  let externalReferences = 0;
  for (const { table, id, url } of references) {
    const key = storage.keyFromPublicUrl(url);
    if (!key) {
      externalReferences++;
      continue;
    }
    referenced.add(key);
    if (!stored.has(key)) missingFiles.push({ table, id, key });
  }

  return {
    orphanFiles: [...stored].filter((key) => !referenced.has(key)).sort(),
    missingFiles,
    externalReferences,
  };
}
