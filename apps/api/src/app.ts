import Fastify, { type FastifyServerOptions } from "fastify";
import type { Config } from "./config/env.ts";
import type { Database } from "./db/index.ts";
import { registerErrorHandling } from "./errors/error-handler.ts";
import { registerClock } from "./plugins/clock.ts";
import { registerCors } from "./plugins/cors.ts";
import { registerDatabase } from "./plugins/db.ts";
import { registerRateLimit, type BookingRateLimit } from "./plugins/rate-limit.ts";
import { healthRoutes } from "./routes/health.ts";
import { bookingRoutes } from "./routes/public/bookings.ts";
import { publicRoutes } from "./routes/public/index.ts";

export interface AppOptions {
  db: Database;
  corsOrigins: Config["corsOrigins"];
  logLevel?: Config["logLevel"];
  bookingRateLimit?: BookingRateLimit;
  /** Injectable clock for tests; defaults to the system clock. */
  clock?: () => Date;
}

const DEFAULT_BOOKING_RATE_LIMIT: BookingRateLimit = { max: 10, timeWindowMs: 60_000 };

/**
 * Builds the Fastify application without opening a port.
 * Tests use `app.inject()`; src/server.ts adds the pool and calls `listen()`.
 */
export async function createApp({
  db,
  corsOrigins,
  logLevel = "info",
  bookingRateLimit = DEFAULT_BOOKING_RATE_LIMIT,
  clock,
}: AppOptions) {
  const logger: FastifyServerOptions["logger"] = {
    level: logLevel,
    // Never log credentials, even if a future client sends them.
    redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
  };

  const app = Fastify({ logger });

  registerDatabase(app, db);
  registerClock(app, clock);
  registerErrorHandling(app);
  await registerCors(app, corsOrigins);
  await registerRateLimit(app);

  await app.register(healthRoutes);
  await app.register(publicRoutes, { prefix: "/api" });
  await app.register(bookingRoutes, { prefix: "/api", bookingRateLimit });

  return app;
}
