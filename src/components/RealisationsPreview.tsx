import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import { publicApi } from "@/lib/api/public-api";
import { getPublicGallery, withFallback } from "@/lib/api/public-reads";
import gallery1 from "@/assets/gallery-1.jpg";
import gallery2 from "@/assets/gallery-2.jpg";
import gallery3 from "@/assets/gallery-3.jpg";
import gallery4 from "@/assets/gallery-4.jpg";

const FALLBACK = [
  { id: "f1", title: "Exterieur polish", image_url: gallery1 },
  { id: "f2", title: "Interieur detail", image_url: gallery2 },
  { id: "f3", title: "Snow foam wash", image_url: gallery3 },
  { id: "f4", title: "Keramische coating", image_url: gallery4 },
];

type Item = { id: string; title: string | null; image_url: string };

export function RealisationsPreview() {
  const [items, setItems] = useState<Item[]>(FALLBACK);

  // GET /api/gallery?limit=4; the example photos stay when there are no items or on error.
  useEffect(() => {
    const controller = new AbortController();
    getPublicGallery(publicApi, { limit: 4, signal: controller.signal })
      .then((data) => setItems(withFallback<Item>(data, FALLBACK)))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-12">
          <div className="max-w-xl">
            <p className="text-sm font-semibold text-primary uppercase tracking-wider">Realisaties</p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">
              Recente projecten
            </h2>
            <p className="mt-3 text-muted-foreground">
              Een greep uit onze meest recente detailingbehandelingen.
            </p>
          </div>
          <Button asChild variant="ghost" className="text-primary hover:text-primary">
            <Link to="/galerij">
              Volledige galerij <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <Link
              to="/galerij"
              key={item.id}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card shadow-soft hover:shadow-elegant transition-all aspect-square"
            >
              <img
                src={item.image_url}
                alt={item.title ?? "Realisatie"}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              {item.title && (
                <div className="absolute bottom-0 left-0 right-0 p-4 text-white text-sm font-semibold">
                  {item.title}
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
