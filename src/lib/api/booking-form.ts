// Validation of the admin "new appointment" form (UX only; the server validates again).
// Uses the shared backend contract, then translates its issues into Dutch field messages.
// customer_email is REQUIRED: there is no placeholder address.

import { adminBookingCreate } from "../../../packages/shared/src/admin-write.ts";
import type { AdminBookingCreateInput } from "../../../packages/shared/src/admin-write.ts";
import { issuesToFields, type FieldErrors } from "./admin-writes.ts";

export type CreatableStatus = "nieuw" | "bevestigd" | "voltooid";

export interface BookingFormState {
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  vehicle_brand: string;
  vehicle_model: string;
  vehicle_type_id: string;
  service_ids: string[];
  preferred_date: string;
  preferred_time: string;
  notes: string;
  status: CreatableStatus;
}

export const emptyBookingForm = (date = "", time = ""): BookingFormState => ({
  customer_name: "",
  customer_email: "",
  customer_phone: "",
  vehicle_brand: "",
  vehicle_model: "",
  vehicle_type_id: "",
  service_ids: [],
  preferred_date: date,
  preferred_time: time,
  notes: "",
  status: "bevestigd",
});

const MESSAGES: Record<string, { missing: string; invalid: string }> = {
  customer_name: { missing: "Klantnaam is verplicht", invalid: "Klantnaam is te lang" },
  customer_email: {
    missing: "E-mail is verplicht",
    invalid: "Geef een geldig e-mailadres op",
  },
  customer_phone: { missing: "Telefoon is verplicht", invalid: "Telefoonnummer is te lang" },
  vehicle_type_id: { missing: "Kies een voertuigtype", invalid: "Kies een voertuigtype" },
  service_ids: { missing: "Kies minstens één dienst", invalid: "Ongeldige dienstkeuze" },
  preferred_date: { missing: "Kies een datum", invalid: "Ongeldige datum" },
  preferred_time: { missing: "Kies een vrij tijdslot", invalid: "Kies een vrij tijdslot" },
  vehicle_brand: { missing: "", invalid: "Merk is te lang" },
  vehicle_model: { missing: "", invalid: "Model is te lang" },
  notes: { missing: "", invalid: "Notities zijn te lang" },
  status: { missing: "Kies een status", invalid: "Ongeldige status" },
};

/** The request exactly as the contract allows it: no price, duration, totals or timestamps. */
export function toBookingRequest(form: BookingFormState): AdminBookingCreateInput {
  return {
    vehicle_type_id: form.vehicle_type_id,
    service_ids: form.service_ids,
    preferred_date: form.preferred_date,
    preferred_time: form.preferred_time,
    customer_name: form.customer_name,
    customer_email: form.customer_email,
    customer_phone: form.customer_phone,
    vehicle_brand: form.vehicle_brand,
    vehicle_model: form.vehicle_model,
    notes: form.notes,
    status: form.status,
  };
}

export function validateBookingForm(
  form: BookingFormState,
): { ok: true; request: AdminBookingCreateInput } | { ok: false; errors: FieldErrors } {
  const request = toBookingRequest(form);
  const result = adminBookingCreate.safeParse(request);
  if (result.success) return { ok: true, request };

  const raw = issuesToFields(result.error.issues);
  const errors: FieldErrors = {};
  for (const field of Object.keys(raw)) {
    const value = request[field as keyof AdminBookingCreateInput];
    const empty =
      value === undefined ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    const text = MESSAGES[field];
    errors[field] = text
      ? empty && text.missing
        ? text.missing
        : text.invalid
      : "Ongeldige waarde";
  }
  return { ok: false, errors };
}
