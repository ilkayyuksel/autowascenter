// Admin booking writes (phase 6B). Authorization: parent plugin (admin:access).

import type { FastifyInstance } from "fastify";
import { idParams } from "../../contracts/admin.ts";
import {
  adminAvailabilityQuery,
  adminBookingCreate,
  adminBookingPatch,
} from "../../contracts/admin-write.ts";
import { parseOrThrow } from "../../lib/validate.ts";
import {
  createAdminBooking,
  deleteAdminBooking,
  getAdminAvailability,
  updateAdminBooking,
} from "../../services/admin/bookings-write.service.ts";

export async function adminBookingWriteRoutes(app: FastifyInstance) {
  app.post("/bookings", async (request, reply) => {
    const input = parseOrThrow(adminBookingCreate, request.body);
    const data = await createAdminBooking(app.db, input, app.clock());
    return reply.code(201).send({ data });
  });

  app.patch("/bookings/:id", async (request) => {
    const { id } = parseOrThrow(idParams, request.params);
    const patch = parseOrThrow(adminBookingPatch, request.body);
    return { data: await updateAdminBooking(app.db, id, patch, app.clock()) };
  });

  app.delete("/bookings/:id", async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    await deleteAdminBooking(app.db, id);
    return reply.code(204).send();
  });

  app.get("/availability", async (request) => {
    const q = parseOrThrow(adminAvailabilityQuery, request.query);
    const data = await getAdminAvailability(
      app.db,
      {
        date: q.date,
        excludeBookingId: q.exclude_booking_id,
        vehicleTypeId: q.vehicle_type_id,
        serviceIds: q.service_ids,
      },
      app.clock(),
    );
    return { data };
  });
}
