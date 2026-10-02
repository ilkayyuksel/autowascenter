// Every admin write flow through the typed helpers: endpoint, method, Bearer header, exact
// request body (validated with the shared contracts), response parsing, and error mapping.
// The server is authoritative: the client never sends price, duration, totals, cancel token,
// timestamps or cancelled_at, and never computes slots.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadBookingDetail } from "./admin-reads.ts";
import {
  bookingPriceSummary,
  changedFields,
  createAdminBooking,
  createAdminService,
  createAdminVehicleType,
  createBlockedPeriod,
  createGalleryItem,
  deleteAdminBooking,
  deleteAdminService,
  deleteAdminVehicleType,
  deleteBlockedPeriod,
  deleteGalleryItem,
  loadAdminAvailability,
  RequestValidationError,
  updateAdminBooking,
  updateAdminPricing,
  updateAdminService,
  updateAdminVehicleType,
  updateGalleryItem,
  updatePackageContent,
  updateSettings,
  uploadGalleryImage,
} from "./admin-writes.ts";
import { bookingPatchFrom, type BookingEditState } from "./booking-edit.ts";
import { ApiError, createApiClient } from "./client.ts";
import { describeWriteError } from "./errors.ts";
import {
  ACCESS_TOKEN,
  adminBooking,
  adminService,
  apiError,
  BASE,
  blockedPeriod,
  fakeFetch,
  galleryItem,
  ID,
  jsonResponse,
  settingsBody,
  vehicleType,
  type RecordedCall,
} from "./test-fixtures.ts";

function apiWith(respond: (url: string, call: RecordedCall) => Response) {
  const fetch = fakeFetch(respond);
  const api = createApiClient({
    baseUrl: BASE,
    fetchImpl: fetch.impl,
    getAccessToken: async () => ACCESS_TOKEN,
  });
  return { api, calls: fetch.calls };
}

const PRICING = {
  services_subtotal: 100,
  location_fee: 0,
  total_excl_vat: 100,
  vat_rate: 0.21,
  vat: 21,
  total_incl_vat: 121,
  currency: "EUR",
};
const bookingWrite = (overrides: Record<string, unknown> = {}) => ({
  data: {
    ...adminBooking({ total_price: 100, ...overrides }),
    services: [
      {
        id: ID.line,
        service_id: ID.service,
        service_title: "Buitenwas",
        price: 100,
        duration_minutes: 90,
      },
    ],
    pricing: PRICING,
  },
});

const FORBIDDEN_BOOKING_FIELDS = [
  "total_price",
  "total_duration_minutes",
  "duration",
  "location_fee",
  "start_at",
  "end_at",
  "cancel_token",
  "cancelled_at",
  "price",
  "service_title",
];

function assertCall(call: RecordedCall, method: string, url: string) {
  assert.equal(call.method, method);
  assert.equal(call.url, url);
  assert.equal(call.headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);
}

async function rejectsValidation(promise: Promise<unknown>, calls: unknown[]) {
  await assert.rejects(promise, (e: unknown) => e instanceof RequestValidationError);
  assert.equal(calls.length, 0, "nothing may be sent");
}

const validCreate = {
  vehicle_type_id: ID.vehicle,
  service_ids: [ID.service],
  preferred_date: "2026-10-05",
  preferred_time: "10:00",
  customer_name: "Jan Peeters",
  customer_email: "jan@example.test",
  customer_phone: "0470000000",
  vehicle_brand: "",
  vehicle_model: "",
  notes: "",
  status: "bevestigd" as const,
};

const original: BookingEditState = {
  preferred_date: "2026-10-05",
  preferred_time: "10:00",
  status: "bevestigd",
  notes: "",
  vehicle_type_id: ID.vehicle,
  service_ids: [ID.service],
};

