import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  ApiError,
  buildUrl,
  CLIENT_ERROR,
  createApiClient,
  type ResponseSchema,
} from "./client.ts";
import {
  ACCESS_TOKEN,
  apiError,
  BASE,
  fakeFetch,
  hangingFetch,
  jsonResponse,
} from "./test-fixtures.ts";

/** Minimal schema: `{ data: { ok: true } }`. */
const okSchema: ResponseSchema<{ data: { ok: true } }> = {
  safeParse: (v) => {
    const ok = (v as { data?: { ok?: unknown } } | null)?.data?.ok === true;
    return ok ? { success: true, data: v as { data: { ok: true } } } : { success: false };
  },
};
const OK = { data: { ok: true } };

function client(respond: (url: string) => Response | Promise<Response>, extra = {}) {
  const fetch = fakeFetch(respond);
  let tokenRequests = 0;
  const api = createApiClient({
    baseUrl: `${BASE}/`,
    fetchImpl: fetch.impl,
    getAccessToken: async () => {
      tokenRequests++;
      return ACCESS_TOKEN;
    },
    ...extra,
  });
  return { api, calls: fetch.calls, tokenRequests: () => tokenRequests };
}

async function rejectsWith(promise: Promise<unknown>, status: number, code: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof ApiError, "ApiError expected");
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return true;
  });
}

// Every console method is watched: the client must never log (tokens, headers, URLs).
const logged: string[] = [];
const originals = new Map<string, (...args: unknown[]) => void>();
before(() => {
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    originals.set(m, console[m]);
    console[m] = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  }
});
after(() => {
  for (const [m, fn] of originals) (console as unknown as Record<string, unknown>)[m] = fn;
  assert.deepEqual(logged, [], "the API client logged something");
});

describe("buildUrl", () => {
  test("joins base and path, encodes query, repeats arrays, skips null/undefined", () => {
    assert.equal(buildUrl("http://a.test/", "/api/x"), "http://a.test/api/x");
    assert.equal(buildUrl("http://a.test", "api/x"), "http://a.test/api/x");
    assert.equal(
      buildUrl("http://a.test", "/api/x", {
        page: 2,
        q: "a b&c",
        ids: ["1", "2"],
        none: null,
        u: undefined,
      }),
      "http://a.test/api/x?page=2&q=a+b%26c&ids=1&ids=2",
    );
  });
});

