import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Calendar, Sparkles, Image, Star, Euro, TrendingUp, Clock, ArrowRight } from "lucide-react";
import { addDays, format, startOfWeek, isSameDay } from "date-fns";
import { nl } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});

type Booking = {
  id: string;
  customer_name: string;
  service_title: string | null;
  preferred_date: string;
  preferred_time: string;
  total_price: number;
  status: "nieuw" | "bevestigd" | "voltooid" | "geannuleerd";
};

function AdminHome() {
  const [stats, setStats] = useState({ services: 0, gallery: 0, reviewsPending: 0 });
  const [weekBookings, setWeekBookings] = useState<Booking[]>([]);

  const weekStart = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), []);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  useEffect(() => {
    (async () => {
      const fromStr = format(weekStart, "yyyy-MM-dd");
      const toStr = format(weekEnd, "yyyy-MM-dd");
      const [s, g, rp, wb] = await Promise.all([
        supabase.from("services").select("id", { count: "exact", head: true }).eq("active", true),
        supabase.from("gallery_items").select("id", { count: "exact", head: true }),
        supabase.from("reviews").select("id", { count: "exact", head: true }).eq("approved", false),
        supabase
          .from("bookings")
          .select("id,customer_name,service_title,preferred_date,preferred_time,total_price,status")
          .gte("preferred_date", fromStr)
          .lte("preferred_date", toStr)
          .neq("status", "geannuleerd")
          .order("preferred_date")
          .order("preferred_time"),
      ]);
      setStats({
        services: s.count ?? 0,
        gallery: g.count ?? 0,
        reviewsPending: rp.count ?? 0,
      });
      setWeekBookings((wb.data as Booking[]) ?? []);
    })();
  }, [weekStart, weekEnd]);

  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");
  const todayBookings = weekBookings.filter((b) => b.preferred_date === todayStr);
  const weekRevenue = weekBookings.reduce((sum, b) => sum + Number(b.total_price ?? 0), 0);
  const upcoming = weekBookings.find((b) => {
    const d = new Date(`${b.preferred_date}T${b.preferred_time}`);
    return d >= today;
  });

  // Revenue per day chart
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayRevenue = days.map((d) => {
    const dStr = format(d, "yyyy-MM-dd");
    return weekBookings
      .filter((b) => b.preferred_date === dStr)
      .reduce((s, b) => s + Number(b.total_price ?? 0), 0);
  });
  const maxRev = Math.max(...dayRevenue, 1);

  const cards = [
    { label: "Afspraken deze week", value: weekBookings.length, sub: `${todayBookings.length} vandaag`, icon: Calendar, accent: "text-primary" },
    { label: "Omzet deze week", value: `€${weekRevenue.toFixed(0)}`, sub: "geboekt", icon: Euro, accent: "text-[oklch(0.55_0.17_155)]" },
    { label: "Diensten actief", value: stats.services, sub: `${stats.gallery} galerij items`, icon: Sparkles, accent: "text-primary" },
    { label: "Reviews wachtend", value: stats.reviewsPending, sub: "te modereren", icon: Star, accent: "text-amber-500" },
  ];

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Welkom terug 👋</h1>
          <p className="mt-2 text-muted-foreground">
            Week van {format(weekStart, "d MMM", { locale: nl })} tot {format(weekEnd, "d MMM", { locale: nl })}
          </p>
        </div>
        <Link to="/admin/agenda" className="text-sm font-medium text-primary inline-flex items-center gap-1 hover:underline">
          Open agenda <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{c.label}</span>
              <div className={`h-9 w-9 rounded-lg bg-accent flex items-center justify-center ${c.accent}`}>
                <c.icon className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-4 text-3xl font-bold">{c.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Revenue chart */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Omzet per dag</h2>
            <span className="text-xs text-muted-foreground">huidige week</span>
          </div>
          <div className="mt-6 flex items-end gap-2 h-44">
            {days.map((d, i) => {
              const isToday = isSameDay(d, today);
              const h = (dayRevenue[i] / maxRev) * 100;
              return (
                <div key={d.toISOString()} className="flex-1 flex flex-col items-center gap-2">
                  <div className="text-[11px] font-medium text-muted-foreground">€{dayRevenue[i].toFixed(0)}</div>
                  <div className="w-full bg-muted rounded-md overflow-hidden flex items-end" style={{ height: 140 }}>
                    <div
                      className={`w-full rounded-md transition-all ${isToday ? "bg-gradient-primary" : "bg-primary/40"}`}
                      style={{ height: `${h}%`, minHeight: dayRevenue[i] > 0 ? 4 : 0 }}
                    />
                  </div>
                  <div className={`text-xs ${isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>
                    {format(d, "EEE", { locale: nl })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Upcoming */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h2 className="font-semibold flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Volgende afspraak</h2>
          {upcoming ? (
            <div className="mt-4">
              <div className="text-2xl font-bold">{upcoming.customer_name}</div>
              <div className="mt-1 text-sm text-muted-foreground">{upcoming.service_title ?? "—"}</div>
              <div className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary bg-primary/10 px-3 py-1.5 rounded-full">
                <Calendar className="h-3.5 w-3.5" />
                {format(new Date(upcoming.preferred_date), "EEE d MMM", { locale: nl })} • {upcoming.preferred_time}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground italic">Geen aankomende afspraken deze week.</p>
          )}

          {todayBookings.length > 0 && (
            <div className="mt-6 pt-4 border-t border-border">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Vandaag ({todayBookings.length})
              </div>
              <div className="space-y-1.5 max-h-40 overflow-auto">
                {todayBookings.map((b) => (
                  <div key={b.id} className="flex items-center justify-between text-sm">
                    <span className="truncate">{b.customer_name}</span>
                    <span className="text-muted-foreground text-xs">{b.preferred_time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
