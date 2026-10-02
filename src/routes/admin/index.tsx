import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, Sparkles, Euro, TrendingUp, Clock, ArrowRight, Image as ImageIcon } from "lucide-react";
import { addDays, format, startOfWeek, parseISO } from "date-fns";
import { nl } from "date-fns/locale";
import { useAdminLoad } from "@/hooks/useAdminLoad";
import { AdminLoadError } from "@/components/admin/AdminLoadError";
import { loadDashboard, type DashboardView } from "@/lib/api/admin-reads";

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});

// READ: GET /api/admin/dashboard (week, counts, revenue and next appointment are computed by
// the API in Europe/Brussels time). This page has no writes.
function AdminHome() {
  const { api, state, run } = useAdminLoad();
  const [data, setData] = useState<DashboardView | null>(null);

  const load = useCallback(
    () => run((signal) => loadDashboard(api, { signal }), setData),
    [api, run],
  );
  useEffect(() => {
    load();
  }, [load]);

  // Until the API answered: the current week as before (all values 0).
  const fallbackWeekStart = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), []);
  const weekStart = data ? parseISO(data.week_start) : fallbackWeekStart;
  const weekEnd = data ? parseISO(data.week_end) : addDays(fallbackWeekStart, 6);
  const todayStr = data?.today ?? format(new Date(), "yyyy-MM-dd");
  const todayBookings = data?.today_bookings ?? [];
  const weekRevenue = data?.week.revenue_excl_vat ?? 0;
  const upcoming = data?.next_booking ?? null;

  // Revenue per day chart
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayRevenue = days.map((d) => {
    const dStr = format(d, "yyyy-MM-dd");
    return data?.week.days.find((x) => x.date === dStr)?.revenue_excl_vat ?? 0;
  });
  const maxRev = Math.max(...dayRevenue, 1);

  if (state.status === "error") {
    return (
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Welkom terug 👋</h1>
        <div className="mt-8">
          <AdminLoadError error={state.error} onRetry={load} />
        </div>
      </div>
    );
  }

  const cards = [
    { label: "Afspraken deze week", value: data?.week.booking_count ?? 0, sub: `${todayBookings.length} vandaag`, icon: Calendar, accent: "text-primary" },
    { label: "Omzet deze week", value: `€${weekRevenue.toFixed(0)}`, sub: "geboekt", icon: Euro, accent: "text-[oklch(0.55_0.17_155)]" },
    { label: "Diensten actief", value: data?.counts.active_services ?? 0, sub: "online zichtbaar", icon: Sparkles, accent: "text-primary" },
    { label: "Galerij items", value: data?.counts.gallery_items ?? 0, sub: `${data?.counts.active_vehicle_types ?? 0} voertuigtypes`, icon: ImageIcon, accent: "text-amber-500" },
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
              const isToday = format(d, "yyyy-MM-dd") === todayStr;
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
                {format(parseISO(upcoming.preferred_date), "EEE d MMM", { locale: nl })} • {upcoming.preferred_time}
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
