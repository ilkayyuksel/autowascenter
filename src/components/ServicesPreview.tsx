import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles, SprayCan, Car, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "./ui/button";

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
  badge: string | null;
  bookable: boolean;
};

export function ServicesPreview() {
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    supabase
      .from("services")
      .select("id,title,description,price,duration_minutes,icon,badge,bookable")
      .eq("active", true)
      .order("sort_order")
      .limit(4)
      .then(({ data }) => data && setServices(data as Service[]));
  }, []);

  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-12">
          <div className="max-w-xl">
            <p className="text-sm font-semibold text-primary uppercase tracking-wider">Onze diensten</p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">Maatwerk voor elke wagen</h2>
            <p className="mt-3 text-muted-foreground">
              Kies de behandeling die past bij uw wagen — van een snelle wasbeurt tot
              een volledige restauratie.
            </p>
          </div>
          <Button asChild variant="ghost" className="text-primary hover:text-primary">
            <Link to="/diensten">
              Alle 15 diensten <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((s) => {
            const Icon = ICONS[s.icon ?? "sparkles"] ?? Sparkles;
            return (
              <article
                key={s.id}
                className="group relative rounded-2xl border border-border bg-card p-6 shadow-soft hover:shadow-elegant hover:border-primary/30 transition-all"
              >
                {s.badge && (
                  <span className="absolute top-4 right-4 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary text-primary-foreground">
                    {s.badge}
                  </span>
                )}
                <div className="h-11 w-11 rounded-xl bg-accent text-primary flex items-center justify-center mb-4 group-hover:bg-gradient-primary group-hover:text-primary-foreground transition-colors">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-lg">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{s.description}</p>
                <div className="mt-5 pt-4 border-t border-border flex items-baseline justify-between">
                  {s.price != null && (
                    <span className="text-xl font-bold">€{Number(s.price).toFixed(0)}</span>
                  )}
                  {s.duration_minutes != null && (
                    <span className="text-xs text-muted-foreground">{s.duration_minutes} min</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
