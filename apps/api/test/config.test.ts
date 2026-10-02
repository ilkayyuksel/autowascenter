import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadConfig } from "../src/config/env.ts";

const DB = "postgres://user:very-secret@db.internal:5432/app";

describe("loadConfig", () => {
  test("applies development defaults", () => {
    const config = loadConfig({ DATABASE_URL: DB });
    assert.equal(config.nodeEnv, "development");
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.port, 3001);
    assert.deepEqual(config.corsOrigins, ["http://localhost:8080"]);
    assert.equal(config.logLevel, "info");
  });

  test("parses a comma-separated CORS_ORIGIN and PORT", () => {
    const config = loadConfig({
      DATABASE_URL: DB,
      PORT: "8081",
      CORS_ORIGIN: "https://autowascenter.be, https://www.autowascenter.be",
    });
    assert.equal(config.port, 8081);
    assert.deepEqual(config.corsOrigins, [
      "https://autowascenter.be",
      "https://www.autowascenter.be",
    ]);
  });

  test("booking rate limit is configurable, with safe defaults", () => {
    assert.deepEqual(loadConfig({ DATABASE_URL: DB }).bookingRateLimit, {
      max: 10,
      timeWindowMs: 60_000,
    });
    assert.deepEqual(
      loadConfig({
        DATABASE_URL: DB,
        BOOKING_RATE_LIMIT_MAX: "3",
        BOOKING_RATE_LIMIT_WINDOW_MS: "120000",
      }).bookingRateLimit,
      { max: 3, timeWindowMs: 120_000 },
    );
    assert.throws(
      () => loadConfig({ DATABASE_URL: DB, BOOKING_RATE_LIMIT_MAX: "0" }),
      /BOOKING_RATE_LIMIT_MAX/,
    );
  });

  test("uploads: development defaults, configurable limits, PUBLIC_UPLOAD_URL rules", () => {
    assert.deepEqual(loadConfig({ DATABASE_URL: DB, PORT: "3005" }).uploads, {
      dir: "./uploads",
      publicBaseUrl: "http://localhost:3005/uploads",
      maxBytes: 10 * 1024 * 1024,
      rateLimit: { max: 30, timeWindowMs: 3_600_000 },
    });
    assert.deepEqual(
      loadConfig({
        DATABASE_URL: DB,
        UPLOAD_DIR: "/var/lib/autowascenter/uploads",
        PUBLIC_UPLOAD_URL: "https://autowascenter.be/uploads",
        MAX_UPLOAD_BYTES: "2048",
        UPLOAD_RATE_LIMIT_MAX: "5",
        UPLOAD_RATE_LIMIT_WINDOW_MS: "60000",
      }).uploads,
      {
        dir: "/var/lib/autowascenter/uploads",
        publicBaseUrl: "https://autowascenter.be/uploads",
        maxBytes: 2048,
        rateLimit: { max: 5, timeWindowMs: 60_000 },
      },
    );
    for (const bad of [
      "https://a.be/uploads/",
      "ftp://a.be/uploads",
      "https://a.be/u?x=1",
      "/uploads",
    ]) {
      assert.throws(
        () => loadConfig({ DATABASE_URL: DB, PUBLIC_UPLOAD_URL: bad }),
        /PUBLIC_UPLOAD_URL/,
      );
    }
    assert.throws(
      () => loadConfig({ DATABASE_URL: DB, MAX_UPLOAD_BYTES: "0" }),
      /MAX_UPLOAD_BYTES/,
    );
    assert.throws(
      () => loadConfig({ DATABASE_URL: DB, MAX_UPLOAD_BYTES: String(51 * 1024 * 1024) }),
      /MAX_UPLOAD_BYTES/,
    );
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: "production",
          DATABASE_URL: DB,
          CORS_ORIGIN: "https://a.be",
          AUTH0_DOMAIN: "tenant.eu.auth0.com",
          AUTH0_AUDIENCE: "x",
        }),
      /PUBLIC_UPLOAD_URL: required in production/,
    );
  });

  test("TRUST_PROXY: off by default, true, false, or a trusted proxy list", () => {
    assert.equal(loadConfig({ DATABASE_URL: DB }).trustProxy, false);
    assert.equal(loadConfig({ DATABASE_URL: DB, TRUST_PROXY: "true" }).trustProxy, true);
    assert.equal(loadConfig({ DATABASE_URL: DB, TRUST_PROXY: "TRUE" }).trustProxy, true);
    assert.equal(loadConfig({ DATABASE_URL: DB, TRUST_PROXY: "false" }).trustProxy, false);
    assert.equal(
      loadConfig({ DATABASE_URL: DB, TRUST_PROXY: "172.16.0.0/12,10.0.0.0/8" }).trustProxy,
      "172.16.0.0/12,10.0.0.0/8",
    );
  });

  test("an empty value counts as not set (Docker Compose always defines listed keys)", () => {
    // Optional settings left blank in deploy/.env must not fail validation.
    const config = loadConfig({
      DATABASE_URL: DB,
      AUTH0_ISSUER: "",
      PUBLIC_UPLOAD_URL: "",
      TRUST_PROXY: "",
      LOG_LEVEL: "",
    });
    assert.equal(config.auth0, null);
    assert.equal(config.trustProxy, false);
    assert.equal(config.logLevel, "info");
    assert.equal(config.uploads.publicBaseUrl, `http://localhost:${config.port}/uploads`);
    // Blank still means "missing" where production requires a value.
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: "production",
          DATABASE_URL: DB,
          CORS_ORIGIN: "",
          AUTH0_DOMAIN: "",
          AUTH0_AUDIENCE: "",
          PUBLIC_UPLOAD_URL: "",
        }),
      /CORS_ORIGIN: required in production/,
    );
  });

  test("requires DATABASE_URL", () => {
    assert.throws(() => loadConfig({}), /DATABASE_URL/);
  });

  test("requires an explicit, non-wildcard CORS_ORIGIN in production", () => {
    assert.throws(() => loadConfig({ NODE_ENV: "production", DATABASE_URL: DB }), /CORS_ORIGIN/);
    assert.throws(
      () => loadConfig({ NODE_ENV: "production", DATABASE_URL: DB, CORS_ORIGIN: "*" }),
      /not allowed in production/,
    );
    const ok = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: DB,
      CORS_ORIGIN: "https://autowascenter.be",
      AUTH0_DOMAIN: "tenant.eu.auth0.com",
      AUTH0_AUDIENCE: "https://api.autowascenter.be",
      PUBLIC_UPLOAD_URL: "https://autowascenter.be/uploads",
    });
    assert.equal(ok.isProduction, true);
  });

  test("Auth0: required in production, derived issuer and JWKS URL, optional in development", () => {
    const prod = {
      NODE_ENV: "production",
      DATABASE_URL: DB,
      CORS_ORIGIN: "https://a.be",
      PUBLIC_UPLOAD_URL: "https://a.be/uploads",
    };
    assert.throws(() => loadConfig(prod), /AUTH0_DOMAIN: required in production/);

    const config = loadConfig({
      ...prod,
      AUTH0_DOMAIN: "tenant.eu.auth0.com",
      AUTH0_AUDIENCE: "https://api.autowascenter.be",
    });
    assert.deepEqual(config.auth0, {
      domain: "tenant.eu.auth0.com",
      audience: "https://api.autowascenter.be",
      issuer: "https://tenant.eu.auth0.com/",
      jwksUrl: "https://tenant.eu.auth0.com/.well-known/jwks.json",
    });

    const custom = loadConfig({
      ...prod,
      AUTH0_DOMAIN: "login.autowascenter.be",
      AUTH0_AUDIENCE: "x",
      AUTH0_ISSUER: "https://login.autowascenter.be/",
    });
    assert.equal(custom.auth0?.issuer, "https://login.autowascenter.be/");

    assert.equal(loadConfig({ DATABASE_URL: DB }).auth0, null);
    assert.throws(
      () => loadConfig({ DATABASE_URL: DB, AUTH0_DOMAIN: "tenant.eu.auth0.com" }),
      /must be set together/,
    );
    assert.throws(
      () =>
        loadConfig({
          DATABASE_URL: DB,
          AUTH0_DOMAIN: "https://tenant.eu.auth0.com",
          AUTH0_AUDIENCE: "x",
        }),
      /AUTH0_DOMAIN/,
    );
  });

  test("error messages never contain configuration values", () => {
    assert.throws(
      () => loadConfig({ DATABASE_URL: DB, PORT: "not-a-port" }),
      (err: Error) => {
        assert.match(err.message, /PORT/);
        assert.doesNotMatch(err.message, /very-secret|db\.internal/);
        return true;
      },
    );
  });
});
