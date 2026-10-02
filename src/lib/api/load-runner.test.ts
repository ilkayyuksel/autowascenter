import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ApiError, CLIENT_ERROR, createApiClient, type ResponseSchema } from "./client.ts";
import { createLoadRunner, type LoadState } from "./load-runner.ts";
import { BASE, hangingFetch } from "./test-fixtures.ts";

function setup() {
  const states: LoadState["status"][] = [];
  let unauthorized = 0;
  const runner = createLoadRunner({
    onState: (s) => states.push(s.status),
    onUnauthorized: () => unauthorized++,
  });
  return { runner, states, unauthorized: () => unauthorized };
}

describe("createLoadRunner (admin page load states)", () => {
  test("loading → success, data applied", async () => {
    const { runner, states } = setup();
    let applied: string | null = null;
    assert.equal(
      await runner.run(
        async () => "data",
        (d) => (applied = d),
      ),
      true,
    );
    assert.equal(applied, "data");
    assert.deepEqual(states, ["loading", "success"]);
  });

  test("empty data is a success (the page shows its empty state)", async () => {
    const { runner, states } = setup();
    let applied: unknown[] | null = null;
    await runner.run(
      async () => [],
      (d) => (applied = d),
    );
    assert.deepEqual(applied, []);
    assert.deepEqual(states, ["loading", "success"]);
  });

  test("401 → error state and the guard is notified; 403/5xx → error only", async () => {
    const { runner, states, unauthorized } = setup();
    await runner.run(
      async () => {
        throw new ApiError(401, "AUTHENTICATION_INVALID", "x");
      },
      () => assert.fail("must not apply"),
    );
    assert.deepEqual(states, ["loading", "error"]);
    assert.equal(unauthorized(), 1);

    for (const status of [403, 500, 503]) {
      await runner.run(
        async () => {
          throw new ApiError(status, "X", "x");
        },
        () => assert.fail("must not apply"),
      );
    }
    assert.equal(unauthorized(), 1);
    assert.equal(states.at(-1), "error");
  });

  test("a stale result (newer load started) is never applied", async () => {
    const { runner } = setup();
    let release!: (v: string) => void;
    const slow = runner.run(
      () => new Promise<string>((resolve) => (release = resolve)),
      () => assert.fail("stale data applied"),
    );
    let applied: string | null = null;
    await runner.run(
      async () => "new",
      (d) => (applied = d),
    );
    release("old");
    assert.equal(await slow, false);
    assert.equal(applied, "new");
  });

  test("the previous request is aborted and its abort is not shown as an error", async () => {
    const { runner, states } = setup();
    const api = createApiClient({ baseUrl: BASE, fetchImpl: hangingFetch, timeoutMs: 5_000 });
    const schema: ResponseSchema<unknown> = { safeParse: (v) => ({ success: true, data: v }) };
    const first = runner.run(
      (signal) => api.get("/api/x", schema, { signal }),
      () => {},
    );
    await runner.run(
      async () => "second",
      () => {},
    );
    assert.equal(await first, false);
    assert.equal(states.at(-1), "success");
    assert.ok(!states.slice(1).includes("error"));
  });

  test("cancel (unmount) ignores the running load", async () => {
    const { runner, states } = setup();
    let release!: (v: string) => void;
    const pending = runner.run(
      () => new Promise<string>((resolve) => (release = resolve)),
      () => assert.fail("applied after unmount"),
    );
    runner.cancel();
    release("late");
    assert.equal(await pending, false);
    assert.deepEqual(states, ["loading"]);
  });

  test("a hanging API never leaves the page loading: timeout → error", async () => {
    const { runner, states } = setup();
    const api = createApiClient({ baseUrl: BASE, fetchImpl: hangingFetch, timeoutMs: 20 });
    const schema: ResponseSchema<unknown> = { safeParse: (v) => ({ success: true, data: v }) };
    await runner.run(
      (signal) => api.get("/api/x", schema, { signal }),
      () => {},
    );
    assert.deepEqual(states, ["loading", "error"]);
  });

  test("timeout error carries the TIMEOUT code", async () => {
    let captured: LoadState | null = null;
    const runner = createLoadRunner({ onState: (s) => (captured = s), onUnauthorized: () => {} });
    const api = createApiClient({ baseUrl: BASE, fetchImpl: hangingFetch, timeoutMs: 20 });
    const schema: ResponseSchema<unknown> = { safeParse: (v) => ({ success: true, data: v }) };
    await runner.run(
      (signal) => api.get("/api/x", schema, { signal }),
      () => {},
    );
    const state = captured as LoadState | null;
    assert.ok(state && state.status === "error");
    assert.equal((state.error as ApiError).code, CLIENT_ERROR.TIMEOUT);
  });
});
