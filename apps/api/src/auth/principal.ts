/** Auth0 RBAC permission that grants access to the admin API (phase 5: the only one). */
export const ADMIN_ACCESS = "admin:access";

/**
 * The authenticated caller, derived from a verified Auth0 access token.
 * `sub` is an opaque Auth0 subject string (e.g. "auth0|abc123"), not a UUID, and is not
 * stored anywhere. No profile data (name, e-mail) is taken from the token.
 */
export interface Principal {
  sub: string;
  permissions: string[];
  issuer: string;
  audience: string[];
}

export function hasPermission(principal: Principal, permission: string): boolean {
  return principal.permissions.includes(permission);
}
