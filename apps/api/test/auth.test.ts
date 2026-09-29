// Auth0 access-token validation and permission checks, without a real Auth0 tenant:
// RSA keys are generated per test run and served as a local (or local-HTTP) JWKS.

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import {
  createRemoteJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  UnsecuredJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import { z } from "zod";
import { createApp } from "../src/app.ts";
import { createJwtVerifier, createLocalVerifier } from "../src/auth/verifier.ts";
import type { Database } from "../src/db/index.ts";
import { createTestDb } from "./helpers/test-db.ts";

const ISSUER = "https://tenant.test.auth0.com/";
const AUDIENCE = "https://api.autowascenter.test";
const CLIENT_ID = "spa-client-id";
const ORIGIN = "http://localhost:8080";
const KID = "test-key-1";

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let jwk: JWK;
let db: Database;
let closeDb: () => Promise<void>;
let app: FastifyInstance;
let logs = "";

async function token(
  claims: Record<string, unknown> = {},
  opts: {
    key?: CryptoKey;
    iss?: string;
    aud?: string;
    exp?: string | number;
    nbf?: string | number;
    sub?: string | null;
  } = {},
) {
  const jwt = new SignJWT({ permissions: ["admin:access"], ...claims })
    .setProtectedHeader({ alg: "RS256", kid: KID, typ: "at+jwt" })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m");
  if (opts.sub !== null) jwt.setSubject(opts.sub ?? "auth0|admin-123");
  if (opts.nbf !== undefined) jwt.setNotBefore(opts.nbf);
  return jwt.sign(opts.key ?? signingKey);
}

const me = (authorization?: string, target = app) =>
  target.inject({
    method: "GET",
    url: "/api/admin/me",
    headers: authorization ? { authorization } : {},
  });

const errorSchema = z.strictObject({
  error: z.strictObject({ code: z.string(), message: z.string() }),
});
function assertError(res: { statusCode: number; body: string }, status: number, code: string) {
  assert.equal(res.statusCode, status, res.body);
  assert.equal(errorSchema.parse(JSON.parse(res.body)).error.code, code);
  // Never leak token or verification details.
  assert.doesNotMatch(res.body, /ERR_J|signature|expired|issuer|audience|claim|kid|jwks/i);
}

before(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  ({ privateKey: otherKey } = await generateKeyPair("RS256", { extractable: true }));
  signingKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" };

  const testDb = await createTestDb();
  db = testDb.db;
  closeDb = () => testDb.pg.close();

  const logStream = new Writable({
    write(chunk, _enc, done) {
      logs += chunk.toString();
      done();
    },
  });
  app = await createApp({
    db,
    corsOrigins: [ORIGIN],
    logLevel: "info",
    logStream,
    tokenVerifier: createLocalVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks: { keys: [jwk] },
    }),
  });
});

after(async () => {
  await app.close();
  await closeDb();
});

describe("GET /api/admin/me: authentication", () => {
  test("no Authorization header → 401 AUTHENTICATION_REQUIRED with a Bearer challenge", async () => {
    const res = await me();
    assertError(res, 401, "AUTHENTICATION_REQUIRED");
    assert.equal(res.headers["www-authenticate"], "Bearer");
  });

  test("malformed Authorization headers → 401 AUTHENTICATION_INVALID", async () => {
    for (const header of [
      "Bearer",
      "Bearer ",
      "Bearer not-a-jwt",
      "Basic dXNlcjpwYXNz",
      "bearer a.b.c",
      `Token ${await token()}`,
    ]) {
      const res = await me(header);
      assertError(res, 401, "AUTHENTICATION_INVALID");
      assert.equal(res.headers["www-authenticate"], 'Bearer error="invalid_token"');
    }
  });

  test("invalid signature → 401", async () => {
    assertError(
      await me(`Bearer ${await token({}, { key: otherKey })}`),
      401,
      "AUTHENTICATION_INVALID",
    );
    // Tampered payload with the original signature.
    const [h, , s] = (await token()).split(".");
    const forged = Buffer.from(
      JSON.stringify({ sub: "x", permissions: ["admin:access"] }),
    ).toString("base64url");
    assertError(await me(`Bearer ${h}.${forged}.${s}`), 401, "AUTHENTICATION_INVALID");
  });

  test("wrong issuer → 401", async () => {
    assertError(
      await me(`Bearer ${await token({}, { iss: "https://evil.example/" })}`),
      401,
      "AUTHENTICATION_INVALID",
    );
  });

  test("wrong audience (e.g. an ID token whose aud is the SPA client id) → 401", async () => {
    assertError(
      await me(`Bearer ${await token({}, { aud: CLIENT_ID })}`),
      401,
      "AUTHENTICATION_INVALID",
    );
  });

  test("expired token and not-yet-valid token → 401", async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    assertError(
      await me(`Bearer ${await token({}, { exp: past })}`),
      401,
      "AUTHENTICATION_INVALID",
    );
    const future = Math.floor(Date.now() / 1000) + 600;
    assertError(
      await me(`Bearer ${await token({}, { nbf: future })}`),
      401,
      "AUTHENTICATION_INVALID",
    );
  });

  test("only RS256 is accepted: HS256 and alg=none are rejected", async () => {
    const hs = await new SignJWT({ permissions: ["admin:access"] })
      .setProtectedHeader({ alg: "HS256", kid: KID })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("auth0|x")
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("a-shared-secret-that-is-long-enough-123456"));
    assertError(await me(`Bearer ${hs}`), 401, "AUTHENTICATION_INVALID");

    const none = new UnsecuredJWT({ permissions: ["admin:access"] })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("auth0|x")
      .setExpirationTime("5m")
      .encode();
    assertError(await me(`Bearer ${none}`), 401, "AUTHENTICATION_INVALID");
  });

  test("a token without sub → 401", async () => {
    assertError(
      await me(`Bearer ${await token({}, { sub: null })}`),
      401,
      "AUTHENTICATION_INVALID",
    );
  });
});

