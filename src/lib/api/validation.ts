// Request validation before sending (UX only; the server validates again): a body that fails
// the shared Zod contract is never sent and becomes a RequestValidationError with per-field
// messages. Used by the admin writes and the public booking.

import { ApiError, CLIENT_ERROR } from "./client.ts";

interface Issue {
  path: PropertyKey[];
  message: string;
}
export interface RequestSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: Issue[] } };
}

/** Field → first problem, for forms. */
export type FieldErrors = Record<string, string>;

/** A request rejected by the shared contract before sending. */
export class RequestValidationError extends ApiError {
  readonly fields: FieldErrors;
  constructor(fields: FieldErrors) {
    super(0, CLIENT_ERROR.VALIDATION, "Invalid request: " + Object.keys(fields).join(", "));
    this.name = "RequestValidationError";
    this.fields = fields;
  }
}

export function issuesToFields(issues: Issue[]): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Validates with the shared contract; returns the parsed (normalised) body. */
export function validated<T>(schema: RequestSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new RequestValidationError(issuesToFields(result.error.issues));
  return result.data;
}