describe("agenda + reservations: bookings", () => {
  test("create: POST with choices + customer data only; server pricing in the response", async () => {
    const { api, calls } = apiWith(() => jsonResponse(201, bookingWrite()));
    const booking = await createAdminBooking(api, validCreate);
    assertCall(calls[0]!, "POST", `${BASE}/api/admin/bookings`);
    const body = calls[0]!.json as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
      "customer_email",
      "customer_name",
      "customer_phone",
      "notes",
      "preferred_date",
      "preferred_time",
      "service_ids",
      "status",
      "vehicle_brand",
      "vehicle_model",
      "vehicle_type_id",
    ]);
    for (const f of FORBIDDEN_BOOKING_FIELDS) assert.equal(f in body, false, f);
    assert.equal(body.vehicle_brand, null, '"" becomes null');
    assert.deepEqual(booking.pricing, PRICING);
    assert.equal(booking.start_at, "2026-10-05T08:00:00.000Z");
  });

  test("the client can never send price, duration, totals, cancel token or timestamps", async () => {
    for (const extra of FORBIDDEN_BOOKING_FIELDS) {
      const { api, calls } = apiWith(() => jsonResponse(201, bookingWrite()));
      const input = Object.assign({}, validCreate, {
        [extra]: extra.endsWith("_at") ? "2026-10-05T08:00:00Z" : 1,
      });
      await rejectsValidation(createAdminBooking(api, input), calls);
      const patch = Object.assign({ status: "bevestigd" as const }, { [extra]: 1 });
      await rejectsValidation(updateAdminBooking(api, ID.booking, patch), calls);
    }
  });

  test("status on create: only nieuw/bevestigd/voltooid (cancelling is an update)", async () => {
    const { api, calls } = apiWith(() => jsonResponse(201, bookingWrite()));
    const input = Object.assign({}, validCreate, { status: "geannuleerd" });
    await rejectsValidation(createAdminBooking(api, input), calls);
  });

  test("pricing shown is the server's: subtotal 100, VAT 21, total 121", async () => {
    const { api } = apiWith(() => jsonResponse(201, bookingWrite()));
    const booking = await createAdminBooking(api, validCreate);
    const summary = bookingPriceSummary(booking.pricing);
    assert.deepEqual([summary.subtotal, summary.vat, summary.total], [100, 21, 121]);
    assert.equal(summary.text, "€121,00 incl. btw (€100,00 + €21,00 btw)");
  });

  test("move 10:00 → 10:30: PATCH with only preferred_time; the server decides", async () => {
    const patch = bookingPatchFrom(original, { ...original, preferred_time: "10:30" });
    assert.deepEqual(patch, { preferred_time: "10:30" });
    const { api, calls } = apiWith(() =>
      jsonResponse(
        200,
        bookingWrite({ preferred_time: "10:30", start_at: "2026-10-05T08:30:00.000Z" }),
      ),
    );
    const moved = await updateAdminBooking(api, ID.booking, patch);
    assertCall(calls[0]!, "PATCH", `${BASE}/api/admin/bookings/${ID.booking}`);
    assert.deepEqual(calls[0]!.json, { preferred_time: "10:30" });
    assert.equal(moved.preferred_time, "10:30");
  });

  test("move into booking B's slot: 409 BOOKING_SLOT_UNAVAILABLE → message + refresh", async () => {
    const { api } = apiWith(() => apiError(409, "BOOKING_SLOT_UNAVAILABLE"));
    const error = await updateAdminBooking(api, ID.booking, { preferred_time: "13:00" }).catch(
      (e) => e,
    );
    assert.ok(error instanceof ApiError && error.code === "BOOKING_SLOT_UNAVAILABLE");
    const view = describeWriteError(error);
    assert.equal(view.kind, "slot_unavailable");
    assert.equal(view.refresh, true);
  });

  test("change services: PATCH service_ids; change vehicle type: vehicle_type_id + service_ids", async () => {
    assert.deepEqual(
      bookingPatchFrom(original, { ...original, service_ids: [ID.service, ID.service2] }),
      {
        service_ids: [ID.service, ID.service2],
      },
    );
    assert.deepEqual(bookingPatchFrom(original, { ...original, service_ids: [ID.service] }), {});
    const changedVehicle = {
      ...original,
      vehicle_type_id: ID.vehicle2,
      service_ids: [ID.service2],
    };
    assert.deepEqual(bookingPatchFrom(original, changedVehicle), {
      vehicle_type_id: ID.vehicle2,
      service_ids: [ID.service2],
    });

    const { api, calls } = apiWith(() => jsonResponse(200, bookingWrite()));
    await updateAdminBooking(api, ID.booking, bookingPatchFrom(original, changedVehicle));
    assert.deepEqual(calls[0]!.json, { vehicle_type_id: ID.vehicle2, service_ids: [ID.service2] });
  });

  test("status change, cancel and reactivation: only status is sent (server sets cancelled_at)", async () => {
    const { api, calls } = apiWith(() =>
      jsonResponse(
        200,
        bookingWrite({ status: "geannuleerd", cancelled_at: "2026-10-01T08:00:00.000Z" }),
      ),
    );
    const cancelled = await updateAdminBooking(api, ID.booking, { status: "geannuleerd" });
    assert.deepEqual(calls[0]!.json, { status: "geannuleerd" });
    assert.equal(cancelled.cancelled_at, "2026-10-01T08:00:00.000Z");

    const { api: api2 } = apiWith(() => apiError(409, "BOOKING_SLOT_UNAVAILABLE"));
    await assert.rejects(
      updateAdminBooking(api2, ID.booking, { status: "bevestigd" }),
      (e: ApiError) => e.status === 409,
    );
    assert.deepEqual(bookingPatchFrom(original, { ...original, status: "voltooid" }), {
      status: "voltooid",
    });
  });

  test("an empty PATCH is rejected before sending", async () => {
    const { api, calls } = apiWith(() => jsonResponse(200, bookingWrite()));
    await rejectsValidation(updateAdminBooking(api, ID.booking, {}), calls);
  });

  test("delete: DELETE /api/admin/bookings/:id; 404 → item gone + refresh", async () => {
    const { api, calls } = apiWith(() => new Response(null, { status: 204 }));
    await deleteAdminBooking(api, ID.booking);
    assertCall(calls[0]!, "DELETE", `${BASE}/api/admin/bookings/${ID.booking}`);
    const { api: gone } = apiWith(() => apiError(404, "RESOURCE_NOT_FOUND"));
    const view = describeWriteError(await deleteAdminBooking(gone, ID.booking).catch((e) => e));
    assert.equal(view.kind, "not_found");
    assert.equal(view.refresh, true);
  });

  test("detail refresh after a write comes from the API (GET detail)", async () => {
    let status = "bevestigd";
    const { api, calls } = apiWith((url, call) => {
      if (call.method === "PATCH") {
        status = "voltooid";
        return jsonResponse(200, bookingWrite({ status }));
      }
      return jsonResponse(200, { data: { ...adminBooking({ status }), services: [] } });
    });
    await updateAdminBooking(api, ID.booking, { status: "voltooid" });
    const detail = await loadBookingDetail(api, ID.booking);
    assert.equal(detail.status, "voltooid");
    assert.deepEqual(
      calls.map((c) => c.method),
      ["PATCH", "GET"],
    );
  });

  test("availability: server slots via GET /api/admin/availability (with exclude_booking_id)", async () => {
    const body = {
      data: {
        date: "2026-10-05",
        total_duration_minutes: 90,
        exclude_booking_id: ID.booking,
        slots: [
          {
            time: "10:30",
            start_at: "2026-10-05T08:30:00.000Z",
            end_at: "2026-10-05T10:00:00.000Z",
            pickup_date: "2026-10-05",
            pickup_time: "12:00",
          },
        ],
      },
    };
    const { api, calls } = apiWith(() => jsonResponse(200, body));
    const result = await loadAdminAvailability(api, {
      date: "2026-10-05",
      vehicle_type_id: ID.vehicle,
      service_ids: [ID.service, ID.service2],
      exclude_booking_id: ID.booking,
    });
    assertCall(
      calls[0]!,
      "GET",
      `${BASE}/api/admin/availability?date=2026-10-05&vehicle_type_id=${ID.vehicle}&service_ids=${ID.service}%2C${ID.service2}&exclude_booking_id=${ID.booking}`,
    );
    assert.deepEqual(
      result.slots.map((s) => s.time),
      ["10:30"],
    );
    assert.equal(result.total_duration_minutes, 90);

    const { api: api2, calls: calls2 } = apiWith(() => jsonResponse(200, body));
    await loadAdminAvailability(api2, { date: "2026-10-05", exclude_booking_id: ID.booking });
    assert.equal(
      calls2[0]!.url,
      `${BASE}/api/admin/availability?date=2026-10-05&exclude_booking_id=${ID.booking}`,
    );

    const { api: api3, calls: calls3 } = apiWith(() => jsonResponse(200, body));
    await rejectsValidation(
      loadAdminAvailability(api3, { date: "2026-10-05", vehicle_type_id: ID.vehicle }),
      calls3,
    );
  });

  test("planning errors (422) and generic failures map to fixed texts", () => {
    assert.equal(describeWriteError(new ApiError(422, "BOOKING_IN_PAST", "x")).kind, "planning");
    assert.equal(
      describeWriteError(new ApiError(422, "BOOKING_OUTSIDE_OPENING_HOURS", "x")).kind,
      "planning",
    );
    assert.equal(describeWriteError(new ApiError(404, "SERVICE_NOT_FOUND", "x")).kind, "not_found");
    const generic = describeWriteError(
      new ApiError(500, "INTERNAL_ERROR", "duplicate key value violates"),
    );
    assert.equal(generic.kind, "generic");
    assert.doesNotMatch(generic.message, /duplicate key/);
  });
});

