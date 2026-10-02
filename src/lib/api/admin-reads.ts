// Admin READ side: one loader per admin page. Each loader calls exactly one admin endpoint
// (validated with the shared Zod contract) and maps the authoritative API response to the
// small UI model the existing page already renders. The backend contract is never bent for
// a component; differences are absorbed here.

import { format, parseISO } from "date-fns";
import { nl } from "date-fns/locale";
import {
  agendaResponse,
  blockedPeriodsResponse,
  bookingDetailResponse,
  bookingsListResponse,
  dashboardResponse,
  galleryResponse,
  servicesResponse,
  settingsResponse,
  vehicleTypesResponse,
  type AdminBlockedPeriod,
  type AdminBooking,
  type AdminVehicleType,
  type DashboardData,
  type PaginationMeta,
} from "../../../packages/shared/src/admin.ts";
import type { ApiClient } from "./client.ts";

type Opts = { signal?: AbortSignal };

export type BookingStatus = AdminBooking["status"];
export type ServiceKind = "dienst" | "extra" | "pakket";

// ---------- Date/time display (all values are already Europe/Brussels local) ----------

/** Pickup moment for display: "16:30", or "din 6 okt. 09:00" when it is on a later day. */
export function pickupLabel(
  b: Pick<AdminBooking, "preferred_date" | "pickup_date" | "pickup_time">,
) {
  return b.pickup_date === b.preferred_date
    ? b.pickup_time
    : `${format(parseISO(b.pickup_date), "EEE d MMM", { locale: nl })} ${b.pickup_time}`;
}

// ---------- Dashboard: GET /api/admin/dashboard ----------

export type DashboardView = DashboardData;

export async function loadDashboard(api: ApiClient, { signal }: Opts = {}) {
  const { data } = await api.getAdmin("/api/admin/dashboard", dashboardResponse, { signal });
  return data;
}

// ---------- Agenda: GET /api/admin/agenda?start=&end= ----------

export interface AgendaBooking {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_info: string | null;
  service_title: string | null;
  preferred_date: string;
  preferred_time: string;
  total_duration_minutes: number;
  status: BookingStatus;
  notes: string | null;
  /** Pickup time when it is on the same day as the start, otherwise null. */
  same_day_end_time: string | null;
  /** Pickup on a later day (multi-day work). */
  ends_later: boolean;
  pickup_date: string;
  pickup_time: string;
}

export type AgendaBlocked = Pick<
  AdminBlockedPeriod,
  "id" | "start_date" | "end_date" | "start_time" | "end_time" | "reason"
>;

export function toAgendaBooking(b: AdminBooking): AgendaBooking {
  const sameDay = b.pickup_date === b.preferred_date;
  return {
    id: b.id,
    customer_name: b.customer_name,
    customer_email: b.customer_email,
    customer_phone: b.customer_phone,
    vehicle_brand: b.vehicle_brand,
    vehicle_model: b.vehicle_model,
    vehicle_info: b.vehicle_info,
    service_title: b.service_title,
    preferred_date: b.preferred_date,
    preferred_time: b.preferred_time,
    total_duration_minutes: b.total_duration_minutes,
    status: b.status,
    notes: b.notes,
    same_day_end_time: sameDay ? b.pickup_time : null,
    ends_later: !sameDay,
    pickup_date: b.pickup_date,
    pickup_time: b.pickup_time,
  };
}

const toBlocked = (p: AdminBlockedPeriod): AgendaBlocked => ({
  id: p.id,
  start_date: p.start_date,
  end_date: p.end_date,
  start_time: p.start_time,
  end_time: p.end_time,
  reason: p.reason,
});

/** `start`/`end`: inclusive local dates (yyyy-MM-dd), at most 62 days apart. */
export async function loadAgenda(
  api: ApiClient,
  range: { start: string; end: string },
  { signal }: Opts = {},
) {
  const { data } = await api.getAdmin("/api/admin/agenda", agendaResponse, {
    query: range,
    signal,
  });
  return {
    bookings: data.bookings.map(toAgendaBooking),
    blocked: data.blocked_periods.map(toBlocked),
  };
}

export interface AgendaVehicleService {
  /** vehicle_type_services.id */
  id: string;
  service_id: string;
  title: string;
  price: number;
  duration_minutes: number;
}

