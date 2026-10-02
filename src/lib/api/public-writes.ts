// Public booking WRITE: the /reservatie submit → POST /api/bookings (one request; the server
// creates the booking and its service snapshots in ONE transaction). No token, no Auth0.
//
// The request is built field by field from the form (never by spreading form state) and
// validated with the shared contract (packages/shared/src/booking.ts) before it is sent.
// Price, VAT, totals, duration, location fee, status, cancel token, start/end and pickup
// moment are computed by the server and only read from its response.

import {
  bookingCreatedResponseSchema,
  bookingRequestSchema,
  type BookingCreatedResponse,
  type BookingRequest,
} from "../../../packages/shared/src/booking.ts";
import { ApiError, CLIENT_ERROR, type ApiClient } from "./client.ts";
import { validated } from "./validation.ts";

/** The customer step of the /reservatie form (react-hook-form values). */
export interface PublicCustomerForm {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  vehicle_brand: string;
  vehicle_model: string;
  notes?: string;
  company_name?: string;
  vat_number?: string;
  on_location: boolean;
  location_in_sint_niklaas?: boolean;
  location_address?: string;
}

export interface PublicBookingChoices {
  vehicleTypeId: string;
  /** services.id of the chosen options (not the vehicle_type_services ids). */
  serviceIds: string[];
  /** Local date/time as chosen from GET /api/availability (Europe/Brussels). */
  date: string;
  time: string;
}

/** Optional free text: omitted when blank. */
const optional = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * UI form state → API booking request, explicitly. Location fields are only sent when they
 * apply: on location in Sint-Niklaas → no address; elsewhere → the address.
 */
export function toPublicBookingRequest(
  choices: PublicBookingChoices,
  form: PublicCustomerForm,
): BookingRequest {
  const request: BookingRequest = {
    vehicle_type_id: choices.vehicleTypeId,
    service_ids: [...choices.serviceIds],
    preferred_date: choices.date,
    preferred_time: choices.time,
    customer_name: form.customer_name,
    customer_email: form.customer_email,
    customer_phone: form.customer_phone,
    vehicle_brand: form.vehicle_brand,
    vehicle_model: form.vehicle_model,
    notes: optional(form.notes),
    company_name: optional(form.company_name),
    vat_number: optional(form.vat_number),
    on_location: form.on_location,
  };
  if (form.on_location) {
    const inSintNiklaas = !!form.location_in_sint_niklaas;
    request.location_in_sint_niklaas = inSintNiklaas;
    if (!inSintNiklaas) request.location_address = optional(form.location_address);
  }
  // Drop undefined keys so the JSON body contains only real values.
  return Object.fromEntries(
    Object.entries(request).filter(([, v]) => v !== undefined),
  ) as BookingRequest;
}

export type PublicBooking = BookingCreatedResponse["data"];

/**
 * POST /api/bookings. Throws RequestValidationError (nothing sent) or ApiError. The result
 * is the server's booking: use it as is for the confirmation.
 */
export async function createPublicBooking(
  api: ApiClient,
  request: BookingRequest,
  { signal }: { signal?: AbortSignal } = {},
): Promise<PublicBooking> {
  validated(bookingRequestSchema, request);
  // The validated input is sent (not the parsed output), so defaults stay server-side.
  return (await api.post("/api/bookings", request, bookingCreatedResponseSchema, { signal })).data;
}

// ---------- Confirmation (display of the server's values only) ----------

const euro = (v: number) => `€${v.toFixed(2).replace(".", ",")}`;

export function bookingConfirmation(booking: PublicBooking) {
  return {
    reference: booking.id.slice(0, 8).toUpperCase(),
    dropOff: { date: booking.preferred_date, time: booking.preferred_time },
    pickup: { date: booking.pickup_date, time: booking.pickup_time },
    durationMinutes: booking.total_duration_minutes,
    services: booking.services.map((s) => s.title),
    totalExclVat: euro(booking.pricing.total_excl_vat),
    vat: euro(booking.pricing.vat),
    totalInclVat: euro(booking.pricing.total_incl_vat),
  };
}

// ---------- Errors ----------

