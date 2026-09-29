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
    });
    assert.equal(ok.isProduction, true);
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
