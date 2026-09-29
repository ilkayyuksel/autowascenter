import type { FastifyInstance } from "fastify";
import { pingDatabase } from "../db/index.ts";
import { errorBody } from "../errors/app-error.ts";

/**
 * GET /health     Liveness: the process is up. Never touches the database, so a database
 *                 outage does not make an orchestrator restart a healthy API process.
 * GET /health/db  Readiness: the database answers `select 1`. 503 when it does not.
 * Responses contain no host names, versions or error details.
 */
export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/health/db", async (request, reply) => {
    try {
      await pingDatabase(app.db);
      return { status: "ok", database: "ok" };
    } catch (err) {
      request.log.error({ err }, "database health check failed");
      return reply
        .code(503)
        .send(errorBody("DATABASE_UNAVAILABLE", "The database is not reachable."));
    }
  });
}
