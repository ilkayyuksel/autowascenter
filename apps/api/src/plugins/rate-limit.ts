import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { AppError } from "../errors/app-error.ts";

export interface BookingRateLimit {
  max: number;
  timeWindowMs: number;
}

/**
 * Registers @fastify/rate-limit without a global limit; routes opt in via
 * `config.rateLimit`. The store is in-process memory, per client IP: fine for one API
 * process. With several API replicas a shared store (e.g. Redis) is required, otherwise
 * every replica counts separately. Behind a reverse proxy, Fastify's `trustProxy` must be
 * enabled so the real client IP (not the proxy's) is used as key.
 */
export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      new AppError(
        429,
        "RATE_LIMITED",
        `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      ),
  });
}
