import { timestamp, uuid } from "drizzle-orm/pg-core";

/** `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, identical to the Supabase tables. */
export const id = () => uuid("id").primaryKey().defaultRandom();

/** `created_at timestamptz NOT NULL DEFAULT now()` */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/**
 * `updated_at timestamptz NOT NULL DEFAULT now()`.
 * Kept current by the `update_updated_at_column()` trigger (see the custom migration),
 * so it is also correct for writes that do not go through Drizzle.
 */
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
