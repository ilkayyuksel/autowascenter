import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fetchAdminAccess, withBearer } from "./admin-access.ts";

const BASE = "http://api.test";
const ACCESS_TOKEN = "header.payload.signature";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch double that records the request and returns a fixed response. */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; headers: Headers }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return respond();
  }) as typeof fetch;
  return { impl, calls };
}

const getToken = async () => ACCESS_TOKEN;

describe("fetchAdminAccess", () => {
  test("requests an access token and sends it as a Bearer header to /api/admin/me", async () => {
    let tokenRequests = 0;
    const { impl, calls } = fakeFetch(() =>
      jsonResponse(200, { data: { sub: "auth0|1", permissions: ["admin:access"] } }),
    );
    const result = await fetchAdminAccess(
      async () => {
        tokenRequests++;
        return ACCESS_TOKEN;
      },
      { baseUrl: BASE, fetchImpl: impl },
    );
    assert.equal(tokenRequests, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, `${BASE}/api/admin/me`);
    assert.equal(calls[0]!.headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);
    assert.deepEqual(result, {
      status: "authorized",
      me: { sub: "auth0|1", permissions: ["admin:access"] },
    });
  });

  test("maps API responses: 401 → reauth, 403 → forbidden, 5xx → error", async () => {
    const cases: [number, string][] = [
      [401, "reauth"],
      [403, "forbidden"],
      [500, "error"],
      [503, "error"],
    ];
    for (const [status, expected] of cases) {
      const { impl } = fakeFetch(() =>
        jsonResponse(status, { error: { code: "X", message: "Y" } }),
      );
      assert.equal(
        (await fetchAdminAccess(getToken, { baseUrl: BASE, fetchImpl: impl })).status,
        expected,
      );
    }
  });

  test("a 200 without admin:access or with a malformed body is not treated as authorized", async () => {
    const noPermission = fakeFetch(() =>
      jsonResponse(200, { data: { sub: "a", permissions: [] } }),
    );
    assert.equal(
      (await fetchAdminAccess(getToken, { baseUrl: BASE, fetchImpl: noPermission.impl })).status,
      "forbidden",
    );
    for (const body of [{}, { data: { sub: 1 } }, "not json"]) {
      const { impl } = fakeFetch(
        () => new Response(typeof body === "string" ? body : JSON.stringify(body)),
      );
      assert.equal(
        (await fetchAdminAccess(getToken, { baseUrl: BASE, fetchImpl: impl })).status,
        "error",
      );
    }
  });

  test("token failures: login-required errors → reauth, others → error, and no API call", async () => {
    for (const code of [
      "login_required",
      "consent_required",
      "missing_refresh_token",
      "invalid_grant",
    ]) {
      const { impl, calls } = fakeFetch(() => jsonResponse(200, {}));
      const result = await fetchAdminAccess(
        async () => {
          throw Object.assign(new Error("x"), { error: code });
        },
        { baseUrl: BASE, fetchImpl: impl },
      );
      assert.equal(result.status, "reauth", code);
      assert.equal(calls.length, 0);
    }
    const { impl } = fakeFetch(() => jsonResponse(200, {}));
    const timeout = await fetchAdminAccess(
      async () => {
        throw Object.assign(new Error("Timeout"), { error: "timeout" });
      },
      { baseUrl: BASE, fetchImpl: impl },
    );
    assert.equal(timeout.status, "error");
    assert.equal(
      (await fetchAdminAccess(async () => undefined, { baseUrl: BASE, fetchImpl: impl })).status,
      "reauth",
    );
  });

  test("network failures and hanging requests settle as error (UI never loads forever)", async () => {
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    assert.equal(
      (await fetchAdminAccess(getToken, { baseUrl: BASE, fetchImpl: offline })).status,
      "error",
    );

    const hanging = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as typeof fetch;
    const started = Date.now();
    const result = await fetchAdminAccess(getToken, {
      baseUrl: BASE,
      fetchImpl: hanging,
      timeoutMs: 50,
    });
    assert.equal(result.status, "error");
    assert.ok(Date.now() - started < 2_000);
  });
});

describe("withBearer", () => {
  test("adds the Authorization header and keeps existing headers", () => {
    const headers = withBearer("abc", { Accept: "application/json" });
    assert.equal(headers.get("authorization"), "Bearer abc");
    assert.equal(headers.get("accept"), "application/json");
  });
});
