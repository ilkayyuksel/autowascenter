import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError, errorBody } from "./app-error.ts";

// Node network errors and PostgreSQL SQLSTATE classes that mean "the database cannot be reached"
// (08 = connection exception, 57P0x = admin/crash shutdown, 53300 = too many connections).
const UNAVAILABLE_ERRNO = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);
const UNAVAILABLE_SQLSTATE = /^(08|57P0)|^53300$/;
const TIMEOUT_MESSAGE = /timeout exceeded when trying to connect|Connection terminated/i;

/** True when the error (or one of its causes, e.g. a wrapped Drizzle query error) means the DB is down. */
export function isDatabaseUnavailable(error: unknown): boolean {
  for (let e = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (
      typeof code === "string" &&
      (UNAVAILABLE_ERRNO.has(code) || UNAVAILABLE_SQLSTATE.test(code))
    ) {
      return true;
    }
    if (typeof message === "string" && TIMEOUT_MESSAGE.test(message)) return true;
  }
  return false;
}

/** SQLSTATE of a PostgreSQL error, also when wrapped (e.g. by a Drizzle query error). */
export function pgErrorCode(error: unknown): string | undefined {
  for (let e = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

/**
 * Safety net for integrity violations that services did not translate themselves. The
 * database constraints are the last line of defence; the client only gets a generic code.
 */
const CONSTRAINT_ERRORS: Record<string, [number, string, string]> = {
  "23P01": [409, "BOOKING_SLOT_UNAVAILABLE", "The chosen time slot is no longer available."],
  "23505": [409, "RESOURCE_CONFLICT", "The change conflicts with existing data."],
  "23503": [409, "RESOURCE_CONFLICT", "The change conflicts with related data."],
  "23001": [409, "RESOURCE_IN_USE", "The resource is still in use."],
  "23514": [400, "VALIDATION_ERROR", "Invalid request: a value is not allowed."],
  "23502": [400, "VALIDATION_ERROR", "Invalid request: a required value is missing."],
};

/**
 * Central error handling: every error response has the shape `{ error: { code, message } }`.
 * Unexpected errors are logged with full detail server-side; the client only gets a generic
 * message, never a stack trace or driver/SQL details.
 */
export function registerErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send(errorBody("NOT_FOUND", `Route ${request.method} ${request.url} not found`));
  });

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message));
    }

    if (error instanceof ZodError) {
      const detail = error.issues
        .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
        .join("; ");
      return reply.code(400).send(errorBody("VALIDATION_ERROR", `Invalid request: ${detail}`));
    }

    // Errors raised by Fastify itself for bad requests (malformed JSON, body too large, ...).
    const statusCode = (error as FastifyError).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send(errorBody("BAD_REQUEST", error.message));
    }

    const constraint = CONSTRAINT_ERRORS[pgErrorCode(error) ?? ""];
    if (constraint) {
      const [status, code, message] = constraint;
      request.log.warn({ err: error }, "database constraint violation");
      return reply.code(status).send(errorBody(code, message));
    }

    if (isDatabaseUnavailable(error)) {
      request.log.error({ err: error }, "database unavailable");
      return reply
        .code(503)
        .send(errorBody("DATABASE_UNAVAILABLE", "The service is temporarily unavailable."));
    }

    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send(errorBody("INTERNAL_ERROR", "An unexpected error occurred."));
  });
}
