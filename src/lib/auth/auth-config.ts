// Frontend Auth0 configuration. All values are PUBLIC (they end up in the browser bundle):
// the domain, the SPA client id and the API audience are not secrets. A client secret must
// never be configured for the frontend; the SPA uses Authorization Code Flow with PKCE.

export interface Auth0Config {
  domain: string;
  clientId: string;
  audience: string;
}

type Env = Record<string, string | boolean | undefined>;

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Reads VITE_AUTH0_*; returns null when incomplete (admin UI then shows a configuration notice). */
export function readAuth0Config(env: Env): Auth0Config | null {
  const domain = str(env.VITE_AUTH0_DOMAIN)
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const clientId = str(env.VITE_AUTH0_CLIENT_ID);
  const audience = str(env.VITE_AUTH0_AUDIENCE);
  return domain && clientId && audience ? { domain, clientId, audience } : null;
}

/** Base URL of the self-hosted API (no trailing slash). */
export function readApiBaseUrl(env: Env): string {
  return (str(env.VITE_API_BASE_URL) || "http://localhost:3001").replace(/\/+$/, "");
}

/**
 * Where to go after login. Only same-site admin paths are accepted, so a crafted
 * `returnTo` (e.g. "//evil.example" or "https://…") can never cause an open redirect.
 */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/admin";
  if (!/^\/admin(\/[A-Za-z0-9\-_/]*)?$/.test(value)) return "/admin";
  return value;
}
