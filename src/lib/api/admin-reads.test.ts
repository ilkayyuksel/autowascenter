// Admin READ loaders per page, with a fake fetch: endpoint + auth, mapping to the UI model,
// empty data, 401/403/5xx, and malformed responses (validated with the shared contracts).

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  loadAgenda,
  loadAgendaVehicleOptions,
  loadBlockedPeriods,
  loadBookingDetail,
  loadBookingsPage,
  loadDashboard,
  loadGallery,
  loadServices,
  loadSettings,
  loadVehiclesPage,
  pickupLabel,
} from "./admin-reads.ts";
import { ApiError, CLIENT_ERROR, createApiClient, type ApiClient } from "./client.ts";
import {
  ACCESS_TOKEN,
  adminBooking,
  adminService,
  apiError,
  BASE,
  blockedPeriod,
  dashboardBody,
  fakeFetch,
  galleryItem,
  ID,
  jsonResponse,
  matrixRow,
  settingsBody,
  vehicleType,
} from "./test-fixtures.ts";

function apiWith(respond: (url: string) => Response) {
  const fetch = fakeFetch(respond);
  const api = createApiClient({
    baseUrl: BASE,
    fetchImpl: fetch.impl,
    getAccessToken: async () => ACCESS_TOKEN,
  });
  return { api, calls: fetch.calls };
}

const list = (data: unknown[]) => ({ data, meta: { total: data.length } });

/** Every page loader: errors propagate as typed ApiErrors (the page shows its error state). */
async function assertErrorHandling(load: (api: ApiClient) => Promise<unknown>, validBody: unknown) {
  for (const [status, code] of [
    [401, "AUTHENTICATION_INVALID"],
    [403, "AUTHORIZATION_REQUIRED"],
    [500, "INTERNAL_ERROR"],
    [503, "DATABASE_UNAVAILABLE"],
  ] as const) {
    const { api } = apiWith(() => apiError(status, code));
    await assert.rejects(
      load(api),
      (e: unknown) => e instanceof ApiError && e.status === status && e.code === code,
    );
  }
  // Malformed: valid JSON that breaks the contract (an unexpected field / wrong type).
  const malformed = JSON.parse(JSON.stringify(validBody)) as { data: unknown };
  malformed.data = Array.isArray(malformed.data)
    ? [{ ...(malformed.data[0] as object), unexpected: true }]
    : { ...(malformed.data as object), unexpected: true };
  const { api } = apiWith(() => jsonResponse(200, malformed));
  await assert.rejects(
    load(api),
    (e: unknown) => e instanceof ApiError && e.code === CLIENT_ERROR.INVALID_RESPONSE,
  );
  const { api: notJson } = apiWith(() => new Response("<html>", { status: 200 }));
  await assert.rejects(
    load(notJson),
    (e: unknown) => e instanceof ApiError && e.code === CLIENT_ERROR.INVALID_RESPONSE,
  );
}

function assertAdminCall(calls: { url: string; headers: Headers }[], url: string) {
  assert.equal(calls.length, 1, "exactly one request");
  assert.equal(calls[0]!.url, url);
  assert.equal(calls[0]!.headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);
}

describe("dashboard: GET /api/admin/dashboard", () => {
  test("success", async () => {
    const { api, calls } = apiWith(() => jsonResponse(200, dashboardBody()));
    const data = await loadDashboard(api);
    assertAdminCall(calls, `${BASE}/api/admin/dashboard`);
    assert.equal(data.week.booking_count, 1);
    assert.equal(data.week.days.length, 7);
    assert.equal(data.next_booking?.customer_name, "Jan Peeters");
    assert.equal(data.counts.gallery_items, 3);
  });
  test("empty week", async () => {
    const body = dashboardBody();
    body.data.today_bookings = [];
    (body.data as { next_booking: unknown }).next_booking = null;
    body.data.week.booking_count = 0;
    const { api } = apiWith(() => jsonResponse(200, body));
    const data = await loadDashboard(api);
    assert.equal(data.next_booking, null);
    assert.deepEqual(data.today_bookings, []);
  });
  test("errors", () => assertErrorHandling(loadDashboard, dashboardBody()));
});

