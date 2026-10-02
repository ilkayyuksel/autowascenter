import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Sparkles, SprayCan, Car, Shield, Check, Info } from "lucide-react";
import { SiteLayout } from "@/components/SiteLayout";
import { publicApi } from "@/lib/api/public-api";
import { getPublicServices } from "@/lib/api/public-reads";
import { Button } from "@/components/ui/button";
import gallery1 from "@/assets/gallery-1.jpg";
import gallery2 from "@/assets/gallery-2.jpg";
import gallery3 from "@/assets/gallery-3.jpg";
import gallery4 from "@/assets/gallery-4.jpg";

const ICONS: Record<string, typeof Sparkles> = {
  sparkles: Sparkles,
  "spray-can": SprayCan,
  car: Car,
  shield: Shield,
};

const FALLBACK_IMAGES = [gallery1, gallery2, gallery3, gallery4];

type Service = {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  badge: string | null;
  bookable: boolean;
  image_url: string | null;
};

export const Route = createFileRoute("/diensten")({
  head: () => ({
    meta: [
      { title: "Diensten — Autowascenter Sint-Niklaas" },
      { name: "description", content: "Ontdek alle detailingdiensten van Autowascenter: handwas, interieur, full detail en keramische coating." },
      { property: "og:title", content: "Onze Diensten — Autowascenter" },
      { property: "og:description", content: "Premium auto detailing diensten in Sint-Niklaas." },
    ],
  }),
  component: ServicesPage,
});

function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [filter, setFilter] = useState<string>("Alle");
  const [loadFailed, setLoadFailed] = useState(false);

  // GET /api/services (active, by sort order).
  useEffect(() => {
    const controller = new AbortController();
    getPublicServices(publicApi, { signal: controller.signal })
      .then(setServices)
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true);
      });
    return () => controller.abort();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    services.forEach((s) => s.category && set.add(s.category));
    return ["Alle", ...Array.from(set)];
  }, [services]);

  const filtered = filter === "Alle" ? services : services.filter((s) => s.category === filter);

  return (
    <SiteLayout>
      <section className="bg-gradient-subtle border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider">Diensten</p>
          <h1 className="mt-2 text-4xl sm:text-5xl font-bold tracking-tight">Detailing op maat</h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
            Van een snelle wasbeurt tot volledige restauratie. Elke behandeling
            wordt uitgevoerd met premium producten en oog voor detail.
          </p>

          <div className="mt-6 inline-flex items-start gap-3 px-4 py-3 rounded-xl bg-card border border-primary/20 max-w-2xl">
            <Info className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">Tip:</span> Voor
              basisbeurten hoef je geen reservatie te maken — je kan gewoon
              langskomen tijdens onze openingsuren.
            </p>
          </div>
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

          {loadFailed && services.length === 0 && (
            <p role="alert" className="text-sm text-muted-foreground italic">
              De diensten konden niet geladen worden. Probeer het later opnieuw.
            </p>
          )}

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((s, idx) => {
              const Icon = ICONS[s.icon ?? "sparkles"] ?? Sparkles;
              const img = s.image_url ?? FALLBACK_IMAGES[idx % FALLBACK_IMAGES.length];
              return (
                <article
                  key={s.id}
                  className="group rounded-2xl border border-border bg-card overflow-hidden shadow-soft hover:shadow-elegant hover:border-primary/30 transition-all flex flex-col"
                >
                  <div className="relative aspect-[16/10] overflow-hidden">
                    <img
                      src={img}
                      alt={s.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                      {s.badge && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-primary text-primary-foreground shadow-elegant">
                          {s.badge}
                        </span>
                      )}
                      {!s.bookable && !s.badge && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-foreground text-background">
                          Vrij binnenlopen
                        </span>
                      )}
                    </div>
                    <div className="absolute top-3 right-3 h-10 w-10 rounded-xl bg-background/90 backdrop-blur text-primary flex items-center justify-center shadow-soft">
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>

                  <div className="p-6 flex-1 flex flex-col">
                    {s.category && (
                      <p className="text-xs font-semibold text-primary uppercase tracking-wider">{s.category}</p>
                    )}
                    <h2 className="mt-1 text-lg font-bold">{s.title}</h2>
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed flex-1">{s.description}</p>

                    {s.bookable ? (
                      <Button asChild className="mt-4 bg-gradient-primary w-full">
                        <Link to="/reservatie">
                          Reserveer <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    ) : (
                      <div className="mt-4 px-4 py-3 rounded-xl bg-accent text-sm text-foreground/80 flex items-start gap-2">
                        <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                        <span>Geen reservatie nodig — kom gewoon langs.</span>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