/**
 * Options of the agenda's "new appointment" form, from the one vehicle-types response:
 * active vehicle types, and per type the available rows of active, bookable services.
 */
export function toAgendaVehicleOptions(types: AdminVehicleType[]) {
  const vehicleTypes = types.filter((t) => t.active).map((t) => ({ id: t.id, title: t.title }));
  const servicesByType: Record<string, AgendaVehicleService[]> = {};
  for (const t of types) {
    servicesByType[t.id] = t.services
      .filter((r) => r.available && r.service_active && r.service_bookable)
      .map((r) => ({
        id: r.id,
        service_id: r.service_id,
        title: r.title,
        price: r.price,
        duration_minutes: r.duration_minutes,
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }
  return { vehicleTypes, servicesByType };
}

export async function loadAgendaVehicleOptions(api: ApiClient, { signal }: Opts = {}) {
  const { data } = await api.getAdmin("/api/admin/vehicle-types", vehicleTypesResponse, {
    signal,
  });
  return toAgendaVehicleOptions(data);
}

// ---------- Reservations: GET /api/admin/bookings, GET /api/admin/bookings/:id ----------

export interface BookingRow {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  vehicle_info: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  service_title: string | null;
  preferred_date: string;
  preferred_time: string;
  /** Replaces the legacy end_time text: derived from pickup_date/pickup_time. */
  pickup_label: string;
  total_duration_minutes: number;
  total_price: number;
  on_location: boolean;
  location_in_sint_niklaas: boolean | null;
  location_address: string | null;
  location_fee: number;
  company_name: string | null;
  vat_number: string | null;
  notes: string | null;
  status: BookingStatus;
  created_at: string;
}

export function toBookingRow(b: AdminBooking): BookingRow {
  return {
    id: b.id,
    customer_name: b.customer_name,
    customer_email: b.customer_email,
    customer_phone: b.customer_phone,
    vehicle_info: b.vehicle_info,
    vehicle_brand: b.vehicle_brand,
    vehicle_model: b.vehicle_model,
    service_title: b.service_title,
    preferred_date: b.preferred_date,
    preferred_time: b.preferred_time,
    pickup_label: pickupLabel(b),
    total_duration_minutes: b.total_duration_minutes,
    total_price: b.total_price,
    on_location: b.on_location,
    location_in_sint_niklaas: b.location_in_sint_niklaas,
    location_address: b.location_address,
    location_fee: b.location_fee,
    company_name: b.company_name,
    vat_number: b.vat_number,
    notes: b.notes,
    status: b.status,
    created_at: b.created_at,
  };
}

export const BOOKINGS_PAGE_SIZE = 50;

export async function loadBookingsPage(
  api: ApiClient,
  { page, limit = BOOKINGS_PAGE_SIZE }: { page: number; limit?: number },
  { signal }: Opts = {},
): Promise<{ items: BookingRow[]; meta: PaginationMeta }> {
  const { data, meta } = await api.getAdmin("/api/admin/bookings", bookingsListResponse, {
    query: { page, limit },
    signal,
  });
  return { items: data.map(toBookingRow), meta };
}

export interface BookingDetailView extends BookingRow {
  lines: { id: string; service_title: string; price: number; duration_minutes: number }[];
}

export async function loadBookingDetail(
  api: ApiClient,
  id: string,
  { signal }: Opts = {},
): Promise<BookingDetailView> {
  const { data } = await api.getAdmin(
    `/api/admin/bookings/${encodeURIComponent(id)}`,
    bookingDetailResponse,
    { signal },
  );
  return {
    ...toBookingRow(data),
    lines: data.services.map((l) => ({
      id: l.id,
      service_title: l.service_title,
      price: l.price,
      duration_minutes: l.duration_minutes,
    })),
  };
}

// ---------- Services: GET /api/admin/services ----------

export interface ServiceItem {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  badge: string | null;
  bookable: boolean;
  sort_order: number;
  active: boolean;
  kind: ServiceKind;
}

export async function loadServices(api: ApiClient, { signal }: Opts = {}) {
  const { data } = await api.getAdmin("/api/admin/services", servicesResponse, { signal });
  const items: ServiceItem[] = data.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    icon: s.icon,
    category: s.category,
    badge: s.badge,
    bookable: s.bookable,
    sort_order: s.sort_order,
    active: s.active,
    kind: s.kind,
  }));
  /** Package contents per package id (was: package_services rows). */
  const contents: Record<string, string[]> = {};
  for (const s of data)
    if (s.included_service_ids.length) contents[s.id] = [...s.included_service_ids];
  return { items, contents };
}

