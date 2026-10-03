// Browser end-to-end tests against the RUNNING Docker stack (deploy/docker-compose.yml).
// They drive a real browser (the installed Edge/Chrome through playwright-core, so no
// browser downloads) over HTTPS via Caddy, exactly as a visitor would.
//
//   cd deploy && docker compose up -d
//   npm run test:e2e                     # or E2E_BASE_URL=https://example.com npm run test:e2e
//
// The suite skips when the stack is unreachable, so `npm test` and CI stay green.
//
// SCOPE: the public site, the admin route guard and the responsive sanity check. The
// authenticated admin pages need a real Auth0 tenant and login credentials; without those
// the browser cannot get past Universal Login, and this suite deliberately does NOT fake
// the login. Those flows are covered at API + database level by
// apps/api/test/admin-e2e.integration.test.ts and are reported as NOT RUN for the browser.

import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import {
  chromium,
  type Browser,
  type ConsoleMessage,
  type Page,
  type Request,
} from "playwright-core";

const BASE_URL = (process.env.E2E_BASE_URL ?? "https://localhost").replace(/\/+$/, "");
/** Edge ships with Windows, Chrome is the fallback; both avoid a browser download. */
const CHANNELS = (process.env.E2E_BROWSER_CHANNEL ?? "msedge,chrome").split(",");

// Hosts/paths a production page must never request. Checked for everything the page
// fetches ITSELF -- scripts, styles, XHR/fetch -- i.e. anything that would mean a legacy
// integration is still wired into the code.
//
// Images are judged separately (ALLOW_EXTERNAL_IMAGE below), because an `image_url` row
// in the database may legitimately still point at Supabase Storage: phase 7A decided
// deliberately NOT to rewrite historical gallery URLs. Such a URL is data, not code.
const FORBIDDEN = [
  /supabase\.co/i,
  /lovable\.(app|dev)|lovableproject/i,
  /r2\.dev/i,
  /workers\.dev/i,
  /localhost:300[01]/i,
  /127\.0\.0\.1:300[01]/i,
  /\/\/api:3001/i,
  /\/api\/api\//,
];

// Misconfiguration, never data: these are wrong whatever the resource type is.
const FORBIDDEN_FOR_IMAGES_TOO = [/localhost:300[01]/i, /127\.0\.0\.1:300[01]/i, /\/api\/api\//];

/** A legacy gallery image stored as an absolute external URL (see FORBIDDEN). */
const ALLOW_EXTERNAL_IMAGE = /^https?:\/\/(?!localhost)/i;

// Node rejects Caddy's internal CA; the browser contexts get ignoreHTTPSErrors instead.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function reachable() {
  try {
    const res = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function launch(): Promise<Browser | null> {
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* try the next channel */
    }
  }
  return null;
}

// The probe runs at module load, because node:test needs the `skip` value when it
// evaluates the describe() calls below -- not later, from a before() hook.
let browser: Browser | null = null;
let skip: string | false = false;
if (await reachable()) {
  browser = await launch();
  if (!browser) skip = `no usable browser (tried: ${CHANNELS.join(", ")})`;
} else {
  skip = `${BASE_URL} is not reachable -- start the stack: cd deploy && docker compose up -d`;
}

after(async () => {
  await browser?.close();
});

interface Requested {
  url: string;
  resourceType: string;
}

interface Observed {
  page: Page;
  consoleErrors: string[];
  pageErrors: string[];
  requests: Requested[];
  /** Requests that never completed, e.g. a dead legacy image host. */
  failed: { url: string; resourceType: string; error: string }[];
}

/** A fresh page that records console errors, uncaught exceptions and every request URL. */
async function observe(viewport = { width: 1280, height: 900 }): Promise<Observed> {
  const context = await browser!.newContext({ ignoreHTTPSErrors: true, viewport });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requests: Requested[] = [];
  const failed: Observed["failed"] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") consoleErrors.push(`${m.text()} @ ${m.location().url}`);
  });
  page.on("pageerror", (e: Error) => pageErrors.push(e.message));
  page.on("request", (r: Request) =>
    requests.push({ url: r.url(), resourceType: r.resourceType() }),
  );
  page.on("requestfailed", (r: Request) =>
    failed.push({
      url: r.url(),
      resourceType: r.resourceType(),
      error: r.failure()?.errorText ?? "unknown",
    }),
  );
  return { page, consoleErrors, pageErrors, requests, failed };
}

