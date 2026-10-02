// Central, typed client for the self-hosted API (VITE_API_BASE_URL). The only place in the
// frontend that calls fetch() for the API.
//
// - get():      public endpoints, never sends a token.
// - getAdmin(): /api/admin/* endpoints; asks the injected getAccessToken (Auth0
//               getAccessTokenSilently) for an ACCESS token and sends it as a Bearer header.
//               The client never stores or refreshes tokens itself.
// - Every failure becomes an ApiError { status, code, message }; the raw backend response
//   never reaches the UI. Responses are validated at runtime with the shared Zod contracts.
// - Requests always settle (timeout), so no page can keep loading forever.
// - Nothing is logged here: no URLs with tokens, no headers, no bodies.

import { isLoginRequiredError } from "../auth/admin-access.ts";

/** Structural subset of a Zod schema; avoids coupling to one zod copy. */
export interface ResponseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/** Client-side codes, next to the backend's `{ error: { code } }` codes. */
export const CLIENT_ERROR = {
  NETWORK: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
  /** Cancelled by the caller (e.g. the page was left); not shown to the user. */
  ABORTED: "ABORTED",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  /** No usable access token: the session must be renewed by logging in again. */
  SESSION_EXPIRED: "AUTHENTICATION_REQUIRED",
  TOKEN_UNAVAILABLE: "TOKEN_UNAVAILABLE",
} as const;

export class ApiError extends Error {
  /** HTTP status; 0 when no HTTP response was received (network, timeout, token). */
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const isApiError = (value: unknown): value is ApiError => value instanceof ApiError;

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue | readonly QueryValue[]>;

export interface RequestOptions {
  query?: Query;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  /** e.g. https://api.autowascenter.be (no trailing slash needed). */
  baseUrl: string;
  /** Auth0 getAccessTokenSilently (access token for the API audience). Admin calls only. */
  getAccessToken?: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ApiClient {
  get<T>(path: string, schema: ResponseSchema<T>, options?: RequestOptions): Promise<T>;
  getAdmin<T>(path: string, schema: ResponseSchema<T>, options?: RequestOptions): Promise<T>;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

/** Builds `<base><path>?<query>`; arrays become repeated keys, null/undefined are omitted. */
export function buildUrl(baseUrl: string, path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) if (v !== undefined && v !== null) params.append(key, String(v));
  }
  const qs = params.toString();
  return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}${qs ? `?${qs}` : ""}`;
}

function errorFromBody(status: number, body: unknown): ApiError {
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  if (error && typeof error.code === "string" && typeof error.message === "string") {
    return new ApiError(status, error.code, error.message);
  }
  return new ApiError(status, `HTTP_${status}`, `Request failed with status ${status}.`);
}

export function createApiClient({
  baseUrl,
  getAccessToken,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ApiClientOptions): ApiClient {
  async function accessToken(): Promise<string> {
    if (!getAccessToken) {
      throw new ApiError(0, CLIENT_ERROR.TOKEN_UNAVAILABLE, "No access token provider configured.");
    }
    let token: string | undefined;
    try {
      token = await getAccessToken();
    } catch (error) {
      if (isLoginRequiredError(error)) {
        throw new ApiError(401, CLIENT_ERROR.SESSION_EXPIRED, "The session has expired.");
      }
      throw new ApiError(0, CLIENT_ERROR.TOKEN_UNAVAILABLE, "Could not obtain an access token.");
    }
    if (!token) throw new ApiError(401, CLIENT_ERROR.SESSION_EXPIRED, "The session has expired.");
    return token;
  }

  async function request<T>(
    path: string,
    schema: ResponseSchema<T>,
    { query, signal }: RequestOptions,
    token: string | null,
  ): Promise<T> {
    const headers = new Headers({ Accept: "application/json" });
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    let response: Response;
    try {
      response = await fetchImpl(buildUrl(baseUrl, path, query), {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } catch {
      if (timedOut)
        throw new ApiError(0, CLIENT_ERROR.TIMEOUT, "The server did not respond in time.");
      if (signal?.aborted)
        throw new ApiError(0, CLIENT_ERROR.ABORTED, "The request was cancelled.");
      throw new ApiError(0, CLIENT_ERROR.NETWORK, "The server could not be reached.");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (!response.ok) {
        throw new ApiError(response.status, `HTTP_${response.status}`, "Request failed.");
      }
      throw new ApiError(
        response.status,
        CLIENT_ERROR.INVALID_RESPONSE,
        "Malformed server response.",
      );
    }
    if (!response.ok) throw errorFromBody(response.status, body);

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        response.status,
        CLIENT_ERROR.INVALID_RESPONSE,
        "The server response does not match the expected format.",
      );
    }
    return parsed.data;
  }

  return {
    get: (path, schema, options = {}) => request(path, schema, options, null),
    getAdmin: async (path, schema, options = {}) =>
      request(path, schema, options, await accessToken()),
  };
}
