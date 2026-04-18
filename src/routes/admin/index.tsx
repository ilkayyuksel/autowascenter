import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Calendar, Sparkles, Image, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});

function AdminHome() {
  const [stats, setStats] = useState({ bookings: 0, newBookings: 0, services: 0, gallery: 0, reviews: 0, pending: 0 });

  useEffect(() => {
    (async () => {
      const [b, bn, s, g, r, rp] = await Promise.all([
        supabase.from("bookings").select("id", { count: "exact", head: true }),
        supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "nieuw"),
        supabase.from("services").select("id", { count: "exact", head: true }),
        supabase.from("gallery_items").select("id", { count: "exact", head: true }),
        supabase.from("reviews").select("id", { count: "exact", head: true }),
        supabase.from("reviews").select("id", { count: "exact", head: true }).eq("approved", false),
      ]);
      setStats({
        bookings: b.count ?? 0,
        newBookings: bn.count ?? 0,
        services: s.count ?? 0,
        gallery: g.count ?? 0,
        reviews: r.count ?? 0,
        pending: rp.count ?? 0,
      });
    })();
  }, []);

  const cards = [
    { label: "Reservaties (totaal)", value: stats.bookings, sub: `${stats.newBookings} nieuw`, icon: Calendar },
    { label: "Diensten", value: stats.services, sub: "actief op site", icon: Sparkles },
    { label: "Galerij items", value: stats.gallery, sub: "afbeeldingen", icon: Image },
    { label: "Reviews", value: stats.reviews, sub: `${stats.pending} wachtend op goedkeuring`, icon: Star },
  ];

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Welkom terug 👋</h1>
      <p className="mt-2 text-muted-foreground">Een snel overzicht van wat er speelt.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{c.label}</span>
              <div className="h-9 w-9 rounded-lg bg-accent text-primary flex items-center justify-center">
                <c.icon className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-4 text-3xl font-bold">{c.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{c.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