describe("services and packages", () => {
  test("create: POST {kind}; the server creates defaults and pricing rows", async () => {
    const { api, calls } = apiWith(() =>
      jsonResponse(201, { data: adminService({ title: "Nieuwe dienst" }) }),
    );
    const created = await createAdminService(api, { kind: "dienst" });
    assertCall(calls[0]!, "POST", `${BASE}/api/admin/services`);
    assert.deepEqual(calls[0]!.json, { kind: "dienst" });
    assert.equal(created.title, "Nieuwe dienst");
  });

  test("update: PATCH with the edited fields", async () => {
    const { api, calls } = apiWith(() =>
      jsonResponse(200, { data: adminService({ title: "Polijsten" }) }),
    );
    await updateAdminService(api, ID.service, { title: "Polijsten", badge: "", active: false });
    assertCall(calls[0]!, "PATCH", `${BASE}/api/admin/services/${ID.service}`);
    assert.deepEqual(calls[0]!.json, { title: "Polijsten", badge: null, active: false });
    const { api: api2, calls: calls2 } = apiWith(() => jsonResponse(200, {}));
    await rejectsValidation(updateAdminService(api2, ID.service, { title: "  " }), calls2);
  });

  test("package contents: one PUT with the complete list", async () => {
    const pkg = adminService({
      id: ID.pkg,
      kind: "pakket",
      included_service_ids: [ID.service, ID.service2],
    });
    const { api, calls } = apiWith(() => jsonResponse(200, { data: pkg }));
    const result = await updatePackageContent(api, ID.pkg, [ID.service, ID.service2]);
    assertCall(calls[0]!, "PUT", `${BASE}/api/admin/services/${ID.pkg}/package-content`);
    assert.deepEqual(calls[0]!.json, { service_ids: [ID.service, ID.service2] });
    assert.deepEqual(result.included_service_ids, [ID.service, ID.service2]);
    const { api: api2, calls: calls2 } = apiWith(() => jsonResponse(200, { data: pkg }));
    await updatePackageContent(api2, ID.pkg, []);
    assert.deepEqual(calls2[0]!.json, { service_ids: [] });
  });

  test("delete: DELETE; errors mapped", async () => {
    const { api, calls } = apiWith(() => new Response(null, { status: 204 }));
    await deleteAdminService(api, ID.service);
    assertCall(calls[0]!, "DELETE", `${BASE}/api/admin/services/${ID.service}`);
    const { api: api2 } = apiWith(() => apiError(409, "RESOURCE_IN_USE"));
    assert.equal(
      describeWriteError(await deleteAdminService(api2, ID.service).catch((e) => e)).kind,
      "in_use",
    );
  });
});