describe("agenda: GET /api/admin/agenda", () => {
  const body = (bookings: unknown[], blocked: unknown[] = []) => ({
    data: { start: "2026-10-05", end: "2026-10-11", bookings, blocked_periods: blocked },
  });

  test("success: start/end query, bookings + blocked periods, end from pickup (no end_time)", async () => {
    const multiDay = adminBooking({
      id: ID.booking2,
      status: "geannuleerd",
      pickup_date: "2026-10-06",
      pickup_time: "12:00",
      end_at: "2026-10-06T10:00:00.000Z",
      cancelled_at: "2026-10-02T08:00:00.000Z",
    });
    const { api, calls } = apiWith(() =>
      jsonResponse(200, body([adminBooking(), multiDay], [blockedPeriod()])),
    );
    const data = await loadAgenda(api, { start: "2026-10-05", end: "2026-10-11" });
    assertAdminCall(calls, `${BASE}/api/admin/agenda?start=2026-10-05&end=2026-10-11`);
    assert.equal(data.bookings[0]!.same_day_end_time, "11:30");
    assert.equal(data.bookings[0]!.ends_later, false);
    assert.equal(data.bookings[1]!.same_day_end_time, null);
    assert.equal(data.bookings[1]!.ends_later, true);
    assert.equal(data.bookings[1]!.status, "geannuleerd");
    assert.equal("end_time" in data.bookings[0]!, false);
    assert.deepEqual(data.blocked[0], {
      id: ID.blocked,
      start_date: "2026-10-06",
      end_date: "2026-10-07",
      start_time: null,
      end_time: null,
      reason: "Vakantie",
    });
  });
  test("empty", async () => {
    const { api } = apiWith(() => jsonResponse(200, body([])));
    assert.deepEqual(await loadAgenda(api, { start: "2026-10-05", end: "2026-10-11" }), {
      bookings: [],
      blocked: [],
    });
  });
  test("errors", () =>
    assertErrorHandling(
      (api) => loadAgenda(api, { start: "2026-10-05", end: "2026-10-11" }),
      body([adminBooking()]),
    ));

  test("new-appointment options: one vehicle-types request, active types, bookable available rows", async () => {
    const types = [
      vehicleType({
        services: [
          matrixRow({ id: ID.vts, title: "Polijsten", service_id: ID.service2 }),
          matrixRow({ id: ID.vts2, title: "Buitenwas" }),
          matrixRow({
            id: ID.vts3,
            title: "Niet beschikbaar",
            service_id: ID.pkg,
            available: false,
          }),
        ],
      }),
      vehicleType({
        id: ID.vehicle2,
        slug: "bestelwagen",
        title: "Bestelwagen",
        active: false,
        services: [],
      }),
    ];
    const { api, calls } = apiWith(() => jsonResponse(200, list(types)));
    const opts = await loadAgendaVehicleOptions(api);
    assertAdminCall(calls, `${BASE}/api/admin/vehicle-types`);
    assert.deepEqual(opts.vehicleTypes, [{ id: ID.vehicle, title: "Personenwagen" }]);
    assert.deepEqual(
      opts.servicesByType[ID.vehicle]!.map((s) => s.title),
      ["Buitenwas", "Polijsten"],
    );
  });
});

describe("reservations: GET /api/admin/bookings, GET /api/admin/bookings/:id", () => {
  const page = (data: unknown[], meta = { page: 2, limit: 50, total: 51, total_pages: 2 }) => ({
    data,
    meta,
  });

  test("server-side pagination: page/limit query, API meta is authoritative", async () => {
    const { api, calls } = apiWith(() => jsonResponse(200, page([adminBooking()])));
    const result = await loadBookingsPage(api, { page: 2 });
    assertAdminCall(calls, `${BASE}/api/admin/bookings?page=2&limit=50`);
    assert.deepEqual(result.meta, { page: 2, limit: 50, total: 51, total_pages: 2 });
    assert.equal(result.items[0]!.pickup_label, "11:30");
    assert.equal(result.items[0]!.total_price, 49.59);
  });
  test("empty", async () => {
    const { api } = apiWith(() =>
      jsonResponse(200, page([], { page: 1, limit: 50, total: 0, total_pages: 0 })),
    );
    const result = await loadBookingsPage(api, { page: 1 });
    assert.deepEqual(result.items, []);
    assert.equal(result.meta.total, 0);
  });
  test("errors", () =>
    assertErrorHandling((api) => loadBookingsPage(api, { page: 1 }), page([adminBooking()])));

  test("detail: one request for that id, with service lines", async () => {
    const detail = {
      data: {
        ...adminBooking(),
        services: [
          {
            id: ID.line,
            service_id: ID.service,
            service_title: "Buitenwas",
            price: 49.59,
            duration_minutes: 90,
          },
        ],
      },
    };
    const { api, calls } = apiWith(() => jsonResponse(200, detail));
    const result = await loadBookingDetail(api, ID.booking);
    assertAdminCall(calls, `${BASE}/api/admin/bookings/${ID.booking}`);
    assert.deepEqual(
      result.lines.map((l) => l.service_title),
      ["Buitenwas"],
    );
  });
  test("detail errors (404 included)", async () => {
    const { api } = apiWith(() => apiError(404, "RESOURCE_NOT_FOUND"));
    await assert.rejects(loadBookingDetail(api, ID.booking), (e: ApiError) => e.status === 404);
    await assertErrorHandling((api) => loadBookingDetail(api, ID.booking), {
      data: { ...adminBooking(), services: [] },
    });
  });

  test("pickup on a later day is labelled with its date", () => {
    assert.equal(
      pickupLabel({
        preferred_date: "2026-10-05",
        pickup_date: "2026-10-06",
        pickup_time: "09:00",
      }),
      "din 6 okt. 09:00",
    );
  });
});