describe("GET /api/admin/me: authorization", () => {
  test("valid token without admin:access → 403 AUTHORIZATION_REQUIRED", async () => {
    for (const permissions of [[], ["bookings:read"], "admin:access", undefined]) {
      const res = await me(`Bearer ${await token({ permissions })}`);
      assertError(res, 403, "AUTHORIZATION_REQUIRED");
    }
  });

  test("valid token with admin:access → 200 with only sub and permissions", async () => {
    const res = await me(
      `Bearer ${await token({ permissions: ["admin:access"], email: "admin@example.com", name: "Admin", scope: "openid" })}`,
    );
    assert.equal(res.statusCode, 200);
    const body = z
      .strictObject({ data: z.strictObject({ sub: z.string(), permissions: z.array(z.string()) }) })
      .parse(res.json());
    assert.deepEqual(body.data, { sub: "auth0|admin-123", permissions: ["admin:access"] });
    assert.doesNotMatch(res.body, /admin@example\.com|eyJ/);
  });

  test("the Auth0 subject is treated as an opaque string (not a UUID)", async () => {
    const res = await me(`Bearer ${await token({}, { sub: "google-oauth2|1234567890" })}`);
    assert.equal(res.json().data.sub, "google-oauth2|1234567890");
  });
});

describe("public endpoints stay public", () => {
  test("work without a token, and ignore an invalid one", async () => {
    for (const url of [
      "/api/services",
      "/api/gallery",
      "/api/reviews",
      "/api/vehicle-types",
      "/health",
    ]) {
      assert.equal((await app.inject({ method: "GET", url })).statusCode, 200, url);
      const withBadToken = await app.inject({
        method: "GET",
        url,
        headers: { authorization: "Bearer garbage" },
      });
      assert.equal(withBadToken.statusCode, 200, url);
    }
    // Booking endpoints do not ask for authentication (their own validation applies).
    const availability = await app.inject({ method: "GET", url: "/api/availability" });
    assert.equal(availability.statusCode, 400);
    const booking = await app.inject({ method: "POST", url: "/api/bookings", payload: {} });
    assert.equal(booking.statusCode, 400);
  });
});

describe("configuration and infrastructure", () => {
  test("without Auth0 configuration protected routes answer 503, never 200", async () => {
    const unconfigured = await createApp({ db, corsOrigins: [ORIGIN], logLevel: "silent" });
    try {
      assertError(
        await me(`Bearer ${await token()}`, unconfigured),
        503,
        "AUTHENTICATION_UNAVAILABLE",
      );
      assertError(await me(undefined, unconfigured), 503, "AUTHENTICATION_UNAVAILABLE");
    } finally {
      await unconfigured.close();
    }
  });

  test("remote JWKS over HTTP: valid token accepted; JWKS unreachable → 503", async () => {
    let server: Server | undefined = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const jwksUrl = new URL(`http://127.0.0.1:${port}/.well-known/jwks.json`);

    const remoteApp = await createApp({
      db,
      corsOrigins: [ORIGIN],
      logLevel: "silent",
      tokenVerifier: createJwtVerifier({
        issuer: ISSUER,
        audience: AUDIENCE,
        keys: createRemoteJWKSet(jwksUrl, { timeoutDuration: 1_000 }),
      }),
    });
    const downApp = await createApp({
      db,
      corsOrigins: [ORIGIN],
      logLevel: "silent",
      tokenVerifier: createJwtVerifier({
        issuer: ISSUER,
        audience: AUDIENCE,
        keys: createRemoteJWKSet(new URL("http://127.0.0.1:1/jwks.json"), {
          timeoutDuration: 1_000,
        }),
      }),
    });
    try {
      assert.equal((await me(`Bearer ${await token()}`, remoteApp)).statusCode, 200);
      assertError(await me(`Bearer ${await token()}`, downApp), 503, "AUTHENTICATION_UNAVAILABLE");
    } finally {
      await remoteApp.close();
      await downApp.close();
      await new Promise((resolve) => server!.close(resolve));
      server = undefined;
    }
  });

  test("CORS preflight allows the Authorization header for the configured origin", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/admin/me",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers["access-control-allow-origin"], ORIGIN);
    assert.match(String(res.headers["access-control-allow-headers"]), /Authorization/i);
  });

  test("the Authorization header and tokens never appear in the logs", async () => {
    const valid = await token();
    const invalid = await token({}, { key: otherKey });
    logs = "";
    await me(`Bearer ${valid}`);
    await me(`Bearer ${invalid}`);
    await me(`Bearer ${await token({ permissions: [] })}`);
    assert.ok(logs.length > 0, "expected request logs");
    assert.ok(!logs.includes(valid) && !logs.includes(invalid), "token leaked into logs");
    assert.doesNotMatch(logs, /eyJ[A-Za-z0-9_-]{10,}|authorization/i);
    // Safe metadata is logged: the rejection reason code and the permission denial.
    assert.match(logs, /access token rejected/);
    assert.match(logs, /permission denied/);
  });
});
