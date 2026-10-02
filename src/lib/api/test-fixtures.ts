// Test doubles for the API client tests: a recording fetch and contract-valid API payloads.
// No real Auth0 tokens or production API: everything is local and fake.

export const BASE = "http://api.test";
export const ACCESS_TOKEN = "test-header.test-payload.test-signature";

export function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const apiError = (status: number, code: string, message = "Backend message") =>
  jsonResponse(status, { error: { code, message } });

export interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
}

/** fetch double: records every call and answers with `respond(url)`. */
export function fakeFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
    });
    return respond(String(input));
  }) as typeof fetch;
  return { impl, calls };
}

/** fetch double that never answers until aborted. */
export const hangingFetch = ((_: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  })) as typeof fetch;

export const ID = {
  booking: "11111111-1111-4111-8111-111111111111",
  booking2: "11111111-1111-4111-8111-111111111112",
  vehicle: "22222222-2222-4222-8222-222222222221",
  vehicle2: "22222222-2222-4222-8222-222222222222",
  service: "33333333-3333-4333-8333-333333333331",
  service2: "33333333-3333-4333-8333-333333333332",
  pkg: "33333333-3333-4333-8333-333333333333",
  vts: "44444444-4444-4444-8444-444444444441",
  vts2: "44444444-4444-4444-8444-444444444442",
  vts3: "44444444-4444-4444-8444-444444444443",
  blocked: "55555555-5555-4555-8555-555555555551",
  settings: "66666666-6666-4666-8666-666666666661",
  gallery: "77777777-7777-4777-8777-777777777771",
  line: "88888888-8888-4888-8888-888888888881",
} as const;

const TS = "2026-10-01T08:00:00.000Z";

export function adminBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.booking,
    status: "bevestigd",
    customer_name: "Jan Peeters",
    customer_email: "jan@example.test",
    customer_phone: "0470000000",
    company_name: null,
    vat_number: null,
    notes: null,
    vehicle_type: { id: ID.vehicle, slug: "personenwagen", title: "Personenwagen" },
    vehicle_brand: "Volvo",
    vehicle_model: "V60",
    vehicle_info: "Volvo V60",
    service_id: ID.service,
    service_title: "Buitenwas",
    preferred_date: "2026-10-05",
    preferred_time: "10:00",
    start_at: "2026-10-05T08:00:00.000Z",
    end_at: "2026-10-05T09:30:00.000Z",
    pickup_date: "2026-10-05",
    pickup_time: "11:30",
    total_duration_minutes: 90,
    total_price: 49.59,
    location_fee: 0,
    on_location: false,
    location_in_sint_niklaas: null,
    location_address: null,
    location_distance_km: null,
    cancelled_at: null,
    created_at: TS,
    updated_at: TS,
    ...overrides,
  };
}

export function blockedPeriod(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.blocked,
    start_date: "2026-10-06",
    end_date: "2026-10-07",
    start_time: null,
    end_time: null,
    reason: "Vakantie",
    created_at: TS,
    updated_at: TS,
    ...overrides,
  };
}

export const dashboardBody = () => ({
  data: {
    today: "2026-10-05",
    week_start: "2026-10-05",
    week_end: "2026-10-11",
    counts: { active_services: 4, gallery_items: 3, active_vehicle_types: 2 },
    week: {
      booking_count: 1,
      revenue_excl_vat: 49.59,
      days: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-10-${String(5 + i).padStart(2, "0")}`,
        booking_count: i === 0 ? 1 : 0,
        revenue_excl_vat: i === 0 ? 49.59 : 0,
      })),
    },
    today_bookings: [
      {
        id: ID.booking,
        customer_name: "Jan Peeters",
        service_title: "Buitenwas",
        preferred_time: "10:00",
        status: "bevestigd",
      },
    ],
    next_booking: {
      id: ID.booking,
      customer_name: "Jan Peeters",
      service_title: "Buitenwas",
      preferred_date: "2026-10-05",
      preferred_time: "10:00",
      start_at: "2026-10-05T08:00:00.000Z",
      status: "bevestigd",
    },
  },
});

export function adminService(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.service,
    title: "Buitenwas",
    description: null,
    kind: "dienst",
    category: "Exterieur",
    badge: null,
    icon: "sparkles",
    image_url: null,
    bookable: true,
    active: true,
    sort_order: 0,
    price: null,
    duration_minutes: null,
    included_service_ids: [],
    created_at: TS,
    updated_at: TS,
    ...overrides,
  };
}

export function matrixRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.vts,
    service_id: ID.service,
    title: "Buitenwas",
    kind: "dienst",
    service_active: true,
    service_bookable: true,
    available: true,
    price: 30,
    duration_minutes: 60,
    ...overrides,
  };
}

export function vehicleType(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.vehicle,
    slug: "personenwagen",
    title: "Personenwagen",
    description: null,
    image_url: null,
    icon: null,
    sort_order: 0,
    active: true,
    created_at: TS,
    updated_at: TS,
    services: [matrixRow()],
    ...overrides,
  };
}

export const settingsBody = () => ({
  data: {
    id: ID.settings,
    opening_hour: "10:00",
    closing_hour: "18:00",
    slot_interval_minutes: 30,
    km_fee: 0.5,
    free_km: 10,
    base_address: "Kerkstraat 1",
    base_city: "Sint-Niklaas",
    notification_email: null,
    created_at: TS,
    updated_at: TS,
  },
});

export function galleryItem(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.gallery,
    title: "Polijstbeurt",
    description: null,
    image_url: "http://localhost:3001/uploads/gallery/0b0e4d4c-9a1f-4c55-8f3e-2f5c6a7b8c9d.jpg",
    before_image_url: null,
    category: null,
    sort_order: 0,
    created_at: TS,
    updated_at: TS,
    ...overrides,
  };
}