describe("createApiClient", () => {
  test("uses the configured base URL (VITE_API_BASE_URL) and parses JSON", async () => {
    const { api, calls } = client(() => jsonResponse(200, OK));
    assert.deepEqual(await api.get("/api/services", okSchema), OK);
    assert.equal(calls[0]!.url, `${BASE}/api/services`);
    assert.equal(calls[0]!.method, "GET");
    assert.equal(calls[0]!.headers.get("accept"), "application/json");
  });

  test("public request: no token is requested and no Authorization header is sent", async () => {
    const { api, calls, tokenRequests } = client(() => jsonResponse(200, OK));
    await api.get("/api/services", okSchema);
    assert.equal(tokenRequests(), 0);
    assert.equal(calls[0]!.headers.has("authorization"), false);
  });

  test("admin request: access token from the provider as Bearer header", async () => {
    const { api, calls, tokenRequests } = client(() => jsonResponse(200, OK));
    await api.getAdmin("/api/admin/dashboard", okSchema, { query: { page: 1 } });
    assert.equal(tokenRequests(), 1);
    assert.equal(calls[0]!.url, `${BASE}/api/admin/dashboard?page=1`);
    assert.equal(calls[0]!.headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);
  });

  test("maps backend errors { error: { code, message } } to ApiError", async () => {
    const cases: [number, string][] = [
      [400, "VALIDATION_ERROR"],
      [401, "AUTHENTICATION_INVALID"],
      [403, "AUTHORIZATION_REQUIRED"],
      [404, "RESOURCE_NOT_FOUND"],
      [409, "RESOURCE_CONFLICT"],
      [500, "INTERNAL_ERROR"],
      [503, "DATABASE_UNAVAILABLE"],
    ];
    for (const [status, code] of cases) {
      const { api } = client(() => apiError(status, code));
      await rejectsWith(api.getAdmin("/api/admin/x", okSchema), status, code);
    }
  });

  test("errors without the backend shape still become a typed ApiError", async () => {
    const { api } = client(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    await rejectsWith(api.getAdmin("/api/admin/x", okSchema), 502, "HTTP_502");
    const { api: api2 } = client(() => jsonResponse(500, { message: "x" }));
    await rejectsWith(api2.getAdmin("/api/admin/x", okSchema), 500, "HTTP_500");
  });

  test("malformed JSON or a body that does not match the contract → INVALID_RESPONSE", async () => {
    const { api } = client(() => new Response("{not json", { status: 200 }));
    await rejectsWith(api.getAdmin("/api/admin/x", okSchema), 200, CLIENT_ERROR.INVALID_RESPONSE);
    const { api: api2 } = client(() => jsonResponse(200, { data: { ok: "yes" } }));
    await rejectsWith(api2.getAdmin("/api/admin/x", okSchema), 200, CLIENT_ERROR.INVALID_RESPONSE);
  });

  test("the UI never receives the raw backend message for unknown shapes", async () => {
    const { api } = client(() => new Response("stack trace at db.query", { status: 500 }));
    await assert.rejects(api.getAdmin("/api/admin/x", okSchema), (err: ApiError) => {
      assert.doesNotMatch(err.message, /stack trace/);
      return true;
    });
  });

  test("timeout: a hanging request settles as TIMEOUT", async () => {
    const api = createApiClient({ baseUrl: BASE, fetchImpl: hangingFetch, timeoutMs: 30 });
    const started = Date.now();
    await rejectsWith(api.get("/api/x", okSchema), 0, CLIENT_ERROR.TIMEOUT);
    assert.ok(Date.now() - started < 2_000);
  });

  test("network failure → NETWORK_ERROR; caller abort → ABORTED", async () => {
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: BASE, fetchImpl: offline });
    await rejectsWith(api.get("/api/x", okSchema), 0, CLIENT_ERROR.NETWORK);

    const aborting = createApiClient({ baseUrl: BASE, fetchImpl: hangingFetch, timeoutMs: 5_000 });
    const controller = new AbortController();
    const pending = aborting.get("/api/x", okSchema, { signal: controller.signal });
    controller.abort();
    await rejectsWith(pending, 0, CLIENT_ERROR.ABORTED);
  });

  test("token problems: no API call; login-required → 401, other failures → TOKEN_UNAVAILABLE", async () => {
    for (const [getAccessToken, status, code] of [
      [
        async () => {
          throw Object.assign(new Error("x"), { error: "login_required" });
        },
        401,
        CLIENT_ERROR.SESSION_EXPIRED,
      ],
      [
        async () => {
          throw Object.assign(new Error("x"), { error: "missing_refresh_token" });
        },
        401,
        CLIENT_ERROR.SESSION_EXPIRED,
      ],
      [async () => undefined, 401, CLIENT_ERROR.SESSION_EXPIRED],
      [
        async () => {
          throw Object.assign(new Error("Timeout"), { error: "timeout" });
        },
        0,
        CLIENT_ERROR.TOKEN_UNAVAILABLE,
      ],
    ] as const) {
      const { impl, calls } = fakeFetch(() => jsonResponse(200, OK));
      const api = createApiClient({ baseUrl: BASE, fetchImpl: impl, getAccessToken });
      await rejectsWith(api.getAdmin("/api/admin/x", okSchema), status, code);
      assert.equal(calls.length, 0);
    }
    const noProvider = createApiClient({
      baseUrl: BASE,
      fetchImpl: fakeFetch(() => jsonResponse(200, OK)).impl,
    });
    await rejectsWith(
      noProvider.getAdmin("/api/admin/x", okSchema),
      0,
      CLIENT_ERROR.TOKEN_UNAVAILABLE,
    );
  });

  test("the access token never appears in error messages", async () => {
    for (const respond of [
      () => apiError(401, "AUTHENTICATION_INVALID"),
      () => new Response("x", { status: 500 }),
    ]) {
      const { api } = client(respond);
      await assert.rejects(api.getAdmin("/api/admin/x", okSchema), (err: ApiError) => {
        assert.ok(!err.message.includes(ACCESS_TOKEN));
        assert.ok(!String(err.stack).includes(ACCESS_TOKEN));
        return true;
      });
    }
  });
});
