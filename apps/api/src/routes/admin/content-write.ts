// Admin writes for blocked periods, settings and gallery metadata (6B). Uploads: gallery-upload.ts.
// Authorization: parent plugin (admin:access).

import type { FastifyInstance } from "fastify";
import { idParams } from "../../contracts/admin.ts";
import {
  blockedPeriodCreate,
  galleryCreate,
  galleryPatch,
  settingsPatch,
} from "../../contracts/admin-write.ts";
import { parseOrThrow } from "../../lib/validate.ts";
import {
  createBlockedPeriod,
  createGalleryItem,
  deleteBlockedPeriod,
  deleteGalleryItem,
  updateGalleryItem,
  updateSettings,
} from "../../services/admin/content-write.service.ts";

export async function adminContentWriteRoutes(app: FastifyInstance) {
  app.post("/blocked-periods", async (request, reply) => {
    const input = parseOrThrow(blockedPeriodCreate, request.body);
    return reply.code(201).send({ data: await createBlockedPeriod(app.db, input) });
  });

  app.delete("/blocked-periods/:id", async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    await deleteBlockedPeriod(app.db, id);
    return reply.code(204).send();
  });

  app.patch("/settings", async (request) => {
    const patch = parseOrThrow(settingsPatch, request.body);
    return { data: await updateSettings(app.db, patch) };
  });

  app.post("/gallery", async (request, reply) => {
    const input = parseOrThrow(galleryCreate, request.body);
    return reply.code(201).send({ data: await createGalleryItem(app.db, input) });
  });

  app.patch("/gallery/:id", async (request) => {
    const { id } = parseOrThrow(idParams, request.params);
    const patch = parseOrThrow(galleryPatch, request.body);
    return { data: await updateGalleryItem(app.db, id, patch) };
  });

  app.delete("/gallery/:id", async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    await deleteGalleryItem(app.db, id, app.storage, request.log);
    return reply.code(204).send();
  });
}
