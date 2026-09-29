// Admin READ endpoints (phase 6A). Authorization is enforced by the parent plugin
// (routes/admin/index.ts). Flow: route → Zod validation → service → Drizzle → response.

import type { FastifyInstance } from "fastify";
import { agendaQuery, idParams, noQuery, paginationQuery } from "../../contracts/admin.ts";
import { addDays, fromLocal } from "../../lib/business-time.ts";
import { parseOrThrow } from "../../lib/validate.ts";
import {
  getAdminBooking,
  listAdminBookings,
  listBookingsOverlapping,
} from "../../services/admin/bookings.service.ts";
import {
  getAdminSettings,
  listAdminBlockedPeriods,
  listAdminGallery,
  listAdminServices,
  listAdminVehicleTypes,
  listBlockedPeriodsBetween,
} from "../../services/admin/catalog.service.ts";
import { getDashboard } from "../../services/admin/dashboard.service.ts";

export async function adminReadRoutes(app: FastifyInstance) {
  app.get("/dashboard", async (request) => {
    parseOrThrow(noQuery, request.query);
    return { data: await getDashboard(app.db, app.clock()) };
  });

  app.get("/bookings", async (request) => {
    const { page, limit } = parseOrThrow(paginationQuery, request.query);
    return listAdminBookings(app.db, { page, limit });
  });

  app.get("/bookings/:id", async (request) => {
    const { id } = parseOrThrow(idParams, request.params);
    parseOrThrow(noQuery, request.query);
    return { data: await getAdminBooking(app.db, id) };
  });

  app.get("/agenda", async (request) => {
    const { start, end } = parseOrThrow(agendaQuery, request.query);
    // Local days [start 00:00, end+1 00:00) in Europe/Brussels; midnight always exists there.
    const from = fromLocal(start, 0)!;
    const to = fromLocal(addDays(end, 1), 0)!;
    const [bookings, blocked] = await Promise.all([
      listBookingsOverlapping(app.db, from, to),
      listBlockedPeriodsBetween(app.db, start, end),
    ]);
    return { data: { start, end, bookings, blocked_periods: blocked } };
  });

  app.get("/services", async (request) => {
    parseOrThrow(noQuery, request.query);
    const data = await listAdminServices(app.db);
    return { data, meta: { total: data.length } };
  });

  app.get("/vehicle-types", async (request) => {
    parseOrThrow(noQuery, request.query);
    const data = await listAdminVehicleTypes(app.db);
    return { data, meta: { total: data.length } };
  });

  app.get("/blocked-periods", async (request) => {
    parseOrThrow(noQuery, request.query);
    const data = await listAdminBlockedPeriods(app.db);
    return { data, meta: { total: data.length } };
  });

  app.get("/settings", async (request) => {
    parseOrThrow(noQuery, request.query);
    return { data: await getAdminSettings(app.db) };
  });

  app.get("/gallery", async (request) => {
    parseOrThrow(noQuery, request.query);
    const data = await listAdminGallery(app.db);
    return { data, meta: { total: data.length } };
  });
}
