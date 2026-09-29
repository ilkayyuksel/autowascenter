// Request and response contracts of the public endpoints.
//
// Field names are snake_case on purpose: they match the columns the current frontend
// reads from Supabase, so the frontend can later switch to this API without renaming.
// These schemas move to packages/shared once the frontend consumes the API.

import { z } from "zod";

/** Every successful list response: `{ "data": [...] }`. */
export const listResponse = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) });

export const limitQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const vehicleTypeParams = z.object({
  vehicleTypeId: z.uuid(),
});

export const serviceKind = z.enum(["dienst", "pakket", "extra"]);

/** GET /api/services (union of ServicesPreview.tsx and routes/diensten.tsx). */
export const publicService = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  badge: z.string().nullable(),
  icon: z.string().nullable(),
  image_url: z.string().nullable(),
  bookable: z.boolean(),
  kind: serviceKind,
  /** LEGACY base price (excl. VAT), shown on the home page. */
  price: z.number().nullable(),
  /** LEGACY base duration, shown on the home page. */
  duration_minutes: z.number().int().nullable(),
});

/** GET /api/gallery (routes/galerij.tsx, RealisationsPreview.tsx). */
export const publicGalleryItem = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  image_url: z.string(),
  before_image_url: z.string().nullable(),
  category: z.string().nullable(),
});

/** GET /api/reviews (Testimonials.tsx). */
export const publicReview = z.object({
  id: z.uuid(),
  customer_name: z.string(),
  rating: z.number().int().min(1).max(5),
  content: z.string(),
});

/** GET /api/vehicle-types (routes/reservatie.tsx step 1). */
export const publicVehicleType = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  image_url: z.string().nullable(),
});

/**
 * GET /api/vehicle-types/:id/services (routes/reservatie.tsx steps 2-3).
 * Same shape as the frontend's `ServiceOption`.
 */
export const vehicleTypeServiceOption = z.object({
  /** vehicle_type_services.id: the frontend's selection key. */
  id: z.uuid(),
  service_id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  badge: z.string().nullable(),
  kind: serviceKind,
  /** Price for this vehicle type, excl. VAT. */
  price: z.number(),
  duration_minutes: z.number().int(),
  /** For packages: titles of the active services it contains (display only). */
  includes: z.array(z.string()),
});

export type PublicService = z.infer<typeof publicService>;
export type PublicGalleryItem = z.infer<typeof publicGalleryItem>;
export type PublicReview = z.infer<typeof publicReview>;
export type PublicVehicleType = z.infer<typeof publicVehicleType>;
export type VehicleTypeServiceOption = z.infer<typeof vehicleTypeServiceOption>;
