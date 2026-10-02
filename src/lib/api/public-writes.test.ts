// Public booking submit (/reservatie → POST /api/bookings): request mapping, the exact
// outgoing payload (no server-only fields), response parsing, errors, double-submit
// protection and the confirmation built from the server's values. No real API.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ApiError, CLIENT_ERROR, createApiClient } from "./client.ts";
import {
  bookingConfirmation,
  createPublicBooking,
  createSubmitGuard,
  describePublicBookingError,
  toPublicBookingRequest,
  type PublicCustomerForm,
} from "./public-writes.ts";
import { RequestValidationError } from "./validation.ts";
import {
  apiError,
  BASE,
  fakeFetch,
  hangingFetch,
  ID,
  jsonResponse,
  type RecordedCall,
} from "./test-fixtures.ts";

function apiWith(respond: (url: string, call: RecordedCall) => Response) {
  const fetch = fakeFetch(respond);
  // The public client: no token provider at all.
  return { api: createApiClient({ baseUrl: BASE, fetchImpl: fetch.impl }), calls: fetch.calls };
}

const customer = (overrides: Partial<PublicCustomerForm> = {}): PublicCustomerForm => ({
  customer_name: "Jan Peeters",
  customer_phone: "0470123456",
  customer_email: "jan@example.test",
  vehicle_brand: "Volvo",
  vehicle_model: "V60",
  notes: "",
  company_name: "",
  vat_number: "",
  on_location: false,
  location_in_sint_niklaas: true,
  location_address: "",
  ...overrides,
});
const choices = {
  vehicleTypeId: ID.vehicle,
  serviceIds: [ID.pkg, ID.service],
  date: "2026-10-05",
  time: "10:00",
};

/** What the server returns (subtotal 100, VAT 21, total 121). */
const created = {
  data: {
    id: "9f8e7d6c-5b4a-4321-8fed-cba987654321",
    status: "nieuw",
    preferred_date: "2026-10-05",
    preferred_time: "10:00",
    start_at: "2026-10-05T08:00:00.000Z",
    end_at: "2026-10-06T07:30:00.000Z",
    pickup_date: "2026-10-06",
    pickup_time: "09:30",
    total_duration_minutes: 600,
    services: [
      {
        service_id: ID.pkg,
        title: "Full detail",
        kind: "pakket",
        price: 80,
        duration_minutes: 480,
      },
      {
        service_id: ID.service,
        title: "Buitenwas",
        kind: "dienst",
        price: 20,
        duration_minutes: 120,
      },
    ],
    pricing: {
      services_subtotal: 100,
      location_fee: 0,
      total_excl_vat: 100,
      vat_rate: 0.21,
      vat: 21,
      total_incl_vat: 121,
      currency: "EUR",
    },
  },
};

/** Fields only the server may set; never part of the outgoing payload. */
const SERVER_ONLY = [
  "total_price",
  "total_excl_vat",
  "total_incl_vat",
  "vat",
  "duration",
  "total_duration_minutes",
  "location_fee",
  "location_distance_km",
  "status",
  "cancel_token",
  "start_at",
  "end_at",
  "pickup_date",
  "pickup_time",
  "service_title",
  "price",
  "duration_minutes",
  "end_time",
];
const CONTRACT_FIELDS = [
  "company_name",
  "customer_email",
  "customer_name",
  "customer_phone",
  "location_address",
  "location_in_sint_niklaas",
  "notes",
  "on_location",
  "preferred_date",
  "preferred_time",
  "service_ids",
  "vat_number",
  "vehicle_brand",
  "vehicle_model",
  "vehicle_type_id",
];

