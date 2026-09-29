CREATE TYPE "public"."booking_status" AS ENUM('nieuw', 'bevestigd', 'voltooid', 'geannuleerd');--> statement-breakpoint
CREATE TABLE "package_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_services_package_id_service_id_key" UNIQUE("package_id","service_id"),
	CONSTRAINT "package_services_not_self_check" CHECK ("package_services"."package_id" <> "package_services"."service_id")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"price" numeric(10, 2),
	"duration_minutes" integer,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"bookable" boolean DEFAULT true NOT NULL,
	"category" text,
	"image_url" text,
	"badge" text,
	"kind" text DEFAULT 'dienst' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_kind_check" CHECK ("services"."kind" IN ('dienst', 'pakket', 'extra'))
);
--> statement-breakpoint
CREATE TABLE "vehicle_type_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_type_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_type_services_vehicle_type_id_service_id_key" UNIQUE("vehicle_type_id","service_id"),
	CONSTRAINT "vehicle_type_services_price_check" CHECK ("vehicle_type_services"."price" >= 0),
	CONSTRAINT "vehicle_type_services_duration_check" CHECK ("vehicle_type_services"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "vehicle_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"image_url" text,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_types_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "blocked_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_periods_dates_check" CHECK ("blocked_periods"."start_date" <= "blocked_periods"."end_date"),
	CONSTRAINT "blocked_periods_times_check" CHECK ("blocked_periods"."start_time" IS NULL OR "blocked_periods"."end_time" IS NULL OR "blocked_periods"."start_time" < "blocked_periods"."end_time")
);
--> statement-breakpoint
CREATE TABLE "booking_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"service_id" uuid,
	"service_title" text NOT NULL,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"duration_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_services_price_check" CHECK ("booking_services"."price" >= 0),
	CONSTRAINT "booking_services_duration_check" CHECK ("booking_services"."duration_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text NOT NULL,
	"company_name" text,
	"vat_number" text,
	"notes" text,
	"vehicle_type_id" uuid,
	"vehicle_brand" text,
	"vehicle_model" text,
	"vehicle_info" text,
	"service_id" uuid,
	"service_title" text,
	"preferred_date" date NOT NULL,
	"preferred_time" time NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"total_duration_minutes" integer NOT NULL,
	"total_price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"location_fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"on_location" boolean DEFAULT false NOT NULL,
	"location_in_sint_niklaas" boolean,
	"location_address" text,
	"location_distance_km" numeric(10, 2),
	"status" "booking_status" DEFAULT 'nieuw' NOT NULL,
	"cancel_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_cancel_token_key" UNIQUE("cancel_token"),
	CONSTRAINT "bookings_total_price_check" CHECK ("bookings"."total_price" >= 0),
	CONSTRAINT "bookings_location_fee_check" CHECK ("bookings"."location_fee" >= 0),
	CONSTRAINT "bookings_location_distance_km_check" CHECK ("bookings"."location_distance_km" IS NULL OR "bookings"."location_distance_km" >= 0),
	CONSTRAINT "bookings_total_duration_check" CHECK ("bookings"."total_duration_minutes" > 0),
	CONSTRAINT "bookings_interval_check" CHECK ("bookings"."end_at" > "bookings"."start_at"),
	CONSTRAINT "bookings_start_matches_local_check" CHECK ("bookings"."start_at" = (("bookings"."preferred_date" + "bookings"."preferred_time") AT TIME ZONE 'Europe/Brussels'))
);
--> statement-breakpoint
CREATE TABLE "gallery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"description" text,
	"image_url" text NOT NULL,
	"before_image_url" text,
	"category" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_name" text NOT NULL,
	"rating" integer NOT NULL,
	"content" text NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_check" CHECK ("reviews"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"km_fee" numeric(10, 2) DEFAULT '1.00' NOT NULL,
	"free_km" numeric(10, 2) DEFAULT '20' NOT NULL,
	"base_address" text DEFAULT 'Raapstraat 34, 9100 Sint-Niklaas' NOT NULL,
	"base_city" text DEFAULT 'Sint-Niklaas' NOT NULL,
	"opening_hour" time DEFAULT '08:00' NOT NULL,
	"closing_hour" time DEFAULT '22:00' NOT NULL,
	"slot_interval_minutes" integer DEFAULT 30 NOT NULL,
	"notification_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_settings_hours_check" CHECK ("site_settings"."closing_hour" > "site_settings"."opening_hour"),
	CONSTRAINT "site_settings_slot_interval_check" CHECK ("site_settings"."slot_interval_minutes" > 0),
	CONSTRAINT "site_settings_km_fee_check" CHECK ("site_settings"."km_fee" >= 0),
	CONSTRAINT "site_settings_free_km_check" CHECK ("site_settings"."free_km" >= 0)
);
--> statement-breakpoint
ALTER TABLE "package_services" ADD CONSTRAINT "package_services_package_id_services_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_services" ADD CONSTRAINT "package_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_type_services" ADD CONSTRAINT "vehicle_type_services_vehicle_type_id_vehicle_types_id_fk" FOREIGN KEY ("vehicle_type_id") REFERENCES "public"."vehicle_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_type_services" ADD CONSTRAINT "vehicle_type_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicle_type_id_vehicle_types_id_fk" FOREIGN KEY ("vehicle_type_id") REFERENCES "public"."vehicle_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_services_service_id_idx" ON "package_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "vehicle_type_services_service_id_idx" ON "vehicle_type_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "blocked_periods_dates_idx" ON "blocked_periods" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "booking_services_booking_id_idx" ON "booking_services" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_services_service_id_idx" ON "booking_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "bookings_preferred_date_idx" ON "bookings" USING btree ("preferred_date");--> statement-breakpoint
CREATE INDEX "bookings_vehicle_type_id_idx" ON "bookings" USING btree ("vehicle_type_id");--> statement-breakpoint
CREATE INDEX "bookings_service_id_idx" ON "bookings" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "site_settings_singleton_idx" ON "site_settings" USING btree ((true));