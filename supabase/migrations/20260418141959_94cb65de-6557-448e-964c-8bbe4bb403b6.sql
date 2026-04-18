-- Enum voor rollen
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- User roles tabel (apart van profielen, voorkomt privilege escalation)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer functie om recursie in RLS te voorkomen
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Trigger functie voor updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Diensten
CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2),
  duration_minutes INTEGER,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_services_updated
BEFORE UPDATE ON public.services
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Galerij
CREATE TABLE public.gallery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  description TEXT,
  image_url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.gallery_items ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_gallery_updated
BEFORE UPDATE ON public.gallery_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reviews
CREATE TABLE public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content TEXT NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_reviews_updated
BEFORE UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Bookings (reservaties)
CREATE TYPE public.booking_status AS ENUM ('nieuw', 'bevestigd', 'voltooid', 'geannuleerd');

CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  vehicle_info TEXT,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
  service_title TEXT,
  preferred_date DATE NOT NULL,
  preferred_time TEXT NOT NULL,
  notes TEXT,
  status booking_status NOT NULL DEFAULT 'nieuw',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_bookings_updated
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== RLS POLICIES =====

-- user_roles
CREATE POLICY "Gebruikers zien eigen rollen"
ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins beheren rollen"
ON public.user_roles FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- services
CREATE POLICY "Iedereen ziet actieve diensten"
ON public.services FOR SELECT
USING (active = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins beheren diensten"
ON public.services FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- gallery
CREATE POLICY "Iedereen ziet galerij"
ON public.gallery_items FOR SELECT
USING (true);

CREATE POLICY "Admins beheren galerij"
ON public.gallery_items FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- reviews
CREATE POLICY "Iedereen ziet goedgekeurde reviews"
ON public.reviews FOR SELECT
USING (approved = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Iedereen kan review indienen"
ON public.reviews FOR INSERT
WITH CHECK (approved = false);

CREATE POLICY "Admins beheren reviews"
ON public.reviews FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- bookings
CREATE POLICY "Iedereen kan reservatie aanmaken"
ON public.bookings FOR INSERT
WITH CHECK (true);

CREATE POLICY "Admins zien alle reservaties"
ON public.bookings FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins beheren reservaties"
ON public.bookings FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins verwijderen reservaties"
ON public.bookings FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Storage bucket voor galerij-afbeeldingen
INSERT INTO storage.buckets (id, name, public) VALUES ('gallery', 'gallery', true);

CREATE POLICY "Iedereen ziet galerij-afbeeldingen"
ON storage.objects FOR SELECT
USING (bucket_id = 'gallery');

CREATE POLICY "Admins uploaden galerij-afbeeldingen"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'gallery' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins werken galerij-afbeeldingen bij"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'gallery' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins verwijderen galerij-afbeeldingen"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'gallery' AND public.has_role(auth.uid(), 'admin'));

-- Seed data: een paar diensten zodat de site direct gevuld is
INSERT INTO public.services (title, description, price, duration_minutes, icon, sort_order) VALUES
('Exterieur Wash', 'Grondige handwas, velgenreiniging en quick-shine afwerking voor een diepe glans.', 39, 60, 'sparkles', 1),
('Interieur Detailing', 'Volledige interieurreiniging: stofzuigen, dashboard, ramen, leder- of stofbehandeling.', 79, 120, 'spray-can', 2),
('Full Detail Pakket', 'De complete behandeling binnen én buiten — alsof je auto net van de showroom komt.', 149, 240, 'car', 3),
('Keramische Coating', 'Langdurige bescherming met premium keramische laag voor maximale glans en hydrofoob effect.', 499, 480, 'shield', 4);

INSERT INTO public.reviews (customer_name, rating, content, approved) VALUES
('Tom V.', 5, 'Mijn auto zag eruit als nieuw. Echt vakwerk, zeer vriendelijk team.', true),
('Sarah D.', 5, 'Top service en eerlijke prijs. Zeker een aanrader in Sint-Niklaas!', true),
('Kevin M.', 5, 'Keramische coating laten doen — resultaat is fenomenaal. Bedankt!', true);