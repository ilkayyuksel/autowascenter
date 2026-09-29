import Fastify, { type FastifyServerOptions } from "fastify";
import type { Config } from "./config/env.ts";
import type { Database } from "./db/index.ts";
import { registerErrorHandling } from "./errors/error-handler.ts";
import { registerCors } from "./plugins/cors.ts";
import { registerDatabase } from "./plugins/db.ts";
import { healthRoutes } from "./routes/health.ts";
import { publicRoutes } from "./routes/public/index.ts";

export interface AppOptions {
  db: Database;
  corsOrigins: Config["corsOrigins"];
  logLevel?: Config["logLevel"];
}

/**
 * Builds the Fastify application without opening a port.
 * Tests use `app.inject()`; src/server.ts adds the pool and calls `listen()`.
 */
export async function createApp({ db, corsOrigins, logLevel = "info" }: AppOptions) {
  const logger: FastifyServerOptions["logger"] = {
    level: logLevel,
    // Never log credentials, even if a future client sends them.
    redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
  };

  const app = Fastify({ logger });

  registerDatabase(app, db);
  registerErrorHandling(app);
  await registerCors(app, corsOrigins);

  await app.register(healthRoutes);
  await app.register(publicRoutes, { prefix: "/api" });

  return app;
}
