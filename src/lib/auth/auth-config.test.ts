import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readApiBaseUrl, readAuth0Config, sanitizeReturnTo } from "./auth-config.ts";

describe("readAuth0Config", () => {
  test("returns the public config when all VITE_AUTH0_* values are present", () => {
    assert.deepEqual(
      readAuth0Config({
        VITE_AUTH0_DOMAIN: "https://tenant.eu.auth0.com/",
        VITE_AUTH0_CLIENT_ID: "client-id",
        VITE_AUTH0_AUDIENCE: "https://api.autowascenter.be",
      }),
      {
        domain: "tenant.eu.auth0.com",
        clientId: "client-id",
        audience: "https://api.autowascenter.be",
      },
    );
  });

  test("returns null when anything is missing (admin UI shows a notice instead of crashing)", () => {
    assert.equal(readAuth0Config({}), null);
    assert.equal(
      readAuth0Config({ VITE_AUTH0_DOMAIN: "t.auth0.com", VITE_AUTH0_CLIENT_ID: "c" }),
      null,
    );
    assert.equal(
      readAuth0Config({
        VITE_AUTH0_DOMAIN: " ",
        VITE_AUTH0_CLIENT_ID: "c",
        VITE_AUTH0_AUDIENCE: "a",
      }),
      null,
    );
  });
});

describe("readApiBaseUrl", () => {
  test("defaults to the local API and strips trailing slashes", () => {
    assert.equal(readApiBaseUrl({}), "http://localhost:3001");
    assert.equal(
      readApiBaseUrl({ VITE_API_BASE_URL: "https://api.autowascenter.be/" }),
      "https://api.autowascenter.be",
    );
  });

  test("an explicitly empty value means same origin (production behind one reverse proxy)", () => {
    assert.equal(readApiBaseUrl({ VITE_API_BASE_URL: "" }), "");
    assert.equal(readApiBaseUrl({ VITE_API_BASE_URL: "   " }), "");
  });
});

describe("sanitizeReturnTo (no open redirects after login)", () => {
  test("keeps admin paths", () => {
    for (const path of ["/admin", "/admin/agenda", "/admin/reservaties"]) {
      assert.equal(sanitizeReturnTo(path), path);
    }
  });

  test("falls back to /admin for anything else", () => {
    for (const value of [
      undefined,
      42,
      "",
      "/",
      "//evil.example",
      "https://evil.example/admin",
      "/admin-login",
      "/administrator",
      "/admin/../contact",
      "/admin?next=//evil",
      "javascript:alert(1)",
    ]) {
      assert.equal(sanitizeReturnTo(value), "/admin", String(value));
    }
  });
});
