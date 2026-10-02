// Public READ functions (no token): endpoint, query, contract validation, empty data,
// 400/404/500/503, malformed responses and timeouts. No real API, no Auth0.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ApiError, CLIENT_ERROR, createApiClient, type ApiClient } from "./client.ts";
import {
  getPublicAvailability,
  getPublicGallery,
  getPublicReviews,
  getPublicServices,
  getPublicSiteSettings,
  getPublicVehicleTypes,
  getPublicVehicleTypeServices,
  withFallback,
} from "./public-reads.ts";
import { apiError, BASE, fakeFetch, hangingFetch, ID, jsonResponse } from "./test-fixtures.ts";

function apiWith(respond: (url: string) => Response, baseUrl = BASE) {
  const fetch = fakeFetch(respond);
  // Public client: no token provider at all.
  return { api: createApiClient({ baseUrl, fetchImpl: fetch.impl }), calls: fetch.calls };
}

const service = {
  id: ID.service,
  title: "Buitenwas",
  description: null,
  category: "Exterieur",
  badge: "Populair",
  icon: "sparkles",
  image_url: null,
  bookable: true,
  kind: "dienst",
  price: 25,
  duration_minutes: 60,
};
const galleryItem = {
  id: ID.gallery,
  title: "Polijstbeurt",
  description: null,
  image_url: "https://abcd.supabase.co/storage/v1/object/public/gallery/old.jpg",
  before_image_url: null,
  category: "Exterieur",
};
const review = { id: ID.line, customer_name: "An", rating: 5, content: "Top!" };
const vehicleType = {
  id: ID.vehicle,
  slug: "personenwagen",
  title: "Personenwagen",
  description: null,
  image_url: null,
};
const option = {
  id: ID.vts,
  service_id: ID.pkg,
  title: "Full detail",
  description: null,
  category: null,
  badge: null,
  kind: "pakket",
  price: 150,
  duration_minutes: 240,
  includes: ["Buitenwas", "Interieur"],
};
const availability = {
  data: {
    date: "2026-10-05",
    vehicle_type_id: ID.vehicle,
    total_duration_minutes: 240,
    slots: [
      {
        time: "10:00",
        start_at: "2026-10-05T08:00:00.000Z",
        end_at: "2026-10-05T12:00:00.000Z",
        pickup_date: "2026-10-05",
        pickup_time: "14:00",
      },
    ],
  },
};

interface Case {
  name: string;
  load: (api: ApiClient, signal?: AbortSignal) => Promise<unknown>;
  url: string;
  body: { data: unknown };
  malformed: unknown;
  empty?: { data: unknown };
}

const CASES: Case[] = [
  {
    name: "services",
    load: (api, signal) => getPublicServices(api, { limit: 4, signal }),
    url: `${BASE}/api/services?limit=4`,
    body: { data: [service] },
    malformed: { data: [{ ...service, kind: "onbekend" }] },
    empty: { data: [] },
  },
  {
    name: "gallery",
    load: (api, signal) => getPublicGallery(api, { signal }),
    url: `${BASE}/api/gallery`,
    body: { data: [galleryItem] },
    malformed: { data: [{ ...galleryItem, image_url: null }] },
    empty: { data: [] },
  },
  {
    name: "reviews",
    load: (api, signal) => getPublicReviews(api, { limit: 6, signal }),
    url: `${BASE}/api/reviews?limit=6`,
    body: { data: [review] },
    malformed: { data: [{ ...review, rating: 9 }] },
    empty: { data: [] },
  },
  {
    name: "vehicle types",
    load: (api, signal) => getPublicVehicleTypes(api, { signal }),
    url: `${BASE}/api/vehicle-types`,
    body: { data: [vehicleType] },
    malformed: { data: [{ ...vehicleType, id: "not-a-uuid" }] },
    empty: { data: [] },
  },
  {
    name: "vehicle type services",
    load: (api, signal) => getPublicVehicleTypeServices(api, ID.vehicle, { signal }),
    url: `${BASE}/api/vehicle-types/${ID.vehicle}/services`,
    body: { data: [option] },
    malformed: { data: [{ ...option, price: "150" }] },
    empty: { data: [] },
  },
  {
    name: "availability",
    load: (api, signal) =>
      getPublicAvailability(
        api,
        { date: "2026-10-05", vehicle_type_id: ID.vehicle, service_ids: [ID.pkg, ID.service] },
        { signal },
      ),
    url: `${BASE}/api/availability?date=2026-10-05&vehicle_type_id=${ID.vehicle}&service_ids=${ID.pkg}%2C${ID.service}`,
    body: availability,
    malformed: { data: { ...availability.data, slots: [{ time: "25:00" }] } },
    empty: { data: { ...availability.data, slots: [] } },
  },
  {
    name: "site settings",
    load: (api, signal) => getPublicSiteSettings(api, { signal }),
    url: `${BASE}/api/site-settings`,
    body: { data: { km_fee: 0.75, free_km: 15 } },
    // The strict public contract rejects any admin field that would appear.
    malformed: { data: { km_fee: 0.75, free_km: 15, notification_email: "admin@x.test" } },
  },
];

