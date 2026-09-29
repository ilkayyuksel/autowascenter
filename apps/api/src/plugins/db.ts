import type { FastifyInstance } from "fastify";
import type { Database } from "../db/index.ts";

declare module "fastify" {
  interface FastifyInstance {
    /** The process-wide Drizzle client (one shared pool). */
    db: Database;
  }
}

/** Makes the shared database client available to all routes as `app.db`. */
export function registerDatabase(app: FastifyInstance, db: Database) {
  app.decorate("db", db);
}
