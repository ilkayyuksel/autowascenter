import type { FastifyInstance } from "fastify";
import { authenticate, requirePermission } from "../../auth/plugin.ts";
import { ADMIN_ACCESS } from "../../auth/principal.ts";
import { adminBookingWriteRoutes } from "./bookings-write.ts";
import { adminCatalogWriteRoutes } from "./catalog-write.ts";
import { adminContentWriteRoutes } from "./content-write.ts";
import { adminGalleryUploadRoutes, type GalleryUploadOptions } from "./gallery-upload.ts";
import { adminReadRoutes } from "./read.ts";

/**
 * Admin routes, mounted under /api/admin. The two hooks below apply to every route in this
 * plugin AND in the child plugins registered after them: a valid Auth0 access token (401
 * otherwise) with the `admin:access` permission (403 otherwise). Individual routes cannot
 * opt out, and no request parameter influences authorization.
 */
export interface AdminRoutesOptions {
  galleryUpload: GalleryUploadOptions;
}

export async function adminRoutes(app: FastifyInstance, opts: AdminRoutesOptions) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission(ADMIN_ACCESS));

  app.get("/me", async (request) => {
    const principal = request.principal!;
    // Only the subject and permissions: no token, no profile data, no other claims.
    return { data: { sub: principal.sub, permissions: principal.permissions } };
  });

  await app.register(adminReadRoutes);
  await app.register(adminBookingWriteRoutes);
  await app.register(adminCatalogWriteRoutes);
  await app.register(adminContentWriteRoutes);
  await app.register(adminGalleryUploadRoutes, opts.galleryUpload);
}
