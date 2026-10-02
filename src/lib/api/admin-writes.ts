// Admin WRITE side: every admin mutation of the frontend goes through these functions (the
// counterpart of admin-reads.ts). Each one validates its request with the SHARED Zod contract
// of the backend before anything is sent (strict objects: price, duration, totals, cancel
// token or timestamps can never be included), calls one REST endpoint through the API client
// and validates the response. Validation here is UX; the backend validates again and is
// authoritative for prices, durations, availability and conflicts.

import { format } from "date-fns";
import {
  adminAvailabilityQuery,
  adminAvailabilityResponse,
  adminBookingCreate,
  adminBookingPatch,
  adminBookingWriteResponse,
  blockedPeriodCreate,
  blockedPeriodResponse,
  galleryCreate,
  galleryItemResponse,
  galleryPatch,
  packageContentPut,
  pricingMatrixPut,
  serviceCreate,
  servicePatch,
  serviceResponse,
  settingsPatch,
  settingsResponse,
  vehicleTypeCreate,
  vehicleTypePatch,
  vehicleTypeResponse,
  type AdminAvailabilityQueryInput,
  type AdminBookingCreateInput,
  type AdminBookingPatchInput,
  type AdminPricing,
  type BlockedPeriodCreateInput,
  type GalleryCreateInput,
  type GalleryPatchInput,
  type PricingRowInput,
  type ServiceCreateInput,
  type ServicePatchInput,
  type SettingsPatchInput,
  type VehicleTypeCreateInput,
  type VehicleTypePatchInput,
} from "../../../packages/shared/src/admin-write.ts";
import type { ApiClient } from "./client.ts";
import { RequestValidationError, validated } from "./validation.ts";

type Opts = { signal?: AbortSignal };

export { issuesToFields, RequestValidationError, type FieldErrors } from "./validation.ts";

const id = (value: string) => encodeURIComponent(value);

// ---------- Bookings ----------

/** POST /api/admin/bookings → booking detail + server-computed pricing. */
export async function createAdminBooking(api: ApiClient, input: AdminBookingCreateInput) {
  const body = validated(adminBookingCreate, input);
  return (await api.postAdmin("/api/admin/bookings", body, adminBookingWriteResponse)).data;
}

/**
 * PATCH /api/admin/bookings/:id with only the changed fields (date/time move, status incl.
 * cancel/reactivate, notes, vehicle type, services). The server re-validates the schedule
 * (excluding the booking itself), re-prices and replaces the service snapshots.
 */
export async function updateAdminBooking(
  api: ApiClient,
  bookingId: string,
  patch: AdminBookingPatchInput,
) {
  const body = validated(adminBookingPatch, patch);
  return (
    await api.patchAdmin(`/api/admin/bookings/${id(bookingId)}`, body, adminBookingWriteResponse)
  ).data;
}

export const deleteAdminBooking = (api: ApiClient, bookingId: string) =>
  api.deleteAdmin(`/api/admin/bookings/${id(bookingId)}`);

/** GET /api/admin/availability: the server's slot list (authoritative). */
export async function loadAdminAvailability(
  api: ApiClient,
  query: AdminAvailabilityQueryInput,
  { signal }: Opts = {},
) {
  validated(adminAvailabilityQuery, query);
  const { data } = await api.getAdmin("/api/admin/availability", adminAvailabilityResponse, {
    query: {
      date: query.date,
      vehicle_type_id: query.vehicle_type_id,
      service_ids: Array.isArray(query.service_ids) ? query.service_ids.join(",") : undefined,
      exclude_booking_id: query.exclude_booking_id,
    },
    signal,
  });
  return data;
}

/** Display of the server's pricing (never computed in the browser). */
export function bookingPriceSummary(pricing: AdminPricing) {
  const euro = (v: number) => `€${v.toFixed(2).replace(".", ",")}`;
  return {
    subtotal: pricing.total_excl_vat,
    vat: pricing.vat,
    total: pricing.total_incl_vat,
    text: `${euro(pricing.total_incl_vat)} incl. btw (${euro(pricing.total_excl_vat)} + ${euro(pricing.vat)} btw)`,
  };
}

// ---------- Services & packages ----------

export async function createAdminService(api: ApiClient, input: ServiceCreateInput) {
  const body = validated(serviceCreate, input);
  return (await api.postAdmin("/api/admin/services", body, serviceResponse)).data;
}

export async function updateAdminService(
  api: ApiClient,
  serviceId: string,
  patch: ServicePatchInput,
) {
  const body = validated(servicePatch, patch);
  return (await api.patchAdmin(`/api/admin/services/${id(serviceId)}`, body, serviceResponse)).data;
}

