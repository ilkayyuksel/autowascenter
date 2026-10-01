// Admin catalogue writes: services, package contents, vehicle types, pricing matrix (6B).
// Authorization: parent plugin (admin:access).

import type { FastifyInstance } from "fastify";
import { idParams } from "../../contracts/admin.ts";
import {
  packageContentPut,
  pricingMatrixPut,
  serviceCreate,
  servicePatch,
  vehicleTypeCreate,
  vehicleTypePatch,
} from "../../contracts/admin-write.ts";
import { parseOrThrow } from "../../lib/validate.ts";
import {
  createService,
  createVehicleType,
  deleteService,
  deleteVehicleType,
  replacePackageContent,
  savePricingMatrix,
  updateService,
  updateVehicleType,
} from "../../services/admin/catalog-write.service.ts";

export async function adminCatalogWriteRoutes(app: FastifyInstance) {
  app.post("/services", async (request, reply) => {
    const input = parseOrThrow(serviceCreate, request.body);
    return reply.code(201).send({ data: await createService(app.db, input) });
  });

  app.patch("/services/:id", async (request) => {
    const { id } = parseOrThrow(idParams, request.params);
    const patch = parseOrThrow(servicePatch, request.body);
    return { data: await updateService(app.db, id, patch) };
  });

  app.put("/services/:id/package-content", async (request) => {
    const { id } = parseOrThrow(idParams, request.params);
    const { service_ids } = parseOrThrow(packageContentPut, request.body);
    return { data: await replacePackageContent(app.db, id, service_ids) };
  });

  app.delete("/services/:id", async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    await deleteService(app.db, id);
    return reply.code(204).send();
  });

  app.post("/vehicle-types", async (request, reply) => {
    const input = parseOrThrow(vehicleTypeCreate, request.body ?? {});
    return reply.code(201).send({ data: await createVehicleType(app.db, input, app.clock()) });
  });

  app.patch("/vehicle-types/:id", async (request) => {
    const { id } = parseOrThrow(idParams, request.params);
    const patch = parseOrThrow(vehicleTypePatch, request.body);
    return { data: await updateVehicleType(app.db, id, patch) };
  });

  app.delete("/vehicle-types/:id", async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    await deleteVehicleType(app.db, id);
    return reply.code(204).send();
  });

  app.put("/vehicle-types/:id/pricing", async (request) => {
    const { id } = parseOrThrow(idParams, request.params);
    const { rows } = parseOrThrow(pricingMatrixPut, request.body);
    return { data: await savePricingMatrix(app.db, id, rows) };
  });
}