describe("services: GET /api/admin/services", () => {
  test("success: package contents from included_service_ids", async () => {
    const body = list([
      adminService({
        id: ID.pkg,
        title: "Pakket",
        kind: "pakket",
        included_service_ids: [ID.service, ID.service2],
      }),
      adminService(),
      adminService({
        id: ID.service2,
        title: "Velgen",
        kind: "extra",
        active: false,
        bookable: false,
      }),
    ]);
    const { api, calls } = apiWith(() => jsonResponse(200, body));
    const { items, contents } = await loadServices(api);
    assertAdminCall(calls, `${BASE}/api/admin/services`);
    assert.deepEqual(
      items.map((s) => s.kind),
      ["pakket", "dienst", "extra"],
    );
    assert.deepEqual(contents, { [ID.pkg]: [ID.service, ID.service2] });
    assert.equal(items[2]!.active, false);
  });
  test("empty", async () => {
    const { api } = apiWith(() => jsonResponse(200, list([])));
    assert.deepEqual(await loadServices(api), { items: [], contents: {} });
  });
  test("errors", () => assertErrorHandling(loadServices, list([adminService()])));
});

describe("vehicles: GET /api/admin/vehicle-types (full pricing matrix, one request)", () => {
  test("success", async () => {
    const body = list([
      vehicleType({
        services: [
          matrixRow(),
          matrixRow({
            id: ID.vts2,
            service_id: ID.service2,
            title: "Inactief",
            service_active: false,
            price: 12.5,
          }),
        ],
      }),
    ]);
    const { api, calls } = apiWith(() => jsonResponse(200, body));
    const page = await loadVehiclesPage(api);
    assertAdminCall(calls, `${BASE}/api/admin/vehicle-types`);
    assert.equal(page.vehicles[0]!.slug, "personenwagen");
    assert.deepEqual(
      page.vts.map((r) => [r.vehicle_type_id, r.service_id, r.price]),
      [
        [ID.vehicle, ID.service, 30],
        [ID.vehicle, ID.service2, 12.5],
      ],
    );
    // Only active + bookable services are shown, as before.
    assert.deepEqual(
      page.services.map((s) => s.id),
      [ID.service],
    );
  });
  test("empty", async () => {
    const { api } = apiWith(() => jsonResponse(200, list([])));
    assert.deepEqual(await loadVehiclesPage(api), { vehicles: [], vts: [], services: [] });
  });
  test("errors", () => assertErrorHandling(loadVehiclesPage, list([vehicleType()])));
});

describe("blocked periods: GET /api/admin/blocked-periods", () => {
  test("success keeps the API order (newest first)", async () => {
    const body = list([
      blockedPeriod({
        start_date: "2026-12-24",
        end_date: "2026-12-26",
        start_time: "12:00",
        end_time: "18:00",
      }),
      blockedPeriod({ id: "55555555-5555-4555-8555-555555555552" }),
    ]);
    const { api, calls } = apiWith(() => jsonResponse(200, body));
    const periods = await loadBlockedPeriods(api);
    assertAdminCall(calls, `${BASE}/api/admin/blocked-periods`);
    assert.deepEqual(
      periods.map((p) => p.start_date),
      ["2026-12-24", "2026-10-06"],
    );
    assert.equal(periods[0]!.start_time, "12:00");
  });
  test("empty", async () => {
    const { api } = apiWith(() => jsonResponse(200, list([])));
    assert.deepEqual(await loadBlockedPeriods(api), []);
  });
  test("errors", () => assertErrorHandling(loadBlockedPeriods, list([blockedPeriod()])));
});

describe("settings: GET /api/admin/settings (one object)", () => {
  test("success", async () => {
    const { api, calls } = apiWith(() => jsonResponse(200, settingsBody()));
    const settings = await loadSettings(api);
    assertAdminCall(calls, `${BASE}/api/admin/settings`);
    assert.equal(settings.id, ID.settings);
    assert.equal(settings.km_fee, 0.5);
    assert.equal(settings.notification_email, null);
  });
  test("500 SETTINGS_NOT_CONFIGURED stays recognisable", async () => {
    const { api } = apiWith(() => apiError(500, "SETTINGS_NOT_CONFIGURED"));
    await assert.rejects(loadSettings(api), (e: ApiError) => e.code === "SETTINGS_NOT_CONFIGURED");
  });
  test("errors", () => assertErrorHandling(loadSettings, settingsBody()));
});

describe("gallery: GET /api/admin/gallery", () => {
  test("success: all read fields", async () => {
    const { api, calls } = apiWith(() =>
      jsonResponse(200, list([galleryItem({ category: "Interieur" })])),
    );
    const items = await loadGallery(api);
    assertAdminCall(calls, `${BASE}/api/admin/gallery`);
    assert.deepEqual(Object.keys(items[0]!).sort(), [
      "before_image_url",
      "category",
      "description",
      "id",
      "image_url",
      "sort_order",
      "title",
    ]);
    assert.equal(items[0]!.category, "Interieur");
  });
  test("empty", async () => {
    const { api } = apiWith(() => jsonResponse(200, list([])));
    assert.deepEqual(await loadGallery(api), []);
  });
  test("errors", () => assertErrorHandling(loadGallery, list([galleryItem()])));
});