/** PUT the COMPLETE list of contained services (the server replaces it in one transaction). */
export async function updatePackageContent(
  api: ApiClient,
  packageId: string,
  serviceIds: string[],
) {
  const body = validated(packageContentPut, { service_ids: serviceIds });
  return (
    await api.putAdmin(
      `/api/admin/services/${id(packageId)}/package-content`,
      body,
      serviceResponse,
    )
  ).data;
}

export const deleteAdminService = (api: ApiClient, serviceId: string) =>
  api.deleteAdmin(`/api/admin/services/${id(serviceId)}`);

// ---------- Vehicle types & pricing ----------

export async function createAdminVehicleType(api: ApiClient, input: VehicleTypeCreateInput = {}) {
  const body = validated(vehicleTypeCreate, input);
  return (await api.postAdmin("/api/admin/vehicle-types", body, vehicleTypeResponse)).data;
}

export async function updateAdminVehicleType(
  api: ApiClient,
  vehicleTypeId: string,
  patch: VehicleTypePatchInput,
) {
  const body = validated(vehicleTypePatch, patch);
  return (
    await api.patchAdmin(`/api/admin/vehicle-types/${id(vehicleTypeId)}`, body, vehicleTypeResponse)
  ).data;
}

export const deleteAdminVehicleType = (api: ApiClient, vehicleTypeId: string) =>
  api.deleteAdmin(`/api/admin/vehicle-types/${id(vehicleTypeId)}`);

/** PUT the vehicle type's matrix rows; the server saves all rows or none. */
export async function updateAdminPricing(
  api: ApiClient,
  vehicleTypeId: string,
  rows: PricingRowInput[],
) {
  const body = validated(pricingMatrixPut, {
    rows: rows.map((r) => ({
      service_id: r.service_id,
      available: r.available,
      price: r.price,
      duration_minutes: r.duration_minutes,
    })),
  });
  return (
    await api.putAdmin(
      `/api/admin/vehicle-types/${id(vehicleTypeId)}/pricing`,
      body,
      vehicleTypeResponse,
    )
  ).data;
}

// ---------- Blocked periods ----------

export async function createBlockedPeriod(api: ApiClient, input: BlockedPeriodCreateInput) {
  const body = validated(blockedPeriodCreate, input);
  return (await api.postAdmin("/api/admin/blocked-periods", body, blockedPeriodResponse)).data;
}

export const deleteBlockedPeriod = (api: ApiClient, periodId: string) =>
  api.deleteAdmin(`/api/admin/blocked-periods/${id(periodId)}`);

// ---------- Settings ----------

/** PATCH only the given fields; the server merges and validates the resulting settings. */
export async function updateSettings(api: ApiClient, patch: SettingsPatchInput) {
  const body = validated(settingsPatch, patch);
  return (await api.patchAdmin("/api/admin/settings", body, settingsResponse)).data;
}

/** The fields of `next` that differ from `previous` (partial update). */
export function changedFields<T extends object>(previous: T, next: T): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (next[key] !== previous[key]) patch[key] = next[key];
  }
  return patch;
}

// ---------- Gallery ----------

export async function createGalleryItem(api: ApiClient, input: GalleryCreateInput) {
  const body = validated(galleryCreate, input);
  return (await api.postAdmin("/api/admin/gallery", body, galleryItemResponse)).data;
}

export async function updateGalleryItem(api: ApiClient, itemId: string, patch: GalleryPatchInput) {
  const body = validated(galleryPatch, patch);
  return (await api.patchAdmin(`/api/admin/gallery/${id(itemId)}`, body, galleryItemResponse)).data;
}

/** The server deletes the row and, if it owns it, the stored file. */
export const deleteGalleryItem = (api: ApiClient, itemId: string) =>
  api.deleteAdmin(`/api/admin/gallery/${id(itemId)}`);

export const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * POST /api/admin/gallery/upload (multipart, field "file"). The server validates type
 * (magic bytes), size and generates the stored name and URL; the client file name is
 * irrelevant. The type pre-check here only spares a useless upload.
 */
export async function uploadGalleryImage(
  api: ApiClient,
  file: Blob,
  fields: { title?: string; description?: string; sort_order?: number } = {},
) {
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    throw new RequestValidationError({ file: "Alleen JPEG, PNG en WebP zijn toegestaan." });
  }
  const form = new FormData();
  if (fields.title) form.append("title", fields.title);
  if (fields.description) form.append("description", fields.description);
  if (fields.sort_order !== undefined) form.append("sort_order", String(fields.sort_order));
  form.append("file", file, "upload");
  return (
    await api.postAdminForm("/api/admin/gallery/upload", form, galleryItemResponse, {
      timeoutMs: UPLOAD_TIMEOUT_MS,
    })
  ).data;
}

// ---------- Small helpers ----------

/** Today's local date for date inputs (yyyy-MM-dd). */
export const todayLocal = () => format(new Date(), "yyyy-MM-dd");
