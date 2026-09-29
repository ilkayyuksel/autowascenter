import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

/**
 * CORS for the browser frontend. Only the explicitly configured origins are allowed
 * (CORS_ORIGIN, comma-separated); "*" is rejected in production by the config layer.
 * Only read methods are exposed for now: there are no write endpoints yet.
 */
export async function registerCors(app: FastifyInstance, origins: string[]) {
  await app.register(cors, {
    origin: origins.includes("*") ? true : origins,
    methods: ["GET", "HEAD", "OPTIONS"],
  });
}