describe("vehicle types and pricing", () => {
  test("create: POST {} (server defaults + pricing rows); update: PATCH", async () => {
    const { api, calls } = apiWith((_u, call) =>
      jsonResponse(call.method === "POST" ? 201 : 200, {
        data: vehicleType({ title: "Bestelwagen" }),
      }),
    );
    await createAdminVehicleType(api);
    assertCall(calls[0]!, "POST", `${BASE}/api/admin/vehicle-types`);
    assert.deepEqual(calls[0]!.json, {});
    await updateAdminVehicleType(api, ID.vehicle, { title: "Bestelwagen", image_url: "" });
    assertCall(calls[1]!, "PATCH", `${BASE}/api/admin/vehicle-types/${ID.vehicle}`);
    assert.deepEqual(calls[1]!.json, { title: "Bestelwagen", image_url: null });
  });

  test("delete in use: 409 RESOURCE_IN_USE → clear message, no database details", async () => {
    const { api } = apiWith(() =>
      apiError(409, "RESOURCE_IN_USE", "update or delete violates foreign key"),
    );
    const view = describeWriteError(await deleteAdminVehicleType(api, ID.vehicle).catch((e) => e));
    assert.equal(view.kind, "in_use");
    assert.doesNotMatch(view.message, /foreign key/);
    const { api: ok, calls } = apiWith(() => new Response(null, { status: 204 }));
    await deleteAdminVehicleType(ok, ID.vehicle);
    assertCall(calls[0]!, "DELETE", `${BASE}/api/admin/vehicle-types/${ID.vehicle}`);
  });

  test("pricing matrix: one PUT with the full matrix; row ids are not sent", async () => {
    const { api, calls } = apiWith(() => jsonResponse(200, { data: vehicleType() }));
    await updateAdminPricing(api, ID.vehicle, [
      {
        id: ID.vts,
        vehicle_type_id: ID.vehicle,
        service_id: ID.service,
        available: true,
        price: 35.5,
        duration_minutes: 75,
      },
      {
        id: ID.vts2,
        vehicle_type_id: ID.vehicle,
        service_id: ID.service2,
        available: false,
        price: 0,
        duration_minutes: 60,
      },
    ] as never);
    assertCall(calls[0]!, "PUT", `${BASE}/api/admin/vehicle-types/${ID.vehicle}/pricing`);
    assert.deepEqual(calls[0]!.json, {
      rows: [
        { service_id: ID.service, available: true, price: 35.5, duration_minutes: 75 },
        { service_id: ID.service2, available: false, price: 0, duration_minutes: 60 },
      ],
    });
  });

  test("one invalid row → nothing is sent; a server rejection saves nothing either", async () => {
    const { api, calls } = apiWith(() => jsonResponse(200, { data: vehicleType() }));
    await rejectsValidation(
      updateAdminPricing(api, ID.vehicle, [
        { service_id: ID.service, available: true, price: 30, duration_minutes: 60 },
        { service_id: ID.service2, available: true, price: 1.234, duration_minutes: 60 },
      ]),
      calls,
    );
    await rejectsValidation(
      updateAdminPricing(api, ID.vehicle, [
        { service_id: ID.service, available: true, price: 30, duration_minutes: 0 },
      ]),
      calls,
    );
    const { api: api2 } = apiWith(() => apiError(400, "VALIDATION_ERROR"));
    await assert.rejects(
      updateAdminPricing(api2, ID.vehicle, [
        { service_id: ID.service, available: true, price: 30, duration_minutes: 60 },
      ]),
      (e: ApiError) => e.status === 400,
    );
  });
});

