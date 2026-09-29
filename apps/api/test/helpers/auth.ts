// Test Auth0: RSA keys generated per run and a local JWKS verifier. No real tenant, no
// real tokens in Git.

import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { createLocalVerifier, type TokenVerifier } from "../../src/auth/verifier.ts";

export const TEST_ISSUER = "https://tenant.test.auth0.com/";
export const TEST_AUDIENCE = "https://api.autowascenter.test";
const KID = "test-key";

export interface TestAuth {
  verifier: TokenVerifier;
  /** Signed access token; defaults to sub "auth0|admin" with the admin:access permission. */
  token: (claims?: Record<string, unknown>) => Promise<string>;
  /** A well-formed token signed with a key that is not in the JWKS. */
  foreignToken: () => Promise<string>;
}

export async function createTestAuth(): Promise<TestAuth> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const { privateKey: foreignKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };

  const sign = (key: CryptoKey, claims: Record<string, unknown>) =>
    new SignJWT({ permissions: ["admin:access"], ...claims })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setSubject("auth0|admin")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(key);

  return {
    verifier: createLocalVerifier({
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      jwks: { keys: [jwk] },
    }),
    token: (claims = {}) => sign(privateKey, claims),
    foreignToken: () => sign(foreignKey, {}),
  };
}
