import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { emptyBookingForm, toBookingRequest, validateBookingForm } from "./booking-form.ts";
import { ID } from "./test-fixtures.ts";

const filled = () => ({
  ...emptyBookingForm("2026-10-05", "10:00"),
  customer_name: "Jan Peeters",
  customer_phone: "0470000000",
  customer_email: "jan@example.test",
  vehicle_type_id: ID.vehicle,
  service_ids: [ID.service],
});

describe("admin booking form: customer e-mail is required", () => {
  test("no e-mail → frontend validation error (no placeholder address)", () => {
    const result = validateBookingForm({ ...filled(), customer_email: "" });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.errors.customer_email, "E-mail is verplicht");
  });

  test("whitespace-only e-mail → required error", () => {
    const result = validateBookingForm({ ...filled(), customer_email: "   " });
    assert.equal(!result.ok && result.errors.customer_email, "E-mail is verplicht");
  });

  test("invalid e-mail → validation error", () => {
    for (const email of ["jan", "jan@", "@example.test", "jan@example"]) {
      const result = validateBookingForm({ ...filled(), customer_email: email });
      assert.equal(
        !result.ok && result.errors.customer_email,
        "Geef een geldig e-mailadres op",
        email,
      );
    }
  });

  test("valid e-mail → request with exactly that address", () => {
    const result = validateBookingForm(filled());
    assert.ok(result.ok);
    assert.equal(result.request.customer_email, "jan@example.test");
    assert.ok(!JSON.stringify(result).includes("geen@autowascenter.be"));
  });
});

describe("admin booking form: choices instead of free price/duration/service name", () => {
  test("vehicle type, at least one service and a slot are required", () => {
    const result = validateBookingForm({
      ...filled(),
      vehicle_type_id: "",
      service_ids: [],
      preferred_time: "",
    });
    assert.ok(!result.ok);
    assert.equal(result.errors.vehicle_type_id, "Kies een voertuigtype");
    assert.equal(result.errors.service_ids, "Kies minstens één dienst");
    assert.equal(result.errors.preferred_time, "Kies een vrij tijdslot");
  });

  test("the request has no price, duration, service title or timestamps", () => {
    const request = toBookingRequest(filled()) as Record<string, unknown>;
    for (const field of [
      "total_price",
      "total_duration_minutes",
      "service_title",
      "start_at",
      "end_at",
      "cancel_token",
    ]) {
      assert.equal(field in request, false, field);
    }
  });
});