function assertNoForbiddenRequests(requests: Requested[], where: string) {
  for (const { url, resourceType } of requests) {
    const patterns = resourceType === "image" ? FORBIDDEN_FOR_IMAGES_TOO : FORBIDDEN;
    for (const pattern of patterns) {
      assert.ok(!pattern.test(url), `${where}: forbidden request ${url} (${pattern})`);
    }
  }
}

function assertClean(o: Observed, where: string) {
  assert.deepEqual(o.pageErrors, [], `${where}: uncaught exceptions`);
  assertNoForbiddenRequests(o.requests, where);

  // Nothing the application itself serves may fail to load.
  const firstPartyFailures = o.failed.filter((f) => f.url.startsWith(`${BASE_URL}/`));
  assert.deepEqual(firstPartyFailures, [], `${where}: first-party resources failed to load`);

  // A dead legacy image host produces a browser-level "Failed to load resource" line.
  // Ignore exactly those; every other console error is a real defect.
  const deadExternalImages = new Set(
    o.failed
      .filter((f) => f.resourceType === "image" && ALLOW_EXTERNAL_IMAGE.test(f.url))
      .map((f) => f.url),
  );
  const realErrors = o.consoleErrors.filter(
    (text) => ![...deadExternalImages].some((url) => text.includes(url)),
  );
  assert.deepEqual(realErrors, [], `${where}: console errors`);
}

const PUBLIC_PAGES = [
  { path: "/", heading: /Autowascenter|detailing/i, expectsApi: true },
  { path: "/diensten", heading: /Detailing op maat/i, expectsApi: true },
  { path: "/galerij", heading: /Onze realisaties/i, expectsApi: true },
  { path: "/over-ons", heading: /./, expectsApi: false },
  { path: "/contact", heading: /./, expectsApi: false },
  { path: "/reservatie", heading: /Maak een afspraak/i, expectsApi: true },
];

describe("browser: public site", { skip }, () => {
  for (const { path, heading, expectsApi } of PUBLIC_PAGES) {
    test(`${path} renders, calls only the same-origin API and logs no errors`, async () => {
      const o = await observe();
      try {
        const res = await o.page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
        assert.equal(res?.status(), 200, path);
        assert.match(await o.page.content(), heading, `${path}: expected content`);
        assertClean(o, path);
        if (expectsApi) {
          const apiCalls = o.requests.filter((r) => r.url.startsWith(`${BASE_URL}/api/`));
          assert.ok(apiCalls.length > 0, `${path}: expected a same-origin /api/ request`);
        }
      } finally {
        await o.page.context().close();
      }
    });
  }

  test("the catalogue the admin manages is what the public site shows", async () => {
    const o = await observe();
    try {
      await o.page.goto(`${BASE_URL}/diensten`, { waitUntil: "networkidle" });
      const body = await o.page.content();
      const fromApi = (await (await fetch(`${BASE_URL}/api/services`)).json()) as {
        data: { title: string }[];
      };
      assert.ok(fromApi.data.length > 0, "seed data expected");
      for (const service of fromApi.data) {
        assert.ok(body.includes(service.title), `/diensten should show "${service.title}"`);
      }
    } finally {
      await o.page.context().close();
    }
  });
});