describe("createPublicBooking: POST /api/bookings", () => {
  test("one POST with a JSON body, no Authorization header, parsed server response", async () => {
    const { api, calls } = apiWith(() => jsonResponse(201, created));
    const booking = await createPublicBooking(api, toPublicBookingRequest(choices, customer()));
    assert.equal(calls.length, 1, "exactly one request (no separate booking_services write)");
    assert.equal(calls[0]!.method, "POST");
    assert.equal(calls[0]!.url, `${BASE}/api/bookings`);
    assert.equal(calls[0]!.headers.get("content-type"), "application/json");
    assert.equal(calls[0]!.headers.has("authorization"), false);
    assert.deepEqual(calls[0]!.json, {
      vehicle_type_id: ID.vehicle,
      service_ids: [ID.pkg, ID.service],
      preferred_date: "2026-10-05",
      preferred_time: "10:00",
      customer_name: "Jan Peeters",
      customer_email: "jan@example.test",
      customer_phone: "0470123456",
      vehicle_brand: "Volvo",
      vehicle_model: "V60",
      on_location: false,
    });
    assert.equal(booking.pricing.total_incl_vat, 121);
    assert.equal(booking.pickup_date, "2026-10-06");
  });

  test("SECURITY: the outgoing payload contains only contract fields, never server values", async () => {
    const { api, calls } = apiWith(() => jsonResponse(201, created));
    const form = customer({
      notes: "Graag binnenkant extra aandacht",
      company_name: "Peeters BV",
      vat_number: "BE0123456789",
      on_location: true,
      location_in_sint_niklaas: false,
      location_address: "Kerkstraat 12, 9000 Gent",
    });
    await createPublicBooking(api, toPublicBookingRequest(choices, form));
    const body = calls[0]!.json as Record<string, unknown>;
    for (const field of SERVER_ONLY) assert.equal(field in body, false, field);
    for (const field of Object.keys(body)) assert.ok(CONTRACT_FIELDS.includes(field), field);
    assert.equal(body.location_address, "Kerkstraat 12, 9000 Gent");
  });

  test("server-only fields smuggled into the request are rejected before sending", async () => {
    for (const field of SERVER_ONLY) {
      const { api, calls } = apiWith(() => jsonResponse(201, created));
      const request = Object.assign(toPublicBookingRequest(choices, customer()), { [field]: 1 });
      await assert.rejects(
        createPublicBooking(api, request),
        (e) => e instanceof RequestValidationError,
      );
      assert.equal(calls.length, 0, field);
    }
  });

  test("400, 409, 422, 500, 503 → typed ApiError", async () => {
    for (const [status, code] of [
      [400, "VALIDATION_ERROR"],
      [409, "BOOKING_SLOT_UNAVAILABLE"],
      [422, "BOOKING_OUTSIDE_OPENING_HOURS"],
      [500, "INTERNAL_ERROR"],
      [503, "DATABASE_UNAVAILABLE"],
    ] as const) {
      const { api } = apiWith(() => apiError(status, code));
      await assert.rejects(
        createPublicBooking(api, toPublicBookingRequest(choices, customer())),
        (e: unknown) => e instanceof ApiError && e.status === status && e.code === code,
      );
    }
  });

  test("malformed response and timeout settle as errors", async () => {
    const { api } = apiWith(() => jsonResponse(201, { data: { id: "x" } }));
    await assert.rejects(
      createPublicBooking(api, toPublicBookingRequest(choices, customer())),
      (e: unknown) => e instanceof ApiError && e.code === CLIENT_ERROR.INVALID_RESPONSE,
    );
    const slow = createApiClient({ baseUrl: BASE, fetchImpl: hangingFetch, timeoutMs: 20 });
    await assert.rejects(
      createPublicBooking(slow, toPublicBookingRequest(choices, customer())),
      (e: unknown) => e instanceof ApiError && e.code === CLIENT_ERROR.TIMEOUT,
    );
  });
});

describe("form → request mapping", () => {
  test("location: not on location → only on_location:false", () => {
    const r = toPublicBookingRequest(choices, customer({ location_address: "ignored" }));
    assert.equal(r.on_location, false);
    assert.equal("location_in_sint_niklaas" in r, false);
    assert.equal("location_address" in r, false);
  });

  test("location: in Sint-Niklaas → no address; elsewhere → address", () => {
    const sn = toPublicBookingRequest(
      choices,
      customer({ on_location: true, location_in_sint_niklaas: true, location_address: "x" }),
    );
    assert.equal(sn.location_in_sint_niklaas, true);
    assert.equal("location_address" in sn, false);
    const elsewhere = toPublicBookingRequest(
      choices,
      customer({
        on_location: true,
        location_in_sint_niklaas: false,
        location_address: " Straat 1, Gent ",
      }),
    );
    assert.equal(elsewhere.location_in_sint_niklaas, false);
    assert.equal(elsewhere.location_address, "Straat 1, Gent");
  });

  test("vehicle/services: the ids only (service ids, not titles/prices); blanks omitted", () => {
    const r = toPublicBookingRequest(choices, customer());
    assert.deepEqual(r.service_ids, [ID.pkg, ID.service]);
    assert.equal(r.vehicle_type_id, ID.vehicle);
    for (const field of ["notes", "company_name", "vat_number"]) assert.equal(field in r, false);
  });

  test("package + service already in it: both ids are sent (phase 4 rule, no dedup)", () => {
    const r = toPublicBookingRequest(choices, customer());
    assert.deepEqual(r.service_ids, [ID.pkg, ID.service]);
  });

  test("customer e-mail: missing, empty and invalid are refused; valid is sent as is", async () => {
    for (const email of ["", "   ", "jan", "jan@", "@example.test"]) {
      const { api, calls } = apiWith(() => jsonResponse(201, created));
      const error = await createPublicBooking(
        api,
        toPublicBookingRequest(choices, customer({ customer_email: email })),
      ).catch((e) => e);
      assert.ok(error instanceof RequestValidationError, email);
      assert.ok(error.fields.customer_email, email);
      assert.equal(calls.length, 0);
      const view = describePublicBookingError(error);
      assert.equal(view.step, 5);
      assert.ok(view.fields?.customer_email);
    }
    const { api, calls } = apiWith(() => jsonResponse(201, created));
    await createPublicBooking(api, toPublicBookingRequest(choices, customer()));
    assert.equal((calls[0]!.json as { customer_email: string }).customer_email, "jan@example.test");
    assert.ok(!JSON.stringify(calls[0]!.json).includes("geen@autowascenter.be"));
  });

  test("no vehicle/service/slot chosen → refused before sending (back to the planning step)", async () => {
    const { api, calls } = apiWith(() => jsonResponse(201, created));
    const error = await createPublicBooking(
      api,
      toPublicBookingRequest({ ...choices, serviceIds: [], time: "" }, customer()),
    ).catch((e) => e);
    assert.ok(error instanceof RequestValidationError);
    assert.equal(calls.length, 0);
    assert.equal(describePublicBookingError(error).step, 4);
  });
});

