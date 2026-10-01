import Fastify, { type FastifyServerOptions } from "fastify";
import { registerAuth } from "./auth/plugin.ts";
import type { TokenVerifier } from "./auth/verifier.ts";
import type { Config } from "./config/env.ts";
import type { Database } from "./db/index.ts";
import { registerErrorHandling } from "./errors/error-handler.ts";
import { registerClock } from "./plugins/clock.ts";
import { registerCors } from "./plugins/cors.ts";
import { registerDatabase } from "./plugins/db.ts";
import { registerRateLimit, type BookingRateLimit } from "./plugins/rate-limit.ts";
import { isLocalStorage, registerStorage, uploadsStaticRoutes } from "./plugins/storage.ts";
import { adminRoutes } from "./routes/admin/index.ts";
import { healthRoutes } from "./routes/health.ts";
import { bookingRoutes } from "./routes/public/bookings.ts";
import { publicRoutes } from "./routes/public/index.ts";
import type { StorageProvider } from "./storage/storage-provider.ts";

export interface AppOptions {
  db: Database;
  corsOrigins: Config["corsOrigins"];
  logLevel?: Config["logLevel"];
  bookingRateLimit?: BookingRateLimit;
  /**
   * Verifies Auth0 access tokens for /api/admin/*. null = Auth0 not configured: protected
   * routes then answer 503 (they are never left open). Tests inject a local-key verifier.
   */
  tokenVerifier?: TokenVerifier | null;
  /**
   * File storage for gallery uploads. null = not configured: uploads answer 503, deletes
   * remove rows only. A LocalStorageProvider is also served under /uploads/gallery/.
   */
  storage?: StorageProvider | null;
  uploads?: { maxBytes: number; rateLimit: { max: number; timeWindowMs: number } };
  /** Injectable clock for tests; defaults to the system clock. */
  clock?: () => Date;
  /** Test seam: where log lines go (defaults to stdout). */
  logStream?: NodeJS.WritableStream;
}

const DEFAULT_BOOKING_RATE_LIMIT: BookingRateLimit = { max: 10, timeWindowMs: 60_000 };
const DEFAULT_UPLOADS = { maxBytes: 10_485_760, rateLimit: { max: 30, timeWindowMs: 3_600_000 } };

/**
 * Builds the Fastify application without opening a port.
 * Tests use `app.inject()`; src/server.ts adds the pool and calls `listen()`.
 */
export async function createApp({
  db,
  corsOrigins,
  logLevel = "info",
  bookingRateLimit = DEFAULT_BOOKING_RATE_LIMIT,
  tokenVerifier = null,
  storage = null,
  uploads = DEFAULT_UPLOADS,
  clock,
  logStream,
}: AppOptions) {
  const logger: FastifyServerOptions["logger"] = {
    level: logLevel,
    // Never log credentials: bearer tokens and cookies are redacted if a serializer ever
    // includes headers (the default request serializer does not).
    redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
    ...(logStream ? { stream: logStream } : {}),
  };

  const app = Fastify({ logger });

  registerDatabase(app, db);
  registerClock(app, clock);
  registerAuth(app, tokenVerifier);
  registerStorage(app, storage);
  registerErrorHandling(app);
  await registerCors(app, corsOrigins);
  await registerRateLimit(app);

  await app.register(healthRoutes);
  // Public: no authentication, ever (customers have no accounts).
  await app.register(publicRoutes, { prefix: "/api" });
  await app.register(bookingRoutes, { prefix: "/api", bookingRateLimit });
  // Protected: valid Auth0 access token + admin:access permission.
  await app.register(adminRoutes, { prefix: "/api/admin", galleryUpload: uploads });
  // Public, read-only: uploaded gallery images.
  if (isLocalStorage(storage)) await app.register(uploadsStaticRoutes, storage);

  return app;
}
