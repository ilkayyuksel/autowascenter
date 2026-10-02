ALTER TABLE public.services ADD COLUMN kind text NOT NULL DEFAULT 'dienst';
ALTER TABLE public.site_settings ADD COLUMN free_km numeric NOT NULL DEFAULT 20;
CREATE TABLE public.package_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, service_id)
);
GRANT SELECT ON public.package_services TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.package_services TO authenticated;
GRANT ALL ON public.package_services TO service_role;
ALTER TABLE public.package_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Iedereen ziet pakketinhoud" ON public.package_services FOR SELECT USING (true);
CREATE POLICY "Admins beheren pakketinhoud" ON public.package_services FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));