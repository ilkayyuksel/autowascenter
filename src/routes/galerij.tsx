import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { SiteLayout } from "@/components/SiteLayout";
import { supabase } from "@/integrations/supabase/client";
import gallery1 from "@/assets/gallery-1.jpg";
import gallery2 from "@/assets/gallery-2.jpg";
import gallery3 from "@/assets/gallery-3.jpg";
import gallery4 from "@/assets/gallery-4.jpg";

const FALLBACK: GalleryItem[] = [
  { id: "f1", title: "Exterieur polish", description: "Diepe glans op witte wagen", image_url: gallery1, category: "Exterieur", before_image_url: null },
  { id: "f2", title: "Interieur detail", description: "Lederen interieur na behandeling", image_url: gallery2, category: "Interieur", before_image_url: null },
  { id: "f3", title: "Snow foam wash", description: "Schuimbehandeling voor het wassen", image_url: gallery3, category: "Exterieur", before_image_url: null },
  { id: "f4", title: "Keramische coating", description: "Hydrofoob effect", image_url: gallery4, category: "Coating", before_image_url: null },
  { id: "f5", title: "Polish behandeling", description: "Resultaat na tweestaps polish", image_url: gallery1, category: "Polish", before_image_url: gallery3 },
  { id: "f6", title: "Full detail SUV", description: "Complete behandeling", image_url: gallery2, category: "Pakket", before_image_url: null },
  { id: "f7", title: "Velgen restauratie", description: "Diepgereinigd en beschermd", image_url: gallery4, category: "Exterieur", before_image_url: null },
  { id: "f8", title: "Lederinterieur", description: "Voeding en bescherming", image_url: gallery3, category: "Interieur", before_image_url: null },
];

type GalleryItem = {
  id: string;
  title: string | null;
  description: string | null;
  image_url: string;
  category: string | null;
  before_image_url: string | null;
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
  const [filter, setFilter] = useState<string>("Alle");
  const [lightbox, setLightbox] = useState<GalleryItem | null>(null);

  useEffect(() => {
    supabase
      .from("gallery_items")
      .select("id,title,description,image_url,category,before_image_url")
      .order("sort_order")
      .then(({ data }) => {
        if (data && data.length > 0) setItems(data as GalleryItem[]);
      });
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => i.category && set.add(i.category));
    return ["Alle", ...Array.from(set)];
  }, [items]);

  const filtered = filter === "Alle" ? items : items.filter((i) => i.category === filter);

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

      <section className="py-12 sm:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {categories.length > 2 && (
            <div className="flex flex-wrap gap-2 mb-8">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                    filter === cat
                      ? "bg-primary text-primary-foreground border-primary shadow-elegant"
                      : "bg-card border-border hover:border-primary/40"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          <div className="columns-1 sm:columns-2 lg:columns-3 gap-5 [column-fill:_balance]">
            {filtered.map((item, idx) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setLightbox(item)}
                className="group block w-full mb-5 break-inside-avoid overflow-hidden rounded-2xl border border-border bg-card shadow-soft hover:shadow-elegant transition-all text-left"
              >
                <div className={`relative ${idx % 3 === 0 ? "aspect-[4/5]" : idx % 3 === 1 ? "aspect-square" : "aspect-[4/3]"} overflow-hidden`}>
                  <img
                    src={item.image_url}
                    alt={item.title ?? "Realisatie"}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  {item.before_image_url && (
                    <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary text-primary-foreground shadow-elegant">
                      Before / After
                    </span>
                  )}
                  {item.category && (
                    <span className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-xs font-semibold bg-background/90 backdrop-blur">
                      {item.category}
                    </span>
                  )}
                </div>
                {(item.title || item.description) && (
                  <div className="p-4">
                    {item.title && <h3 className="font-semibold text-sm">{item.title}</h3>}
                    {item.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
            aria-label="Sluiten"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            {lightbox.before_image_url ? (
              <div className="grid sm:grid-cols-2 gap-3">
                <figure className="relative">
                  <img src={lightbox.before_image_url} alt="Voor" className="w-full rounded-2xl" />
                  <figcaption className="absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-semibold bg-foreground text-background">Voor</figcaption>
                </figure>
                <figure className="relative">
                  <img src={lightbox.image_url} alt="Na" className="w-full rounded-2xl" />
                  <figcaption className="absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-semibold bg-primary text-primary-foreground">Na</figcaption>
                </figure>
              </div>
            ) : (
              <img src={lightbox.image_url} alt={lightbox.title ?? ""} className="w-full max-h-[85vh] object-contain rounded-2xl" />
            )}
            {lightbox.title && (
              <p className="mt-4 text-white text-center font-semibold">{lightbox.title}</p>
            )}
          </div>
        </div>
      )}
    </SiteLayout>
  );
}