describe("browser: admin route guard without a login", { skip }, () => {
  test("/admin never shows admin data and never receives an authorised API response", async () => {
    const o = await observe();
    const adminResponses: { url: string; status: number }[] = [];
    o.page.on("response", (r) => {
      if (r.url().includes("/api/admin/"))
        adminResponses.push({ url: r.url(), status: r.status() });
    });
    try {
      await o.page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });
      // The guard either redirects to /admin-login or shows a notice; it must never render
      // the admin shell.
      await o.page.waitForTimeout(2500);
      const body = await o.page.content();
      assert.ok(
        !/Welkom terug|Omzet deze week|Open agenda/.test(body),
        "the dashboard must not render without a session",
      );
      // Every admin API call the browser managed to make must have been refused.
      for (const r of adminResponses) {
        assert.ok(r.status === 401 || r.status === 403, `${r.url} answered ${r.status}`);
      }
      assertNoForbiddenRequests(o.requests, "/admin");
    } finally {
      await o.page.context().close();
    }
  });

  test("/admin-login renders without uncaught exceptions", async () => {
    const o = await observe();
    try {
      const res = await o.page.goto(`${BASE_URL}/admin-login`, { waitUntil: "domcontentloaded" });
      assert.equal(res?.status(), 200);
      await o.page.waitForTimeout(1500);
      assert.deepEqual(o.pageErrors, [], "/admin-login: uncaught exceptions");
      assertNoForbiddenRequests(o.requests, "/admin-login");
    } finally {
      await o.page.context().close();
    }
  });
});

describe("browser: public booking flow (UI → API → PostgreSQL)", { skip }, () => {
  test("a visitor can complete the wizard and gets the server's confirmation", async () => {
    const o = await observe();
    const { page } = o;
    const next = () => page.getByRole("button", { name: /Volgende/ }).click();
    try {
      await page.goto(`${BASE_URL}/reservatie`, { waitUntil: "networkidle" });

      // Step 1: vehicle type (loaded from GET /api/vehicle-types).
      await page.getByRole("button", { name: /Personenwagen/ }).click();
      await next();

      // Step 2: one bookable service (an extra alone is not enough).
      // Anchored: the package's description mentions this service too.
      await page.getByRole("button", { name: /^Handwas buiten/ }).click();
      await next();
      await next(); // step 3: no extras

      // Step 4: date + a slot offered by GET /api/availability.
      const date = process.env.E2E_BOOKING_DATE ?? "2026-11-10";
      await page.locator("#date").fill(date);
      // Whatever slot the server offers first -- a fixed time would be taken by the booking
      // an earlier run of this test created, since the stack's database persists.
      const slot = page.getByRole("button", { name: /ophalen/ }).first();
      await slot.waitFor({ state: "visible", timeout: 20000 });
      const chosen = ((await slot.innerText()).match(/\d{2}:\d{2}/) ?? [""])[0];
      assert.match(chosen, /^\d{2}:\d{2}$/, "expected a slot time on the button");
      await slot.click();
      await next();

      // Step 5: customer details.
      await page.locator("#customer_name").fill("E2E Browsertest");
      await page.locator("#customer_phone").fill("0470000001");
      await page.locator("#customer_email").fill("e2e-browser@example.test");
      await page.locator("#vehicle_brand").fill("Volvo");
      await page.locator("#vehicle_model").fill("V60");
      await next();

      // Step 6: confirm.
      await page.getByRole("button", { name: /Bevestig reservatie/ }).click();
      await page.getByText(/Bedankt voor uw reservatie/).waitFor({ timeout: 20000 });

      const body = await page.content();
      // The confirmation shows the SERVER's values (reference, pickup, total incl. VAT).
      assert.match(body, /Referentie/, "confirmation should show the booking reference");
      assert.ok(body.includes(chosen), `confirmation should show the chosen slot ${chosen}`);
      assert.match(body, /Totaal incl\. btw/, "confirmation should show the server total");
      assert.match(body, /€\s?\d/, "confirmation should show an amount");
      assertClean(o, "/reservatie booking flow");
    } finally {
      await o.page.context().close();
    }
  });
});

describe("browser: responsive sanity", { skip }, () => {
  const MOBILE = { width: 375, height: 667 };
  for (const path of ["/", "/diensten", "/galerij", "/reservatie", "/admin-login"]) {
    test(`${path} has no horizontal overflow at 375px`, async () => {
      const o = await observe(MOBILE);
      try {
        await o.page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
        const overflow = await o.page.evaluate(() => {
          const d = document.documentElement;
          return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
        });
        assert.ok(
          overflow.scrollWidth <= overflow.clientWidth + 1,
          `${path}: horizontal overflow (${overflow.scrollWidth} > ${overflow.clientWidth})`,
        );
        assert.deepEqual(o.pageErrors, [], `${path}: uncaught exceptions on mobile`);
      } finally {
        await o.page.context().close();
      }
    });
  }
});