describe("blocked periods", () => {
  test("create: POST with dates, optional times (null = whole day) and reason", async () => {
    const { api, calls } = apiWith(() => jsonResponse(201, { data: blockedPeriod() }));
    await createBlockedPeriod(api, {
      start_date: "2026-10-06",
      end_date: "2026-10-07",
      start_time: null,
      end_time: null,
      reason: "Vakantie",
    });
    assertCall(calls[0]!, "POST", `${BASE}/api/admin/blocked-periods`);
    assert.deepEqual(calls[0]!.json, {
      start_date: "2026-10-06",
      end_date: "2026-10-07",
      start_time: null,
      end_time: null,
      reason: "Vakantie",
    });
  });

  test("invalid ranges are rejected before sending", async () => {
    const { api, calls } = apiWith(() => jsonResponse(201, {}));
    await rejectsValidation(
      createBlockedPeriod(api, { start_date: "2026-10-07", end_date: "2026-10-06" }),
      calls,
    );
    await rejectsValidation(
      createBlockedPeriod(api, {
        start_date: "2026-10-06",
        end_date: "2026-10-06",
        start_time: "14:00",
        end_time: "12:00",
      }),
      calls,
    );
  });

  test("delete: DELETE /api/admin/blocked-periods/:id", async () => {
    const { api, calls } = apiWith(() => new Response(null, { status: 204 }));
    await deleteBlockedPeriod(api, ID.blocked);
    assertCall(calls[0]!, "DELETE", `${BASE}/api/admin/blocked-periods/${ID.blocked}`);
  });
});

