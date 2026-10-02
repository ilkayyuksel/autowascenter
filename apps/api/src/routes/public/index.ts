import type { FastifyInstance } from "fastify";
import { limitQuery, vehicleTypeParams } from "../../contracts/public.ts";
import { notFound } from "../../errors/app-error.ts";
import {
  isActiveVehicleType,
  listPublicServices,
  listPublicVehicleTypes,
  listVehicleTypeServiceOptions,
} from "../../services/catalog.service.ts";
import { listPublicGallery } from "../../services/gallery.service.ts";
import { listPublicReviews } from "../../services/reviews.service.ts";
import { getPublicSiteSettings } from "../../services/site-settings.service.ts";

/**
 * Public, unauthenticated read endpoints, mounted under /api.
 * Flow: route → Zod validation (throws → 400) → service → database → `{ data }`.
 */
export async function publicRoutes(app: FastifyInstance) {
  app.get("/services", async (request) => {
    const { limit } = limitQuery.parse(request.query);
    return { data: await listPublicServices(app.db, { limit }) };
  });

  app.get("/gallery", async (request) => {
    const { limit } = limitQuery.parse(request.query);
    return { data: await listPublicGallery(app.db, { limit }) };
  });

  app.get("/reviews", async (request) => {
    const { limit } = limitQuery.parse(request.query);
    return { data: await listPublicReviews(app.db, { limit }) };
  });

  app.get("/vehicle-types", async () => ({ data: await listPublicVehicleTypes(app.db) }));

  // Only the public booking page's on-location fee information (km_fee, free_km).
  app.get("/site-settings", async () => ({ data: await getPublicSiteSettings(app.db) }));

  app.get("/vehicle-types/:vehicleTypeId/services", async (request) => {
    const { vehicleTypeId } = vehicleTypeParams.parse(request.params);
    if (!(await isActiveVehicleType(app.db, vehicleTypeId))) {
      throw notFound("VEHICLE_TYPE_NOT_FOUND", "Vehicle type not found.");
    }
    return { data: await listVehicleTypeServiceOptions(app.db, vehicleTypeId) };
  });
}