// ---------- Vehicles & pricing: GET /api/admin/vehicle-types ----------

export interface VehicleTypeItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  active: boolean;
}

export interface PricingService {
  id: string;
  title: string;
  bookable: boolean;
  kind: ServiceKind;
}

export interface PricingRow {
  /** vehicle_type_services.id */
  id: string;
  vehicle_type_id: string;
  service_id: string;
  available: boolean;
  price: number;
  duration_minutes: number;
}

/**
 * One response carries everything the page needs: the types, the full pricing matrix, and
 * per row the service's title/kind/active/bookable. The page still shows only rows of
 * active, bookable services (as before), so that list is derived from the matrix.
 */
export function toVehiclesPage(types: AdminVehicleType[]) {
  const vehicles: VehicleTypeItem[] = types.map((t) => ({
    id: t.id,
    slug: t.slug,
    title: t.title,
    description: t.description,
    image_url: t.image_url,
    sort_order: t.sort_order,
    active: t.active,
  }));
  const vts: PricingRow[] = types.flatMap((t) =>
    t.services.map((r) => ({
      id: r.id,
      vehicle_type_id: t.id,
      service_id: r.service_id,
      available: r.available,
      price: r.price,
      duration_minutes: r.duration_minutes,
    })),
  );
  const services = new Map<string, PricingService>();
  for (const t of types) {
    for (const r of t.services) {
      if (r.service_active && r.service_bookable && !services.has(r.service_id)) {
        services.set(r.service_id, {
          id: r.service_id,
          title: r.title,
          bookable: true,
          kind: r.kind,
        });
      }
    }
  }
  return {
    vehicles,
    vts,
    services: [...services.values()].sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export async function loadVehiclesPage(api: ApiClient, { signal }: Opts = {}) {
  const { data } = await api.getAdmin("/api/admin/vehicle-types", vehicleTypesResponse, {
    signal,
  });
  return toVehiclesPage(data);
}

// ---------- Blocked periods: GET /api/admin/blocked-periods ----------

export type BlockedPeriodItem = AgendaBlocked;

/** Newest start date first (the API's order, as before). */
export async function loadBlockedPeriods(api: ApiClient, { signal }: Opts = {}) {
  const { data } = await api.getAdmin("/api/admin/blocked-periods", blockedPeriodsResponse, {
    signal,
  });
  return data.map(toBlocked);
}

// ---------- Settings: GET /api/admin/settings (one object, not an array) ----------

export interface SettingsForm {
  id: string;
  km_fee: number;
  free_km: number;
  base_address: string;
  base_city: string;
  opening_hour: string;
  closing_hour: string;
  slot_interval_minutes: number;
  notification_email: string | null;
}

export async function loadSettings(api: ApiClient, { signal }: Opts = {}): Promise<SettingsForm> {
  const { data } = await api.getAdmin("/api/admin/settings", settingsResponse, { signal });
  return {
    id: data.id,
    km_fee: data.km_fee,
    free_km: data.free_km,
    base_address: data.base_address,
    base_city: data.base_city,
    opening_hour: data.opening_hour,
    closing_hour: data.closing_hour,
    slot_interval_minutes: data.slot_interval_minutes,
    notification_email: data.notification_email,
  };
}

// ---------- Gallery: GET /api/admin/gallery ----------

export interface GalleryItem {
  id: string;
  title: string | null;
  description: string | null;
  image_url: string;
  before_image_url: string | null;
  category: string | null;
  sort_order: number;
}

export async function loadGallery(api: ApiClient, { signal }: Opts = {}): Promise<GalleryItem[]> {
  const { data } = await api.getAdmin("/api/admin/gallery", galleryResponse, { signal });
  return data.map((g) => ({
    id: g.id,
    title: g.title,
    description: g.description,
    image_url: g.image_url,
    before_image_url: g.before_image_url,
    category: g.category,
    sort_order: g.sort_order,
  }));
}
