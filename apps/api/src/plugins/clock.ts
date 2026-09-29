import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    /** Current time. Injectable so tests can pin "now" (today/past-slot rules). */
    clock: () => Date;
  }
}

export function registerClock(app: FastifyInstance, clock: () => Date = () => new Date()) {
  app.decorate("clock", clock);
}
