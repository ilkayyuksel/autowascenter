import { asc } from "drizzle-orm";
import type { Database } from "../db/index.ts";
import { galleryItems } from "../db/schema/index.ts";
import type { PublicGalleryItem } from "../contracts/public.ts";

/** All gallery items, ordered by sort_order like the current frontend; id as a stable tiebreak. */
export async function listPublicGallery(
  db: Database,
  { limit }: { limit?: number } = {},
): Promise<PublicGalleryItem[]> {
  const query = db
    .select({
      id: galleryItems.id,
      title: galleryItems.title,
      description: galleryItems.description,
      image_url: galleryItems.imageUrl,
      before_image_url: galleryItems.beforeImageUrl,
      category: galleryItems.category,
    })
    .from(galleryItems)
    .orderBy(asc(galleryItems.sortOrder), asc(galleryItems.id));

  return limit ? query.limit(limit) : query;
}
