// Central, typed client for the self-hosted API (VITE_API_BASE_URL). The only place in the
// frontend that calls fetch() for the API.
//
// - get(), post(): public endpoints, never send a token (e.g. POST /api/bookings).
// - getAdmin(), postAdmin(), patchAdmin(), putAdmin(), deleteAdmin(), postAdminForm():
//                /api/admin/* endpoints; ask the injected getAccessToken (Auth0
//                getAccessTokenSilently) for an ACCESS token and send it as a Bearer header.
//                The client never stores or refreshes tokens itself.
// - JSON bodies are sent as application/json; postAdminForm() sends multipart FormData (the
//   browser sets the boundary). Request bodies are validated by the callers
//   (src/lib/api/admin-writes.ts) with the shared Zod contracts before they get here.
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
  /** A request body failed the shared Zod contract before it was sent (nothing was sent). */
  VALIDATION: "CLIENT_VALIDATION_ERROR",
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
  /** Overrides the client's timeout for this request (e.g. uploads). */
  timeoutMs?: number;
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
  /** Public JSON POST, without any token. */
  post<T>(
    path: string,
    body: unknown,
    schema: ResponseSchema<T>,
    options?: RequestOptions,
  ): Promise<T>;
  getAdmin<T>(path: string, schema: ResponseSchema<T>, options?: RequestOptions): Promise<T>;
  postAdmin<T>(
    path: string,
    body: unknown,
    schema: ResponseSchema<T>,
    options?: RequestOptions,
  ): Promise<T>;
  patchAdmin<T>(
    path: string,
    body: unknown,
    schema: ResponseSchema<T>,
    options?: RequestOptions,
  ): Promise<T>;
  putAdmin<T>(
    path: string,
    body: unknown,
    schema: ResponseSchema<T>,
    options?: RequestOptions,
  ): Promise<T>;
  /** DELETE; the API answers 204 without a body. */
  deleteAdmin(path: string, options?: RequestOptions): Promise<void>;
  /** multipart/form-data POST (gallery upload). */
  postAdminForm<T>(
    path: string,
    form: FormData,
    schema: ResponseSchema<T>,
    options?: RequestOptions,
  ): Promise<T>;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type Body = { kind: "json"; value: unknown } | { kind: "form"; value: FormData } | null;

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
    method: Method,
    path: string,
    body: Body,
    schema: ResponseSchema<T> | null,
    { query, signal, timeoutMs: requestTimeoutMs }: RequestOptions,
    token: string | null,
  ): Promise<T> {
    const headers = new Headers({ Accept: "application/json" });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let payload: BodyInit | undefined;
    if (body?.kind === "json") {
      headers.set("Content-Type", "application/json");
      payload = JSON.stringify(body.value);
    } else if (body?.kind === "form") {
      payload = body.value; // Content-Type with boundary is set by fetch
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs ?? timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    let response: Response;
    try {
      response = await fetchImpl(buildUrl(baseUrl, path, query), {
        method,
        headers,
        body: payload,
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

    // 204 No Content (DELETE): nothing to parse.
    if (schema === null && response.status === 204) return undefined as T;

    let json: unknown;
    try {
      json = await response.json();
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
    if (!response.ok) throw errorFromBody(response.status, json);
    if (schema === null) return undefined as T;

    const parsed = schema.safeParse(json);
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
    get: (path, schema, options = {}) => request("GET", path, null, schema, options, null),
    post: (path, body, schema, options = {}) =>
      request("POST", path, { kind: "json", value: body }, schema, options, null),
    getAdmin: async (path, schema, options = {}) =>
      request("GET", path, null, schema, options, await accessToken()),
    postAdmin: async (path, body, schema, options = {}) =>
      request("POST", path, { kind: "json", value: body }, schema, options, await accessToken()),
    patchAdmin: async (path, body, schema, options = {}) =>
      request("PATCH", path, { kind: "json", value: body }, schema, options, await accessToken()),
    putAdmin: async (path, body, schema, options = {}) =>
      request("PUT", path, { kind: "json", value: body }, schema, options, await accessToken()),
    deleteAdmin: async (path, options = {}) =>
      request<void>("DELETE", path, null, null, options, await accessToken()),
    postAdminForm: async (path, form, schema, options = {}) =>
      request("POST", path, { kind: "form", value: form }, schema, options, await accessToken()),
  };
}
