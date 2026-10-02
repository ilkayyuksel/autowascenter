import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ApiError, CLIENT_ERROR } from "./client.ts";
import { runMutation } from "./mutation.ts";

describe("runMutation (admin writes: no optimistic updates, fixed error texts)", () => {
  test("success returns the API response", async () => {
    let unauthorized = 0;
    const result = await runMutation(async () => ({ id: "x" }), {
      onUnauthorized: () => unauthorized++,
    });
    assert.deepEqual(result, { ok: true, data: { id: "x" } });
    assert.equal(unauthorized, 0);
  });

  test("401 notifies the admin guard (login flow); 403/409 do not", async () => {
    let unauthorized = 0;
    const onUnauthorized = () => unauthorized++;
    const r401 = await runMutation(
      async () => {
        throw new ApiError(401, "AUTHENTICATION_INVALID", "x");
      },
      { onUnauthorized },
    );
    assert.ok(!r401.ok && r401.view.kind === "reauth");
    for (const [status, code] of [
      [403, "AUTHORIZATION_REQUIRED"],
      [409, "RESOURCE_CONFLICT"],
    ] as const) {
      await runMutation(
        async () => {
          throw new ApiError(status, code, "x");
        },
        { onUnauthorized },
      );
    }
    assert.equal(unauthorized, 1);
  });

  test("timeout on a write: outcome unknown → refresh the data", async () => {
    const r = await runMutation(
      async () => {
        throw new ApiError(0, CLIENT_ERROR.TIMEOUT, "x");
      },
      { onUnauthorized: () => {} },
    );
    assert.ok(!r.ok && r.view.kind === "unknown_outcome" && r.view.refresh);
  });

  test("stale-data conflicts ask for a refresh; database details are never shown", async () => {
    const r = await runMutation(
      async () => {
        throw new ApiError(
          409,
          "BOOKING_SLOT_UNAVAILABLE",
          "conflicting key value violates exclusion constraint",
        );
      },
      { onUnauthorized: () => {} },
    );
    assert.ok(!r.ok && r.view.refresh);
    assert.ok(!r.ok && !r.view.message.includes("constraint"));
  });
});
