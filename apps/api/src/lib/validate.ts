import type { z } from "zod";
import { AppError } from "../errors/app-error.ts";

/**
 * Validates input with a Zod schema and throws 400 VALIDATION_ERROR on failure.
 * Uses safeParse instead of `instanceof ZodError`, so it also works for schemas from
 * packages/shared (which may resolve its own copy of zod).
 */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
    .join("; ");
  throw new AppError(400, "VALIDATION_ERROR", `Invalid request: ${detail}`);
}
