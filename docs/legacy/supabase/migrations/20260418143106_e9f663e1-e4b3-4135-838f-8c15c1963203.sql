-- Add bookable flag and category to services
ALTER TABLE public.services 
  ADD COLUMN IF NOT EXISTS bookable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS badge text;

-- Add category to gallery_items
ALTER TABLE public.gallery_items
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS before_image_url text;

-- Clear existing services and insert 15 placeholder services
DELETE FROM public.services;

INSERT INTO public.services (title, description, price, duration_minutes, icon, sort_order, active, bookable, category, badge) VALUES
('Express Handwas', 'Snelle exterieur handwas met pH-neutrale shampoo. Ideaal voor onderhoud tussendoor.', 25, 30, 'spray-can', 1, true, false, 'Basis', 'Vrij binnenlopen'),
('Standaard Wasbeurt', 'Grondige handwas met velgenreiniging en drogen met microvezel.', 40, 45, 'spray-can', 2, true, false, 'Basis', 'Vrij binnenlopen'),
('Wax Behandeling', 'Beschermende waslaag voor langdurige glans en bescherming tegen regen.', 65, 60, 'sparkles', 3, true, true, 'Exterieur', 'Populair'),
('Interieur Reiniging Standaard', 'Stofzuigen, dashboard reinigen en ramen polijsten.', 55, 60, 'spray-can', 4, true, true, 'Interieur', null),
('Interieur Diepreiniging', 'Volledige interieur detail inclusief stoelen, hemel en kunststof behandeling.', 120, 150, 'sparkles', 5, true, true, 'Interieur', 'Aanbevolen'),
('Lederreiniging & Voeding', 'Specifieke behandeling voor lederen bekleding met voedende balsem.', 95, 90, 'shield', 6, true, true, 'Interieur', null),
('Mini Detail Pakket', 'Combinatie van handwas en interieur basisreiniging.', 85, 90, 'car', 7, true, true, 'Pakket', 'Populair'),
('Full Detail Pakket', 'Complete behandeling exterieur en interieur. Alles tot in detail.', 250, 240, 'car', 8, true, true, 'Pakket', 'Bestseller'),
('Polijsten Eenstaps', 'Verwijdert lichte krassen en zwirlmarks. Perfect voor verzorgde wagens.', 220, 240, 'sparkles', 9, true, true, 'Polish', null),
('Polijsten Tweestaps', 'Diepere correctie voor matte lak of zichtbare krassen.', 380, 360, 'sparkles', 10, true, true, 'Polish', 'Pro'),
('Keramische Coating 1 jaar', 'Hydrofobe coating met bescherming tot 12 maanden.', 450, 360, 'shield', 11, true, true, 'Coating', 'Premium'),
('Keramische Coating 3 jaar', 'Langdurige bescherming en intense glans tot 3 jaar.', 850, 480, 'shield', 12, true, true, 'Coating', 'Premium'),
('Motorruimte Reiniging', 'Veilige reiniging en dressing van de motorruimte.', 60, 45, 'spray-can', 13, true, true, 'Exterieur', null),
('Geurneutralisatie (Ozon)', 'Verwijdert hardnekkige geuren met ozonbehandeling.', 75, 60, 'spray-can', 14, true, true, 'Interieur', null),
('Velgen Detail', 'Diepe reiniging en bescherming van velgen, ook binnenkant.', 70, 60, 'shield', 15, true, false, 'Basis', 'Vrij binnenlopen');