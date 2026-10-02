// Admin access check against the backend. The frontend never decides authorization on its
// own: it asks GET /api/admin/me with the Auth0 ACCESS token (never the ID token) and maps
// the HTTP result to a UI state. The backend is the security boundary.

export const ADMIN_PERMISSION = "admin:access";

export interface AdminMe {
  sub: string;
  permissions: string[];
}

export type AdminAccess =
  | { status: "authorized"; me: AdminMe }
  /** The API or Auth0 no longer accepts the session: an explicit new login is needed. */
  | { status: "reauth" }
  /** Logged in, but the account lacks admin:access. */
  | { status: "forbidden" }
  /** Network/timeout/unexpected response: retryable, no details shown. */
  | { status: "error" };

/** Auth0 SDK error codes that mean "log in again" (no valid session or refresh token). */
const LOGIN_REQUIRED_ERRORS = new Set([
  "login_required",
  "consent_required",
  "interaction_required",
  "missing_refresh_token",
  "invalid_grant",
]);

/** True for Auth0 SDK token errors that mean "log in again" (not a transient failure). */
export function isLoginRequiredError(error: unknown): boolean {
  const code = (error as { error?: unknown } | null)?.error;
  return typeof code === "string" && LOGIN_REQUIRED_ERRORS.has(code);
}

const REQUEST_TIMEOUT_MS = 10_000;

/** Adds `Authorization: Bearer <access token>` to request headers. */
export function withBearer(accessToken: string, headers: HeadersInit = {}): Headers {
  const result = new Headers(headers);
  result.set("Authorization", `Bearer ${accessToken}`);
  return result;
}

function isAdminMe(value: unknown): value is AdminMe {
  const v = value as AdminMe | null;
  return (
    !!v &&
    typeof v.sub === "string" &&
    Array.isArray(v.permissions) &&
    v.permissions.every((p) => typeof p === "string")
  );
}

export interface FetchAdminAccessOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Gets an access token (via the injected Auth0 `getAccessTokenSilently`), calls
 * GET /api/admin/me and classifies the outcome. Always settles (timeouts included), so the
 * admin UI can never keep loading forever.
 */
export async function fetchAdminAccess(
  getAccessToken: () => Promise<string | undefined>,
  { baseUrl, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS }: FetchAdminAccessOptions,
): Promise<AdminAccess> {
  let accessToken: string | undefined;
  try {
    accessToken = await getAccessToken();
    if (!accessToken) return { status: "reauth" };
  } catch (error) {
    return isLoginRequiredError(error) ? { status: "reauth" } : { status: "error" };
  }

  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetchImpl(`${baseUrl}/api/admin/me`, {
      method: "GET",
      headers: withBearer(accessToken, { Accept: "application/json" }),
      signal: controller.signal,
    });
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) return { status: "reauth" };
  if (response.status === 403) return { status: "forbidden" };
  if (!response.ok) return { status: "error" };

  try {
    const body = (await response.json()) as { data?: unknown };
    if (!isAdminMe(body.data)) return { status: "error" };
    // 200 already means the backend granted admin:access; the check is defensive only.
    if (!body.data.permissions.includes(ADMIN_PERMISSION)) return { status: "forbidden" };
    return { status: "authorized", me: body.data };
  } catch {
    return { status: "error" };
  }
}
