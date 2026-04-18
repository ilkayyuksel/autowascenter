import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { addDays, addWeeks, format, startOfWeek, isSameDay, parseISO } from "date-fns";
import { nl } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/agenda")({
  component: AgendaPage,
});

type Booking = {
  id: string;
  customer_name: string;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_info: string | null;
  service_title: string | null;
  preferred_date: string;
  preferred_time: string;
  end_time: string | null;
  total_duration_minutes: number;
  status: "nieuw" | "bevestigd" | "voltooid" | "geannuleerd";
};

type Blocked = {
  id: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
};

const STATUS_COLOR: Record<Booking["status"], string> = {
  nieuw: "bg-primary/15 border-primary/30 text-primary",
  bevestigd: "bg-[oklch(0.7_0.17_155)]/15 border-[oklch(0.7_0.17_155)]/30 text-[oklch(0.4_0.17_155)]",
  voltooid: "bg-muted border-border text-muted-foreground",
  geannuleerd: "bg-destructive/10 border-destructive/30 text-destructive line-through",
};

const HOUR_START = 8;
const HOUR_END = 22;
const PX_PER_HOUR = 56;

function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTopPx(min: number) {
  return ((min - HOUR_START * 60) / 60) * PX_PER_HOUR;
}

function AgendaPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocked, setBlocked] = useState<Blocked[]>([]);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  useEffect(() => {
    (async () => {
      const fromStr = format(weekStart, "yyyy-MM-dd");
      const toStr = format(weekEnd, "yyyy-MM-dd");
      const [b, bl] = await Promise.all([
        supabase
          .from("bookings")
          .select("id,customer_name,vehicle_brand,vehicle_model,vehicle_info,service_title,preferred_date,preferred_time,end_time,total_duration_minutes,status")
          .gte("preferred_date", fromStr)
          .lte("preferred_date", toStr)
          .neq("status", "geannuleerd"),
        supabase
          .from("blocked_periods")
          .select("*")
          .lte("start_date", toStr)
          .gte("end_date", fromStr),
      ]);
      setBookings((b.data as Booking[]) ?? []);
      setBlocked((bl.data as Blocked[]) ?? []);
    })();
  }, [weekStart, weekEnd]);

  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <CalendarIcon className="h-6 w-6 text-primary" /> Agenda
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            {format(weekStart, "d MMM", { locale: nl })} – {format(weekEnd, "d MMM yyyy", { locale: nl })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekStart((w) => addWeeks(w, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
            Vandaag
          </Button>
          <Button variant="outline" size="icon" onClick={() => setWeekStart((w) => addWeeks(w, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-soft">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border bg-muted/30">
          <div />
          {days.map((d) => {
            const today = isSameDay(d, new Date());
            return (
              <div key={d.toISOString()} className={`px-2 py-3 text-center border-l border-border ${today ? "bg-primary/5" : ""}`}>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {format(d, "EEE", { locale: nl })}
                </div>
                <div className={`text-lg font-semibold ${today ? "text-primary" : ""}`}>
                  {format(d, "d")}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-[60px_repeat(7,1fr)] relative">
          {/* Hour labels */}
          <div className="border-r border-border">
            {hours.map((h) => (
              <div key={h} style={{ height: PX_PER_HOUR }} className="text-xs text-muted-foreground text-right pr-2 -mt-2">
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const dayStr = format(day, "yyyy-MM-dd");
            const dayBookings = bookings.filter((b) => b.preferred_date === dayStr);
            const dayBlocks = blocked.filter((bl) => {
              const s = parseISO(bl.start_date);
              const e = parseISO(bl.end_date);
              return day >= s && day <= e;
            });

            return (
              <div key={day.toISOString()} className="relative border-l border-border" style={{ height: (HOUR_END - HOUR_START) * PX_PER_HOUR }}>
                {/* Hour grid lines */}
                {hours.slice(0, -1).map((h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-border/50" style={{ top: (h - HOUR_START) * PX_PER_HOUR }} />
                ))}

                {/* Blocked periods */}
                {dayBlocks.map((bl) => {
                  const start = bl.start_time ? timeToMinutes(bl.start_time) : HOUR_START * 60;
                  const end = bl.end_time ? timeToMinutes(bl.end_time) : HOUR_END * 60;
                  const top = minutesToTopPx(start);
                  const height = ((end - start) / 60) * PX_PER_HOUR;
                  return (
                    <div
                      key={bl.id}
                      className="absolute left-1 right-1 rounded-md bg-destructive/10 border border-destructive/30 px-1.5 py-1 text-[11px] text-destructive overflow-hidden"
                      style={{ top, height }}
                      title={bl.reason ?? "Geblokkeerd"}
                    >
                      🚫 {bl.reason ?? "Geblokkeerd"}
                    </div>
                  );
                })}

                {/* Bookings */}
                {dayBookings.map((b) => {
                  const start = timeToMinutes(b.preferred_time);
                  const end = b.end_time
                    ? timeToMinutes(b.end_time)
                    : start + (b.total_duration_minutes || 60);
                  const top = minutesToTopPx(start);
                  const height = Math.max(((end - start) / 60) * PX_PER_HOUR, 32);
                  const vehicle = b.vehicle_brand || b.vehicle_model
                    ? `${b.vehicle_brand ?? ""} ${b.vehicle_model ?? ""}`.trim()
                    : (b.vehicle_info ?? "");
                  return (
                    <div
                      key={b.id}
                      className={`absolute left-1 right-1 rounded-md border px-2 py-1 overflow-hidden text-[11px] leading-tight shadow-sm ${STATUS_COLOR[b.status]}`}
                      style={{ top, height }}
                      title={`${b.customer_name} — ${b.service_title ?? ""}`}
                    >
                      <div className="font-semibold truncate">{b.customer_name}</div>
                      <div className="opacity-80 truncate">{b.preferred_time}{b.end_time ? `–${b.end_time}` : ""}</div>
                      {vehicle && <div className="opacity-70 truncate">{vehicle}</div>}
                      {b.service_title && height > 56 && <div className="opacity-70 truncate">{b.service_title}</div>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-primary/30 border border-primary/40" /> Nieuw</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[oklch(0.7_0.17_155)]/30 border border-[oklch(0.7_0.17_155)]/40" /> Bevestigd</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-muted border border-border" /> Voltooid</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-destructive/20 border border-destructive/40" /> Geblokkeerd</span>
      </div>
    </div>
  );
}