export interface PublicBookingErrorView {
  kind:
    | "slot_unavailable"
    | "planning"
    | "validation"
    | "not_available"
    | "rate_limited"
    | "network"
    | "generic"
    | "aborted";
  /** Fixed Dutch text: never backend details, URLs or database messages. */
  message: string;
  /** Wizard step the customer should go back to, if any (4 = date & time, 5 = details). */
  step?: number;
  /** The free slots must be reloaded from GET /api/availability. */
  refreshAvailability: boolean;
  /** Field errors (client validation), e.g. customer_email. */
  fields?: Record<string, string>;
}

export function describePublicBookingError(error: unknown): PublicBookingErrorView {
  const generic: PublicBookingErrorView = {
    kind: "generic",
    message: "Er ging iets mis bij het verwerken van je reservatie. Probeer het opnieuw.",
    refreshAvailability: false,
  };
  if (!(error instanceof ApiError)) return generic;
  const { status, code } = error;

  if (code === CLIENT_ERROR.ABORTED) return { ...generic, kind: "aborted", message: "" };
  if (code === CLIENT_ERROR.VALIDATION) {
    const fields = (error as { fields?: Record<string, string> }).fields ?? {};
    const scheduling = ["vehicle_type_id", "service_ids", "preferred_date", "preferred_time"];
    const onlyScheduling = Object.keys(fields).every((f) => scheduling.includes(f));
    return {
      kind: "validation",
      message: onlyScheduling
        ? "Kies opnieuw een voertuig, dienst(en), datum en tijdstip."
        : "Controleer uw gegevens.",
      step: onlyScheduling ? 4 : 5,
      refreshAvailability: false,
      fields,
    };
  }
  if (code === "BOOKING_SLOT_UNAVAILABLE") {
    return {
      kind: "slot_unavailable",
      message: "Dit tijdstip is intussen niet meer beschikbaar. Kies een ander tijdstip.",
      step: 4,
      refreshAvailability: true,
    };
  }
  if (code === "BOOKING_OUTSIDE_OPENING_HOURS" || code === "BOOKING_IN_PAST" || status === 422) {
    return {
      kind: "planning",
      message:
        code === "BOOKING_IN_PAST"
          ? "Dit tijdstip ligt in het verleden. Kies een ander tijdstip."
          : "Dit tijdstip valt buiten onze openingsuren. Kies een ander tijdstip.",
      step: 4,
      refreshAvailability: true,
    };
  }
  if (code === "VEHICLE_TYPE_NOT_FOUND" || code === "SERVICE_NOT_FOUND" || status === 404) {
    return {
      kind: "not_available",
      message:
        "Een gekozen voertuigtype of dienst is niet meer beschikbaar. Maak opnieuw een keuze.",
      step: 1,
      refreshAvailability: true,
    };
  }
  if (status === 400) {
    return {
      kind: "validation",
      message: "Controleer uw gegevens.",
      step: 5,
      refreshAvailability: false,
    };
  }
  if (status === 429) {
    return {
      kind: "rate_limited",
      message: "Te veel aanvragen na elkaar. Probeer het over een minuutje opnieuw.",
      refreshAvailability: false,
    };
  }
  if (code === CLIENT_ERROR.NETWORK || code === CLIENT_ERROR.TIMEOUT) {
    return {
      kind: "network",
      message:
        "Geen verbinding met de server. Controleer uw internetverbinding en probeer opnieuw.",
      refreshAvailability: false,
    };
  }
  return generic; // 500, 503, unexpected response
}

// ---------- Double-submit protection ----------

/**
 * One booking request at a time, and a result only counts for the submission that is still
 * current (a reset or a newer attempt makes older results irrelevant).
 */
export function createSubmitGuard() {
  let running = false;
  let current = 0;
  return {
    /** null when a submission is already running (double click, Enter). */
    start(): number | null {
      if (running) return null;
      running = true;
      return ++current;
    },
    isCurrent: (id: number) => id === current,
    finish(id: number) {
      if (id === current) running = false;
    },
    /** Wizard reset / page left: pending results are ignored. */
    invalidate() {
      current++;
      running = false;
    },
  };
}
