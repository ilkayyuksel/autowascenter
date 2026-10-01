// POST /api/admin/gallery/upload (multipart/form-data): one image in field "file" plus the
// optional text fields title, description, sort_order. Authorization: parent plugin
// (admin:access). The multipart parser is registered in this plugin only, so no other
// admin route accepts multipart bodies.

import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { galleryUploadFields } from "../../contracts/admin-write.ts";
import { AppError } from "../../errors/app-error.ts";
import { parseOrThrow } from "../../lib/validate.ts";
import {
  storeGalleryUpload,
  unsupportedImage,
} from "../../services/admin/gallery-upload.service.ts";
import { imageTypeForMime, type ImageType } from "../../storage/image-types.ts";
import type { StagedFile } from "../../storage/storage-provider.ts";

export interface GalleryUploadOptions {
  maxBytes: number;
  rateLimit: { max: number; timeWindowMs: number };
}

const FILE_FIELD = "file";
const TEXT_FIELDS = new Set(["title", "description", "sort_order"]);
/** Enough for a 2000-character description in multi-byte UTF-8. */
const MAX_FIELD_BYTES = 16 * 1024;

const fileTooLarge = (maxBytes: number) =>
  new AppError(413, "FILE_TOO_LARGE", `The file exceeds the limit of ${maxBytes} bytes.`);
const malformed = () =>
  new AppError(400, "MALFORMED_MULTIPART", "The multipart body is malformed.");
const badRequest = (message: string) => new AppError(400, "VALIDATION_ERROR", message);

/** Parser/limit errors of @fastify/multipart and busboy → stable client errors. */
function translateMultipartError(err: unknown, maxBytes: number): unknown {
  if (err instanceof AppError) return err;
  const code = (err as { code?: unknown }).code;
  switch (code) {
    case "FST_REQ_FILE_TOO_LARGE":
      return fileTooLarge(maxBytes);
    case "FST_FILES_LIMIT":
      return badRequest("Invalid request: exactly one file is allowed.");
    case "FST_FIELDS_LIMIT":
    case "FST_PARTS_LIMIT":
    case "FST_PROTO_VIOLATION":
      return badRequest("Invalid request: unexpected form fields.");
    case "FST_MP_PREMATURE_CLOSE":
      return new AppError(400, "MALFORMED_MULTIPART", "The upload was interrupted.");
  }
  // busboy reports malformed bodies as plain errors without a code; filesystem errors
  // (ENOSPC, EACCES, ...) keep their errno code and stay server errors.
  if (code === undefined) return malformed();
  return err;
}

export async function adminGalleryUploadRoutes(app: FastifyInstance, opts: GalleryUploadOptions) {
  await app.register(multipart, {
    limits: {
      fileSize: opts.maxBytes,
      files: 1,
      fields: TEXT_FIELDS.size,
      parts: TEXT_FIELDS.size + 1,
      fieldSize: MAX_FIELD_BYTES,
      fieldNameSize: 100,
      headerPairs: 20,
    },
    throwFileSizeLimit: true,
  });

  app.post(
    "/gallery/upload",
    {
      config: {
        rateLimit: { max: opts.rateLimit.max, timeWindow: opts.rateLimit.timeWindowMs },
      },
    },
    async (request, reply) => {
      const storage = app.storage;
      if (!storage) {
        throw new AppError(503, "STORAGE_UNAVAILABLE", "File storage is not configured.");
      }
      if (!request.isMultipart()) {
        throw new AppError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Expected a multipart/form-data request.",
        );
      }

      const fields: Record<string, string> = {};
      let staged: StagedFile | undefined;
      let declaredType: ImageType | undefined;
      let size = 0;
      try {
        try {
          for await (const part of request.parts()) {
            if (part.type === "field") {
              if (!TEXT_FIELDS.has(part.fieldname) || part.fieldname in fields) {
                throw badRequest(`Invalid request: unexpected field "${part.fieldname}".`);
              }
              if (part.valueTruncated || typeof part.value !== "string") {
                throw badRequest(`Invalid request: field "${part.fieldname}" is too long.`);
              }
              fields[part.fieldname] = part.value;
              continue;
            }
            if (part.fieldname !== FILE_FIELD) {
              part.file.resume();
              throw badRequest(`Invalid request: the image must be sent in field "${FILE_FIELD}".`);
            }
            // Cheap early rejection; the content signature is checked after staging.
            declaredType = imageTypeForMime(part.mimetype);
            if (!declaredType) {
              part.file.resume();
              throw unsupportedImage();
            }
            // The client's file name is ignored entirely (never used, never logged).
            staged = await storage.createStagingFile();
            // A truncated/aborted body can make the plugin destroy the stream while we
            // awaited; pipeline() on an already-closed stream would never settle.
            if (part.file.destroyed) throw malformed();
            const out = createWriteStream(staged.path, { flags: "wx", mode: 0o600 });
            part.file.on("data", (chunk: Buffer) => (size += chunk.length));
            await pipeline(part.file, out);
            if (part.file.truncated) throw fileTooLarge(opts.maxBytes);
          }
        } catch (err) {
          throw translateMultipartError(err, opts.maxBytes);
        }
        if (!staged || !declaredType) {
          throw badRequest(`Invalid request: field "${FILE_FIELD}" with an image is required.`);
        }

        const data = await storeGalleryUpload(app.db, storage, request.log, {
          staged,
          declaredType,
          size,
          fields: parseOrThrow(galleryUploadFields, fields),
        });
        return reply.code(201).send({ data });
      } finally {
        // Removes the staging file on every failure path (no-op after a successful move).
        await staged
          ?.discard()
          .catch((err: unknown) => request.log.error({ err }, "could not remove staged upload"));
      }
    },
  );
}