for (const c of CASES) {
  describe(`public ${c.name}`, () => {
    test("success: correct URL, no Authorization header, validated data", async () => {
      const { api, calls } = apiWith(() => jsonResponse(200, c.body));
      const data = await c.load(api);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.url, c.url);
      assert.equal(calls[0]!.method, "GET");
      assert.equal(calls[0]!.headers.has("authorization"), false);
      assert.deepEqual(data, c.body.data);
    });

    if (c.empty) {
      const empty = c.empty;
      test("empty response", async () => {
        const { api } = apiWith(() => jsonResponse(200, empty));
        assert.deepEqual(await c.load(api), empty.data);
      });
    }

    test("400, 404, 500, 503 → typed ApiError", async () => {
      for (const [status, code] of [
        [400, "VALIDATION_ERROR"],
        [404, "VEHICLE_TYPE_NOT_FOUND"],
        [500, "INTERNAL_ERROR"],
        [503, "DATABASE_UNAVAILABLE"],
      ] as const) {
        const { api } = apiWith(() => apiError(status, code));
        await assert.rejects(
          c.load(api),
          (e: unknown) => e instanceof ApiError && e.status === status && e.code === code,
        );
      }
    });

    test("malformed response → INVALID_RESPONSE", async () => {
      for (const respond of [
        () => jsonResponse(200, c.malformed),
        () => new Response("<html>", { status: 200 }),
      ]) {
        const { api } = apiWith(respond);
        await assert.rejects(
          c.load(api),
          (e: unknown) => e instanceof ApiError && e.code === CLIENT_ERROR.INVALID_RESPONSE,
        );
      }
    });

    test("timeout → settles as TIMEOUT (never hangs)", async () => {
      const api = createApiClient({ baseUrl: BASE, fetchImpl: hangingFetch, timeoutMs: 20 });
      await assert.rejects(
        c.load(api),
        (e: unknown) => e instanceof ApiError && e.code === CLIENT_ERROR.TIMEOUT,
      );
    });
  });
}

describe("public reads: details", () => {
  test("availability query is validated before sending (no services → no request)", async () => {
    const { api, calls } = apiWith(() => jsonResponse(200, availability));
    await assert.rejects(
      getPublicAvailability(api, {
        date: "2026-10-05",
        vehicle_type_id: ID.vehicle,
        service_ids: [],
      }),
      (e: unknown) => e instanceof ApiError && e.code === CLIENT_ERROR.VALIDATION,
    );
    assert.equal(calls.length, 0);
  });

  test("gallery URLs are used as returned (Supabase or self-hosted; no rewrite)", async () => {
    const selfHosted = { ...galleryItem, id: ID.blocked, image_url: "/uploads/gallery/x.jpg" };
    const { api } = apiWith(() => jsonResponse(200, { data: [galleryItem, selfHosted] }));
    const items = await getPublicGallery(api);
    assert.deepEqual(
      items.map((i) => i.image_url),
      [galleryItem.image_url, "/uploads/gallery/x.jpg"],
    );
  });

  test("withFallback keeps the example content when the API has no items", () => {
    assert.deepEqual(withFallback([], ["voorbeeld"]), ["voorbeeld"]);
    assert.deepEqual(withFallback(["echt"], ["voorbeeld"]), ["echt"]);
  });
});

describe("same-origin base URL (production behind one reverse proxy)", () => {
  test("requests go to /api/... on the site's own origin, with no host or port", async () => {
    const { api, calls } = apiWith(() => jsonResponse(200, { data: [service] }), "");
    await getPublicServices(api, { limit: 4 });
    assert.equal(calls[0]!.url, "/api/services?limit=4");
    assert.equal(calls[0]!.headers.has("authorization"), false);
  });
});
