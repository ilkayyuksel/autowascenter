import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

/**
 * CORS for the browser frontend. Only the explicitly configured origins are allowed
 * (CORS_ORIGIN, comma-separated); "*" is rejected in production by the config layer.
 * POST is needed for the public booking endpoint; JSON bodies need the Content-Type header.
 */
export async function registerCors(app: FastifyInstance, origins: string[]) {
  await app.register(cors, {
    origin: origins.includes("*") ? true : origins,
    methods: ["GET", "HEAD", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  });
}
