import { availabilityQuerySchema, bookingRequestSchema } from "@autowascenter/shared";
import type { FastifyInstance } from "fastify";
import { parseOrThrow } from "../../lib/validate.ts";
import type { BookingRateLimit } from "../../plugins/rate-limit.ts";
import { getAvailability } from "../../services/availability.service.ts";
import { createBooking } from "../../services/booking.service.ts";

export interface BookingRoutesOptions {
  bookingRateLimit: BookingRateLimit;
}

/** Booking body is small; reject anything larger early. */
const BOOKING_BODY_LIMIT = 16 * 1024;

/**
 * GET  /api/availability  informative: free start times for a date and a selection.
 * POST /api/bookings      authoritative: re-validates everything inside one transaction.
 */
export async function bookingRoutes(app: FastifyInstance, opts: BookingRoutesOptions) {
  app.get("/availability", async (request) => {
    const q = parseOrThrow(availabilityQuerySchema, request.query);
    const data = await getAvailability(
      app.db,
      { date: q.date, vehicleTypeId: q.vehicle_type_id, serviceIds: q.service_ids },
      app.clock(),
    );
    return { data };
  });

  app.post(
    "/bookings",
    {
      bodyLimit: BOOKING_BODY_LIMIT,
      config: {
        rateLimit: {
          max: opts.bookingRateLimit.max,
          timeWindow: opts.bookingRateLimit.timeWindowMs,
        },
      },
    },
    async (request, reply) => {
      const body = parseOrThrow(bookingRequestSchema, request.body);
      const data = await createBooking(app.db, body, app.clock());
      return reply.code(201).send({ data });
    },
  );
}
