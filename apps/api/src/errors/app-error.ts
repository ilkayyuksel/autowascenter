/** An expected error with a stable, client-facing code and HTTP status. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const notFound = (code: string, message: string) => new AppError(404, code, message);

/** Body of every error response. */
export interface ErrorBody {
  error: { code: string; message: string };
}

export const errorBody = (code: string, message: string): ErrorBody => ({
  error: { code, message },
});
