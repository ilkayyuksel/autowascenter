import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Sparkles, SprayCan, Car, Shield, Check } from "lucide-react";
import { SiteLayout } from "@/components/SiteLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const ICONS: Record<string, typeof Sparkles> = {
  sparkles: Sparkles,
  "spray-can": SprayCan,
  car: Car,
  shield: Shield,
};

type Service = {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  duration_minutes: number | null;
  icon: string | null;
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

  useEffect(() => {
    supabase
      .from("services")
      .select("id,title,description,price,duration_minutes,icon")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => data && setServices(data));
  }, []);

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
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 md:grid-cols-2">
            {services.map((s) => {
              const Icon = ICONS[s.icon ?? "sparkles"] ?? Sparkles;
              return (
                <article
                  key={s.id}
                  className="rounded-2xl border border-border bg-card p-7 shadow-soft hover:shadow-elegant hover:border-primary/30 transition-all flex flex-col"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="h-12 w-12 rounded-xl bg-gradient-primary text-primary-foreground flex items-center justify-center shadow-elegant">
                      <Icon className="h-5 w-5" />
                    </div>
                    {s.price != null && (
                      <div className="text-right">
                        <div className="text-2xl font-bold">€{Number(s.price).toFixed(0)}</div>
                        {s.duration_minutes != null && (
                          <div className="text-xs text-muted-foreground">{s.duration_minutes} min</div>
                        )}
                      </div>
                    )}
                  </div>
                  <h2 className="mt-5 text-xl font-bold">{s.title}</h2>
                  <p className="mt-2 text-muted-foreground leading-relaxed flex-1">{s.description}</p>
                  <ul className="mt-4 space-y-1.5 text-sm">
                    <li className="flex items-center gap-2 text-foreground/80"><Check className="h-4 w-4 text-primary" /> Premium producten</li>
                    <li className="flex items-center gap-2 text-foreground/80"><Check className="h-4 w-4 text-primary" /> Vakkundig uitgevoerd</li>
                  </ul>
                  <Button asChild className="mt-6 bg-gradient-primary self-start">
                    <Link to="/reservatie">
                      Reserveer deze dienst <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
