import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ApiError, CLIENT_ERROR } from "./client.ts";
import {
  describeApiError,
  isAborted,
  SESSION_RECHECK_INTERVAL_MS,
  shouldRecheckSession,
} from "./errors.ts";

describe("describeApiError (what the admin UI shows)", () => {
  test("401 → reauth (the guard handles the login), not retryable", () => {
    const v = describeApiError(new ApiError(401, "AUTHENTICATION_INVALID", "x"));
    assert.equal(v.kind, "reauth");
    assert.equal(v.retryable, false);
  });

  test("403 → 'Geen toegang'", () => {
    const v = describeApiError(new ApiError(403, "AUTHORIZATION_REQUIRED", "x"));
    assert.equal(v.kind, "forbidden");
    assert.equal(v.title, "Geen toegang");
  });

  test("503, network, timeout, token unavailable → temporary, retryable", () => {
    for (const e of [
      new ApiError(503, "DATABASE_UNAVAILABLE", "x"),
      new ApiError(503, "AUTHENTICATION_UNAVAILABLE", "x"),
      new ApiError(0, CLIENT_ERROR.NETWORK, "x"),
      new ApiError(0, CLIENT_ERROR.TIMEOUT, "x"),
      new ApiError(0, CLIENT_ERROR.TOKEN_UNAVAILABLE, "x"),
    ]) {
      const v = describeApiError(e);
      assert.equal(v.kind, "unavailable", e.code);
      assert.equal(v.retryable, true);
    }
  });

  test("500 SETTINGS_NOT_CONFIGURED → configuration error; other 500 → generic", () => {
    const v = describeApiError(new ApiError(500, "SETTINGS_NOT_CONFIGURED", "x"));
    assert.equal(v.kind, "not_configured");
    assert.equal(v.retryable, false);
    assert.equal(describeApiError(new ApiError(500, "INTERNAL_ERROR", "x")).kind, "generic");
  });

  test("404, invalid response, unknown errors", () => {
    assert.equal(describeApiError(new ApiError(404, "RESOURCE_NOT_FOUND", "x")).kind, "not_found");
    assert.equal(
      describeApiError(new ApiError(200, CLIENT_ERROR.INVALID_RESPONSE, "x")).kind,
      "invalid",
    );
    assert.equal(describeApiError(new Error("boom")).kind, "generic");
    assert.equal(describeApiError(undefined).kind, "generic");
  });

  test("backend messages are never shown", () => {
    const v = describeApiError(
      new ApiError(500, "INTERNAL_ERROR", "SELECT * FROM bookings failed"),
    );
    assert.doesNotMatch(`${v.title} ${v.message}`, /SELECT|bookings failed/);
  });

  test("isAborted only for caller aborts", () => {
    assert.equal(isAborted(new ApiError(0, CLIENT_ERROR.ABORTED, "x")), true);
    assert.equal(isAborted(new ApiError(0, CLIENT_ERROR.TIMEOUT, "x")), false);
  });
});

describe("shouldRecheckSession (no 401 loops)", () => {
  test("first time yes, then only after the interval", () => {
    assert.equal(shouldRecheckSession(null, 1_000), true);
    assert.equal(shouldRecheckSession(1_000, 1_000 + SESSION_RECHECK_INTERVAL_MS - 1), false);
    assert.equal(shouldRecheckSession(1_000, 1_000 + SESSION_RECHECK_INTERVAL_MS), true);
  });
});
