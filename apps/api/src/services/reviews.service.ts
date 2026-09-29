import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/index.ts";
import { reviews } from "../db/schema/index.ts";
import type { PublicReview } from "../contracts/public.ts";

/** Approved reviews only, newest first (same as Testimonials.tsx). */
export async function listPublicReviews(
  db: Database,
  { limit }: { limit?: number } = {},
): Promise<PublicReview[]> {
  const query = db
    .select({
      id: reviews.id,
      customer_name: reviews.customerName,
      rating: reviews.rating,
      content: reviews.content,
    })
    .from(reviews)
    .where(eq(reviews.approved, true))
    .orderBy(desc(reviews.createdAt), desc(reviews.id));

  return limit ? query.limit(limit) : query;
}
