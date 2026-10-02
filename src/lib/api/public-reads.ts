// Public READ side: one typed function per public endpoint (no token, no Auth0). Responses
// are validated with the shared contracts (packages/shared/src/public.ts and booking.ts).
// Image URLs are used exactly as returned: old Supabase Storage URLs and new self-hosted
// /uploads/gallery/... URLs are both plain image URLs; nothing is rewritten here.

import {
  availabilityQuerySchema,
  availabilityResponseSchema,
} from "../../../packages/shared/src/booking.ts";
import {
  listResponse,
  publicGalleryItem,
  publicReview,
  publicService,
  publicSiteSettingsResponse,
  publicVehicleType,
  vehicleTypeServiceOption,
} from "../../../packages/shared/src/public.ts";
import { ApiError, CLIENT_ERROR, type ApiClient } from "./client.ts";

type Opts = { signal?: AbortSignal };
type LimitOpts = Opts & { limit?: number };

const servicesResponse = listResponse(publicService);
const galleryResponse = listResponse(publicGalleryItem);
const reviewsResponse = listResponse(publicReview);
const vehicleTypesResponse = listResponse(publicVehicleType);
const vehicleTypeServicesResponse = listResponse(vehicleTypeServiceOption);

/** GET /api/services: active services by sort order (optionally the first `limit`). */
export async function getPublicServices(api: ApiClient, { limit, signal }: LimitOpts = {}) {
  return (await api.get("/api/services", servicesResponse, { query: { limit }, signal })).data;
}

/** GET /api/gallery: gallery items by sort order. */
export async function getPublicGallery(api: ApiClient, { limit, signal }: LimitOpts = {}) {
  return (await api.get("/api/gallery", galleryResponse, { query: { limit }, signal })).data;
}

/** GET /api/reviews: approved reviews only (enforced by the API), newest first. */
export async function getPublicReviews(api: ApiClient, { limit, signal }: LimitOpts = {}) {
  return (await api.get("/api/reviews", reviewsResponse, { query: { limit }, signal })).data;
}

/** GET /api/vehicle-types: active vehicle types by sort order. */
export async function getPublicVehicleTypes(api: ApiClient, { signal }: Opts = {}) {
  return (await api.get("/api/vehicle-types", vehicleTypesResponse, { signal })).data;
}

/**
 * GET /api/vehicle-types/:id/services: the bookable, active and available services for
 * one vehicle type, with this type's price/duration and (packages) the included titles.
 */
export async function getPublicVehicleTypeServices(
  api: ApiClient,
  vehicleTypeId: string,
  { signal }: Opts = {},
) {
  return (
    await api.get(
      `/api/vehicle-types/${encodeURIComponent(vehicleTypeId)}/services`,
      vehicleTypeServicesResponse,
      { signal },
    )
  ).data;
}

/**
 * GET /api/availability: the server's free start times (blocked periods, opening hours,
 * existing bookings and multi-day work are applied server-side) with pickup moments.
 */
export async function getPublicAvailability(
  api: ApiClient,
  query: { date: string; vehicle_type_id: string; service_ids: string[] },
  { signal }: Opts = {},
) {
  if (!availabilityQuerySchema.safeParse(query).success) {
    throw new ApiError(0, CLIENT_ERROR.VALIDATION, "Invalid availability query.");
  }
  return (
    await api.get("/api/availability", availabilityResponseSchema, {
      query: {
        date: query.date,
        vehicle_type_id: query.vehicle_type_id,
        service_ids: query.service_ids.join(","),
      },
      signal,
    })
  ).data;
}

/** GET /api/site-settings: only km_fee and free_km (no admin data). */
export async function getPublicSiteSettings(api: ApiClient, { signal }: Opts = {}) {
  return (await api.get("/api/site-settings", publicSiteSettingsResponse, { signal })).data;
}

/** Fallback content (e.g. example photos) is kept when the API has no items. */
export const withFallback = <T>(items: T[], fallback: T[]): T[] =>
  items.length > 0 ? items : fallback;
