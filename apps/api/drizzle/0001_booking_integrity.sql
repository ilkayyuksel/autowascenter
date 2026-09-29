-- Custom SQL migration: database objects that Drizzle's schema DSL cannot express.
-- Hand-written; do not regenerate. See apps/api/README.md.

-- 1. btree_gist
-- Lets GiST exclusion constraints combine scalar equality (=) with range overlap (&&).
-- The current constraint below only uses a range, but the extension is part of the
-- agreed design so the constraint can later be scoped per resource (e.g. a wash bay)
-- without a new extension migration.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- 2. No overlapping bookings (capacity 1, same rule as src/lib/slots.ts today).
-- The occupied interval is [start_at, end_at): a booking may start exactly when the
-- previous one ends. Only bookings that still block the schedule take part:
-- 'geannuleerd' is excluded, so cancelling a booking frees its slot, and re-activating
-- a cancelled booking fails if its slot has been taken in the meantime.
-- 'voltooid' still counts: the time was really occupied.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap_excl"
  EXCLUDE USING gist (tstzrange("start_at", "end_at", '[)') WITH &&)
  WHERE ("status" <> 'geannuleerd');
--> statement-breakpoint

-- 3. updated_at maintenance, identical to Supabase public.update_updated_at_column().
CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Trigger names are kept identical to the Supabase migrations for traceability.
CREATE TRIGGER "trg_services_updated" BEFORE UPDATE ON "services"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
--> statement-breakpoint
CREATE TRIGGER "trg_gallery_updated" BEFORE UPDATE ON "gallery_items"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
--> statement-breakpoint
CREATE TRIGGER "trg_reviews_updated" BEFORE UPDATE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
--> statement-breakpoint
CREATE TRIGGER "trg_bookings_updated" BEFORE UPDATE ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
--> statement-breakpoint
CREATE TRIGGER "update_vehicle_types_updated_at" BEFORE UPDATE ON "vehicle_types"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
--> statement-breakpoint
CREATE TRIGGER "update_vts_updated_at" BEFORE UPDATE ON "vehicle_type_services"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
--> statement-breakpoint
CREATE TRIGGER "update_blocked_periods_updated_at" BEFORE UPDATE ON "blocked_periods"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
--> statement-breakpoint
CREATE TRIGGER "update_site_settings_updated_at" BEFORE UPDATE ON "site_settings"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
