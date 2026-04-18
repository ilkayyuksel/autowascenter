
-- =========================================
-- 1. VEHICLE TYPES
-- =========================================
CREATE TABLE public.vehicle_types (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vehicle_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Iedereen ziet actieve voertuigtypes"
ON public.vehicle_types FOR SELECT
USING (active = true OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins beheren voertuigtypes"
ON public.vehicle_types FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_vehicle_types_updated_at
BEFORE UPDATE ON public.vehicle_types
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- 2. VEHICLE TYPE <-> SERVICES (price + duration per combination)
-- =========================================
CREATE TABLE public.vehicle_type_services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_type_id UUID NOT NULL REFERENCES public.vehicle_types(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  available BOOLEAN NOT NULL DEFAULT true,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vehicle_type_id, service_id)
);

CREATE INDEX idx_vts_vehicle ON public.vehicle_type_services(vehicle_type_id);
CREATE INDEX idx_vts_service ON public.vehicle_type_services(service_id);

ALTER TABLE public.vehicle_type_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Iedereen ziet beschikbare combinaties"
ON public.vehicle_type_services FOR SELECT
USING (true);

CREATE POLICY "Admins beheren combinaties"
ON public.vehicle_type_services FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_vts_updated_at
BEFORE UPDATE ON public.vehicle_type_services
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- 3. BOOKINGS — extend
-- =========================================
ALTER TABLE public.bookings
  ADD COLUMN vehicle_type_id UUID REFERENCES public.vehicle_types(id),
  ADD COLUMN vehicle_brand TEXT,
  ADD COLUMN vehicle_model TEXT,
  ADD COLUMN total_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN total_duration_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN end_time TEXT,
  ADD COLUMN on_location BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN location_in_sint_niklaas BOOLEAN,
  ADD COLUMN location_address TEXT,
  ADD COLUMN location_distance_km NUMERIC(10,2),
  ADD COLUMN location_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN company_name TEXT,
  ADD COLUMN vat_number TEXT,
  ADD COLUMN cancel_token UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN cancelled_at TIMESTAMPTZ;

CREATE INDEX idx_bookings_date ON public.bookings(preferred_date);
CREATE INDEX idx_bookings_vehicle_type ON public.bookings(vehicle_type_id);
CREATE INDEX idx_bookings_cancel_token ON public.bookings(cancel_token);

-- =========================================
-- 4. BOOKING SERVICES (multi-select per booking)
-- =========================================
CREATE TABLE public.booking_services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
  service_title TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_booking_services_booking ON public.booking_services(booking_id);

ALTER TABLE public.booking_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Iedereen kan booking_services aanmaken"
ON public.booking_services FOR INSERT
WITH CHECK (true);

CREATE POLICY "Admins zien alle booking_services"
ON public.booking_services FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins beheren booking_services"
ON public.booking_services FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins verwijderen booking_services"
ON public.booking_services FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- =========================================
-- 5. BLOCKED PERIODS (admin can block dates / timeslots)
-- =========================================
CREATE TABLE public.blocked_periods (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TEXT,  -- e.g. '08:00' (NULL = whole day)
  end_time TEXT,    -- e.g. '12:00'
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_blocked_periods_dates ON public.blocked_periods(start_date, end_date);

ALTER TABLE public.blocked_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Iedereen ziet geblokkeerde periodes"
ON public.blocked_periods FOR SELECT
USING (true);

CREATE POLICY "Admins beheren geblokkeerde periodes"
ON public.blocked_periods FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_blocked_periods_updated_at
BEFORE UPDATE ON public.blocked_periods
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- 6. SITE SETTINGS (single row)
-- =========================================
CREATE TABLE public.site_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  km_fee NUMERIC(10,2) NOT NULL DEFAULT 1.00,
  base_address TEXT NOT NULL DEFAULT 'Raapstraat 34, 9100 Sint-Niklaas',
  base_city TEXT NOT NULL DEFAULT 'Sint-Niklaas',
  opening_hour TEXT NOT NULL DEFAULT '08:00',
  closing_hour TEXT NOT NULL DEFAULT '22:00',
  slot_interval_minutes INTEGER NOT NULL DEFAULT 30,
  notification_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Iedereen ziet site instellingen"
ON public.site_settings FOR SELECT
USING (true);

CREATE POLICY "Admins beheren site instellingen"
ON public.site_settings FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_site_settings_updated_at
BEFORE UPDATE ON public.site_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.site_settings (km_fee, notification_email)
VALUES (1.00, 'info@autowascenter.be');

-- =========================================
-- 7. SEED VEHICLE TYPES
-- =========================================
INSERT INTO public.vehicle_types (slug, title, description, sort_order) VALUES
  ('stadswagen', 'Stadswagen', 'Compacte wagens zoals VW Polo, Renault Clio, Peugeot 208', 10),
  ('sedan', 'Sedan / Berline', 'Klassieke vierdeursauto''s zoals BMW 3-reeks, Audi A4', 20),
  ('break', 'Break / Stationwagen', 'Ruime gezinswagens zoals VW Passat Variant, Skoda Octavia Combi', 30),
  ('suv', 'SUV / 4x4', 'SUVs en terreinwagens zoals BMW X3, Audi Q5, Range Rover', 40),
  ('bestelwagen', 'Bestelwagen', 'Lichte vrachtwagens zoals VW Transporter, Mercedes Vito', 50),
  ('luxe', 'Luxe wagen', 'Premium en sportwagens met extra zorg', 60);

-- =========================================
-- 8. SEED vehicle_type_services for all bookable services
-- =========================================
INSERT INTO public.vehicle_type_services (vehicle_type_id, service_id, available, price, duration_minutes)
SELECT
  vt.id,
  s.id,
  true,
  COALESCE(s.price, 30) * CASE
    WHEN vt.slug = 'stadswagen' THEN 1.0
    WHEN vt.slug = 'sedan' THEN 1.15
    WHEN vt.slug = 'break' THEN 1.25
    WHEN vt.slug = 'suv' THEN 1.4
    WHEN vt.slug = 'bestelwagen' THEN 1.6
    WHEN vt.slug = 'luxe' THEN 1.5
  END,
  COALESCE(s.duration_minutes, 60) * CASE
    WHEN vt.slug IN ('suv', 'bestelwagen') THEN 1.25
    WHEN vt.slug = 'break' THEN 1.15
    ELSE 1.0
  END
FROM public.vehicle_types vt
CROSS JOIN public.services s
WHERE s.bookable = true AND s.active = true;