describe("error handling (fixed Dutch texts)", () => {
  test("409 slot unavailable → message, back to date & time, reload availability", () => {
    const v = describePublicBookingError(new ApiError(409, "BOOKING_SLOT_UNAVAILABLE", "x"));
    assert.equal(v.kind, "slot_unavailable");
    assert.equal(v.step, 4);
    assert.equal(v.refreshAvailability, true);
  });

  test("422 outside opening hours / in the past → planning error + reload", () => {
    for (const code of ["BOOKING_OUTSIDE_OPENING_HOURS", "BOOKING_IN_PAST"]) {
      const v = describePublicBookingError(new ApiError(422, code, "x"));
      assert.equal(v.kind, "planning");
      assert.equal(v.refreshAvailability, true);
    }
  });

  test("400 from the server → check your details (no backend text)", () => {
    const v = describePublicBookingError(
      new ApiError(400, "VALIDATION_ERROR", "Invalid request: x: y"),
    );
    assert.equal(v.kind, "validation");
    assert.doesNotMatch(v.message, /Invalid request/);
  });

  test("500 / 503 → generic message without details or URLs", () => {
    for (const status of [500, 503]) {
      const v = describePublicBookingError(
        new ApiError(
          status,
          "INTERNAL_ERROR",
          "error at http://api/bookings: relation does not exist",
        ),
      );
      assert.equal(v.kind, "generic");
      assert.equal(
        v.message,
        "Er ging iets mis bij het verwerken van je reservatie. Probeer het opnieuw.",
      );
    }
  });

  test("network error / timeout → retry message; caller abort is silent", () => {
    for (const code of [CLIENT_ERROR.NETWORK, CLIENT_ERROR.TIMEOUT]) {
      assert.equal(describePublicBookingError(new ApiError(0, code, "x")).kind, "network");
    }
    assert.equal(
      describePublicBookingError(new ApiError(0, CLIENT_ERROR.ABORTED, "x")).kind,
      "aborted",
    );
    assert.equal(
      describePublicBookingError(new ApiError(429, "RATE_LIMITED", "x")).kind,
      "rate_limited",
    );
    assert.equal(describePublicBookingError(new ApiError(404, "SERVICE_NOT_FOUND", "x")).step, 1);
  });
});

describe("double-submit protection and stale results", () => {
  test("a second submit while the first is running is ignored", () => {
    const guard = createSubmitGuard();
    const first = guard.start();
    assert.equal(typeof first, "number");
    assert.equal(guard.start(), null, "double click / Enter");
    guard.finish(first!);
    assert.equal(typeof guard.start(), "number", "allowed again after finishing (retry)");
  });

  test("only one request is sent for two rapid submits", async () => {
    const { api, calls } = apiWith(() => jsonResponse(201, created));
    const guard = createSubmitGuard();
    const submit = async () => {
      const id = guard.start();
      if (id === null) return "ignored";
      try {
        await createPublicBooking(api, toPublicBookingRequest(choices, customer()));
        return "sent";
      } finally {
        guard.finish(id);
      }
    };
    assert.deepEqual(await Promise.all([submit(), submit()]), ["sent", "ignored"]);
    assert.equal(calls.length, 1);
  });

  test("after a reset an old response is no longer current (cannot show a stale success)", () => {
    const guard = createSubmitGuard();
    const id = guard.start()!;
    guard.invalidate();
    assert.equal(guard.isCurrent(id), false);
    assert.equal(typeof guard.start(), "number");
  });
});

describe("confirmation uses the server's values", () => {
  test("totals 100 / 21 / 121, pickup, reference: straight from the response", () => {
    const c = bookingConfirmation(created.data as Parameters<typeof bookingConfirmation>[0]);
    assert.equal(c.totalExclVat, "€100,00");
    assert.equal(c.vat, "€21,00");
    assert.equal(c.totalInclVat, "€121,00");
    assert.deepEqual(c.pickup, { date: "2026-10-06", time: "09:30" });
    assert.equal(c.durationMinutes, 600);
    assert.equal(c.reference, "9F8E7D6C");
    assert.deepEqual(c.services, ["Full detail", "Buitenwas"]);
  });
});
