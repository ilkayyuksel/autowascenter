// Gallery upload: validate the staged file, move it into storage, then create the row.
// Order matters: the row only ever points at a file that exists; if the insert fails the
// file is removed again (compensation), so no file without row is left behind on errors.

import { open } from "node:fs/promises";
import type { FastifyBaseLogger } from "fastify";
import type { GalleryUploadFields } from "../../contracts/admin-write.ts";
import type { Database } from "../../db/index.ts";
import { AppError } from "../../errors/app-error.ts";
import { detectImageType, SIGNATURE_BYTES, type ImageType } from "../../storage/image-types.ts";
import type { StagedFile, StorageProvider } from "../../storage/storage-provider.ts";
import { getAdminGalleryItem } from "./catalog.service.ts";
import { insertGalleryRow } from "./content-write.service.ts";

export const unsupportedImage = () =>
  new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Only JPEG, PNG and WebP images are allowed.");

async function readSignature(path: string) {
  const handle = await open(path, "r");
  try {
    const header = new Uint8Array(SIGNATURE_BYTES);
    const { bytesRead } = await handle.read(header, 0, SIGNATURE_BYTES, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export interface GalleryUploadInput {
  staged: StagedFile;
  /** Type from the part's Content-Type, already checked against the allowlist. */
  declaredType: ImageType;
  size: number;
  fields: GalleryUploadFields;
}

export async function storeGalleryUpload(
  db: Database,
  storage: StorageProvider,
  log: FastifyBaseLogger,
  { staged, declaredType, size, fields }: GalleryUploadInput,
) {
  if (size === 0) throw new AppError(400, "EMPTY_FILE", "The uploaded file is empty.");

  // The content decides, not the client: the signature must match the declared type.
  const detected = detectImageType(await readSignature(staged.path));
  if (!detected || detected.mime !== declaredType.mime) throw unsupportedImage();

  const stored = await storage.put({ area: "gallery", extension: detected.extension, staged });

  let id: string;
  try {
    id = await insertGalleryRow(db, {
      image_url: stored.publicUrl,
      title: fields.title,
      description: fields.description,
      sort_order: fields.sort_order,
    });
  } catch (err) {
    try {
      await storage.delete(stored.key);
    } catch (cleanupErr) {
      log.error(
        { err: cleanupErr, key: stored.key },
        "gallery upload cleanup failed (orphan left)",
      );
    }
    throw err;
  }

  log.info(
    { galleryItemId: id, key: stored.key, size: stored.size, mime: detected.mime },
    "gallery image uploaded",
  );
  return getAdminGalleryItem(db, id);
}
