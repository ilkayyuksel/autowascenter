import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { createAuth0Verifier } from "./auth/verifier.ts";
import { loadConfig, type Config } from "./config/env.ts";
import { createDb } from "./db/index.ts";
import { LocalStorageProvider } from "./storage/local-storage-provider.ts";

/**
 * Starts the API: one connection pool per process, HTTP listener, graceful shutdown.
 * The pool is closed through Fastify's onClose hook, after in-flight requests finish.
 */
export async function startServer(config: Config = loadConfig()) {
  const { db, pool } = createDb(config.databaseUrl);
  const storage = await LocalStorageProvider.create({
    rootDir: config.uploads.dir,
    publicBaseUrl: config.uploads.publicBaseUrl,
  });
  const app = await createApp({
    db,
    corsOrigins: config.corsOrigins,
    logLevel: config.logLevel,
    bookingRateLimit: config.bookingRateLimit,
    tokenVerifier: config.auth0 ? createAuth0Verifier(config.auth0) : null,
    storage,
    uploads: config.uploads,
  });
  if (!config.auth0) {
    app.log.warn("AUTH0_DOMAIN/AUTH0_AUDIENCE not set: admin endpoints answer 503");
  }

  // Idle clients can error when the database restarts; log instead of crashing the process.
  pool.on("error", (err) => app.log.error({ err }, "idle database client error"));
  app.addHook("onClose", async () => {
    await pool.end();
    app.log.info("database pool closed");
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, "shutting down");
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await app.listen({ host: config.host, port: config.port });
  app.log.info({ env: config.nodeEnv, corsOrigins: config.corsOrigins }, "api started");
  return app;
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  startServer().catch((err: unknown) => {
    // The logger may not exist yet (e.g. invalid configuration): report once and exit.
    process.stderr.write(
      `Failed to start API: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