describe("settings", () => {
  test("partial update: only changed fields are sent; response parsed", async () => {
    const before = {
      km_fee: 0.5,
      free_km: 10,
      base_city: "Sint-Niklaas",
      notification_email: null as string | null,
    };
    const after = { ...before, km_fee: 0.6, notification_email: "" as string | null };
    const patch = changedFields(before, after);
    assert.deepEqual(patch, { km_fee: 0.6, notification_email: "" });

    const { api, calls } = apiWith(() => jsonResponse(200, settingsBody()));
    const result = await updateSettings(api, patch);
    assertCall(calls[0]!, "PATCH", `${BASE}/api/admin/settings`);
    assert.deepEqual(calls[0]!.json, { km_fee: 0.6, notification_email: null });
    assert.equal(result.id, ID.settings);

    const { api: api2, calls: calls2 } = apiWith(() => jsonResponse(200, settingsBody()));
    await rejectsValidation(updateSettings(api2, {}), calls2);
    await rejectsValidation(updateSettings(api2, { opening_hour: "25:00" }), calls2);
  });
});

describe("gallery", () => {
  test("metadata create / update / delete", async () => {
    const { api, calls } = apiWith((_u, call) =>
      call.method === "DELETE"
        ? new Response(null, { status: 204 })
        : jsonResponse(call.method === "POST" ? 201 : 200, {
            data: galleryItem({ title: "Nieuw" }),
          }),
    );
    await createGalleryItem(api, { image_url: "https://cdn.example/x.jpg", title: "Nieuw" });
    assertCall(calls[0]!, "POST", `${BASE}/api/admin/gallery`);
    assert.deepEqual(calls[0]!.json, { image_url: "https://cdn.example/x.jpg", title: "Nieuw" });

    const updated = await updateGalleryItem(api, ID.gallery, {
      title: "Nieuw",
      description: "",
      sort_order: 2,
    });
    assertCall(calls[1]!, "PATCH", `${BASE}/api/admin/gallery/${ID.gallery}`);
    assert.deepEqual(calls[1]!.json, { title: "Nieuw", description: null, sort_order: 2 });
    assert.equal(updated.title, "Nieuw");

    await deleteGalleryItem(api, ID.gallery);
    assertCall(calls[2]!, "DELETE", `${BASE}/api/admin/gallery/${ID.gallery}`);
  });

  test("upload: multipart FormData with the file; the response URL is what the UI shows", async () => {
    const url = "http://localhost:3001/uploads/gallery/0b0e4d4c-9a1f-4c55-8f3e-2f5c6a7b8c9d.png";
    const { api, calls } = apiWith(() =>
      jsonResponse(201, { data: galleryItem({ image_url: url }) }),
    );
    const file = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    const item = await uploadGalleryImage(api, file);
    assertCall(calls[0]!, "POST", `${BASE}/api/admin/gallery/upload`);
    const form = calls[0]!.body as FormData;
    assert.ok(form instanceof FormData);
    const sent = form.get("file") as File;
    assert.equal(sent.type, "image/png");
    assert.equal(sent.size, 4);
    assert.equal(item.image_url, url);
    assert.ok(!calls.some((c) => c.url.includes("supabase")), "no Supabase Storage request");
  });

  test("upload errors: invalid type (no request), oversize 413, unsupported 415, storage 503", async () => {
    const { api, calls } = apiWith(() => jsonResponse(201, {}));
    const svg = new Blob(["<svg/>"], { type: "image/svg+xml" });
    const typeError = await uploadGalleryImage(api, svg).catch((e) => e);
    assert.ok(typeError instanceof RequestValidationError);
    assert.equal(calls.length, 0);
    assert.equal(describeWriteError(typeError).kind, "file");

    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    for (const [status, code, kind] of [
      [413, "FILE_TOO_LARGE", "file"],
      [415, "UNSUPPORTED_MEDIA_TYPE", "file"],
      [503, "STORAGE_UNAVAILABLE", "unavailable"],
      [429, "RATE_LIMITED", "rate_limited"],
    ] as const) {
      const { api: failing } = apiWith(() => apiError(status, code));
      const error = await uploadGalleryImage(failing, jpeg).catch((e) => e);
      assert.equal(describeWriteError(error).kind, kind, code);
    }
  });
});
