// Access-token verification for Auth0-issued JWTs.
//
// Checks: RS256 signature against the tenant's JWKS (fetched remotely and cached, never
// hardcoded), `iss`, `aud`, `exp` and `nbf` (with a small clock tolerance), and the presence
// of `sub`. Permissions come from the RBAC `permissions` claim.

import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";
import type { Principal } from "./principal.ts";

/** Why a token was not accepted. Only this category is exposed to callers, never details. */
export class TokenVerificationError extends Error {
  /** `invalid`: the token is not acceptable. `unavailable`: keys could not be obtained. */
  readonly kind: "invalid" | "unavailable";
  /** Safe-to-log reason (a jose error code or a short label), never the token itself. */
  readonly reason: string;

  constructor(kind: "invalid" | "unavailable", reason: string) {
    super(`Token verification failed (${kind}): ${reason}`);
    this.name = "TokenVerificationError";
    this.kind = kind;
    this.reason = reason;
  }
}

export interface TokenVerifier {
  verify(token: string): Promise<Principal>;
}

type KeySet = Parameters<typeof jwtVerify>[1];

export interface JwtVerifierOptions {
  issuer: string;
  audience: string;
  keys: KeySet;
  /** Allowed clock skew for exp/nbf (seconds). */
  clockToleranceSeconds?: number;
}

const ALGORITHMS = ["RS256"];

function toPrincipal(payload: JWTPayload): Principal {
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new TokenVerificationError("invalid", "missing_sub");
  }
  const raw = (payload as { permissions?: unknown }).permissions;
  const permissions = Array.isArray(raw)
    ? raw.filter((p): p is string => typeof p === "string")
    : [];
  const aud = payload.aud;
  return {
    sub: payload.sub,
    permissions,
    issuer: String(payload.iss),
    audience: Array.isArray(aud) ? aud : aud ? [aud] : [],
  };
}

/** Maps jose failures: key-retrieval problems are `unavailable`, everything else `invalid`. */
function classify(error: unknown): TokenVerificationError {
  if (error instanceof TokenVerificationError) return error;
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) {
    return new TokenVerificationError("unavailable", error.code);
  }
  if (error instanceof errors.JOSEError) {
    return new TokenVerificationError("invalid", error.code);
  }
  // Network failures while fetching the JWKS surface as plain errors (e.g. fetch TypeError).
  return new TokenVerificationError("unavailable", "jwks_fetch_failed");
}

/** Deterministic verifier core; the key source is injected (remote JWKS or a local test set). */
export function createJwtVerifier(options: JwtVerifierOptions): TokenVerifier {
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, options.keys, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ALGORITHMS,
          clockTolerance: options.clockToleranceSeconds ?? 5,
          requiredClaims: ["sub", "exp"],
        });
        return toPrincipal(payload);
      } catch (error) {
        throw classify(error);
      }
    },
  };
}

export interface Auth0Settings {
  domain: string;
  audience: string;
  issuer: string;
  jwksUrl: string;
}

/** Production verifier: remote, cached JWKS from https://<AUTH0_DOMAIN>/.well-known/jwks.json. */
export function createAuth0Verifier(settings: Auth0Settings): TokenVerifier {
  const keys = createRemoteJWKSet(new URL(settings.jwksUrl), {
    timeoutDuration: 5_000, // fail fast when Auth0 is unreachable
    cooldownDuration: 30_000, // min. time between refetches (key rotation / unknown kid)
    cacheMaxAge: 10 * 60_000, // refresh keys at least every 10 minutes
  });
  return createJwtVerifier({ issuer: settings.issuer, audience: settings.audience, keys });
}

/** Test helper: a verifier backed by an in-memory key set. */
export function createLocalVerifier(
  options: Omit<JwtVerifierOptions, "keys"> & { jwks: JSONWebKeySet },
) {
  return createJwtVerifier({ ...options, keys: createLocalJWKSet(options.jwks) });
}
