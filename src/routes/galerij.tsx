import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteLayout } from "@/components/SiteLayout";
import { supabase } from "@/integrations/supabase/client";
import gallery1 from "@/assets/gallery-1.jpg";
import gallery2 from "@/assets/gallery-2.jpg";
import gallery3 from "@/assets/gallery-3.jpg";
import gallery4 from "@/assets/gallery-4.jpg";

const FALLBACK = [
  { id: "f1", title: "Exterieur polish", description: "Diepe glans op witte wagen", image_url: gallery1 },
  { id: "f2", title: "Interieur detail", description: "Lederen interieur na behandeling", image_url: gallery2 },
  { id: "f3", title: "Snow foam wash", description: "Schuimbehandeling voor het wassen", image_url: gallery3 },
  { id: "f4", title: "Keramische coating", description: "Hydrofoob effect", image_url: gallery4 },
];

type GalleryItem = {
  id: string;
  title: string | null;
  description: string | null;
  image_url: string;
};

export const Route = createFileRoute("/galerij")({
  head: () => ({
    meta: [
      { title: "Galerij — Autowascenter" },
      { name: "description", content: "Bekijk onze recente realisaties: van handwas tot volledige restauratie en keramische coating." },
      { property: "og:title", content: "Galerij & Realisaties — Autowascenter" },
      { property: "og:description", content: "Onze meest recente detailing realisaties in Sint-Niklaas." },
    ],
  }),
  component: GalleryPage,
});

function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[]>(FALLBACK);

  useEffect(() => {
    supabase
      .from("gallery_items")
      .select("id,title,description,image_url")
      .order("sort_order")
      .then(({ data }) => {
        if (data && data.length > 0) setItems(data);
      });
  }, []);

  return (
    <SiteLayout>
      <section className="bg-gradient-subtle border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider">Galerij</p>
          <h1 className="mt-2 text-4xl sm:text-5xl font-bold tracking-tight">Onze realisaties</h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
            Een selectie van wagens die wij recent onder handen namen.
          </p>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <figure
                key={item.id}
                className="group relative overflow-hidden rounded-2xl border border-border bg-card shadow-soft hover:shadow-elegant transition-all"
              >
                <div className="aspect-[4/3] overflow-hidden">
                  <img
                    src={item.image_url}
                    alt={item.title ?? "Realisatie"}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                {(item.title || item.description) && (
                  <figcaption className="p-5">
                    {item.title && <h3 className="font-semibold">{item.title}</h3>}
                    {item.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                    )}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
