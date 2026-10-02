import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  addWeeks,
  format,
  startOfWeek,
  isSameDay,
  parseISO,
} from "date-fns";
import { nl } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Plus,
  Loader2,
} from "lucide-react";
// Reads AND writes go through the API: GET /api/admin/agenda, and the dialogs use
// POST/PATCH/DELETE /api/admin/bookings with GET /api/admin/availability (server slots).
import { useAdminLoad } from "@/hooks/useAdminLoad";
import { AdminLoadError } from "@/components/admin/AdminLoadError";
import { BookingCreateDialog } from "@/components/admin/BookingCreateDialog";
import { BookingEditDialog } from "@/components/admin/BookingEditDialog";
import {
  loadAgenda,
  type AgendaBlocked,
  type AgendaBooking,
  type BookingStatus,
} from "@/lib/api/admin-reads";
import { Button } from "@/components/ui/button";
// Pure display helpers (grid positions); availability comes from the API, not slots.ts.
import { timeToMinutes, minutesToTime } from "@/lib/time-display";

export const Route = createFileRoute("/admin/agenda")({
  component: AgendaPage,
});

// ---------- Types ----------
// READ models from the API (GET /api/admin/agenda).
type Booking = AgendaBooking;
type Blocked = AgendaBlocked;

const STATUS_COLOR: Record<BookingStatus, string> = {
  nieuw:
    "bg-primary/15 border-primary/40 text-primary hover:bg-primary/25",
  bevestigd:
    "bg-[oklch(0.92_0.08_155)] border-[oklch(0.7_0.17_155)]/50 text-[oklch(0.32_0.17_155)] hover:bg-[oklch(0.88_0.1_155)]",
  voltooid:
    "bg-muted border-border text-muted-foreground hover:bg-muted/80",
  geannuleerd:
    "bg-destructive/10 border-destructive/30 text-destructive line-through hover:bg-destructive/20",
};

const STATUS_LABEL: Record<BookingStatus, string> = {
  nieuw: "Nieuw",
  bevestigd: "Bevestigd",
  voltooid: "Voltooid",
  geannuleerd: "Geannuleerd",
};

const HOUR_START = 10;
const HOUR_END = 21;
const PX_PER_HOUR = 64;
const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * PX_PER_HOUR;

function minutesToTopPx(min: number) {
  return ((min - HOUR_START * 60) / 60) * PX_PER_HOUR;
}

function vehicleLabel(b: Pick<Booking, "vehicle_brand" | "vehicle_model" | "vehicle_info">) {
  const brandModel = `${b.vehicle_brand ?? ""} ${b.vehicle_model ?? ""}`.trim();
  return brandModel || b.vehicle_info || "";
}

// ---------- Component ----------
function AgendaPage() {
  const [view, setView] = useState<"week" | "day">("week");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const { api, state, run } = useAdminLoad();
  const loading = state.status === "loading";

  const [createOpen, setCreateOpen] = useState(false);
  const [createDefault, setCreateDefault] = useState<{ date: string; time?: string }>({
    date: format(new Date(), "yyyy-MM-dd"),
  });
  const [editing, setEditing] = useState<Booking | null>(null);

  const weekStart = useMemo(
    () => startOfWeek(anchor, { weekStartsOn: 1 }),
    [anchor],
  );
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const days = useMemo(
    () =>
      view === "week"
        ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
        : [anchor],
    [view, weekStart, anchor],
  );

  // READ: GET /api/admin/agenda?start=&end= (bookings of every status + blocked periods).
  const refresh = useCallback(() => {
    const range = {
      start: format(days[0], "yyyy-MM-dd"),
      end: format(days[days.length - 1], "yyyy-MM-dd"),
    };
    return run(
      (signal) => loadAgenda(api, range, { signal }),
      (data) => {
        setBookings(data.bookings);
        setBlocked(data.blocked);
      },
    );
  }, [api, run, days]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hours = Array.from(
    { length: HOUR_END - HOUR_START + 1 },
    (_, i) => HOUR_START + i,
  );

  const goPrev = () =>
    setAnchor((d) => (view === "week" ? addWeeks(d, -1) : addDays(d, -1)));
  const goNext = () =>
    setAnchor((d) => (view === "week" ? addWeeks(d, 1) : addDays(d, 1)));
  const goToday = () => setAnchor(new Date());

  const headerRange =
    view === "week"
      ? `${format(weekStart, "d MMM", { locale: nl })} – ${format(weekEnd, "d MMM yyyy", { locale: nl })}`
      : format(anchor, "EEEE d MMMM yyyy", { locale: nl });

  const handleColumnClick = (day: Date, e: React.MouseEvent<HTMLDivElement>) => {
    // Calculate clicked time from y-position, snap to nearest 30 min
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minutesFromOpen = Math.max(0, Math.round((y / PX_PER_HOUR) * 60));
    const snapped = Math.round(minutesFromOpen / 30) * 30;
    const totalMin = HOUR_START * 60 + snapped;
    setCreateDefault({
      date: format(day, "yyyy-MM-dd"),
      time: minutesToTime(totalMin),
    });
    setCreateOpen(true);
  };

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <CalendarIcon className="h-6 w-6 text-primary" /> Agenda
          </h1>
          <p className="mt-1 text-muted-foreground text-sm capitalize">
            {headerRange}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setView("week")}
              className={`px-3 py-1.5 text-sm font-medium ${view === "week" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              Week
            </button>
            <button
              onClick={() => setView("day")}
              className={`px-3 py-1.5 text-sm font-medium ${view === "day" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              Dag
            </button>
          </div>
          <Button variant="outline" size="icon" onClick={goPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={goToday}>
            Vandaag
          </Button>
          <Button variant="outline" size="icon" onClick={goNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => {
              setCreateDefault({ date: format(new Date(), "yyyy-MM-dd") });
              setCreateOpen(true);
            }}
            className="bg-gradient-primary"
          >
            <Plus className="h-4 w-4" /> Nieuwe afspraak
          </Button>
        </div>
      </div>

      {state.status === "error" && (
        <div className="mb-4">
          <AdminLoadError error={state.error} onRetry={refresh} />
        </div>
      )}

      {/* Calendar grid */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-soft relative">
        {loading && (
          <div className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Laden…
          </div>
        )}
        <div
          className="grid border-b border-border bg-muted/30"
          style={{ gridTemplateColumns: `60px repeat(${days.length}, 1fr)` }}
        >
          <div />
          {days.map((d) => {
            const today = isSameDay(d, new Date());
            return (
              <div
                key={d.toISOString()}
                className={`px-2 py-3 text-center border-l border-border ${today ? "bg-primary/5" : ""}`}
              >
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {format(d, "EEE", { locale: nl })}
                </div>
                <div className={`text-lg font-semibold ${today ? "text-primary" : ""}`}>
                  {format(d, "d MMM", { locale: nl })}
                </div>
              </div>
            );
          })}
        </div>

        <div
          className="grid relative"
          style={{ gridTemplateColumns: `60px repeat(${days.length}, 1fr)` }}
        >
          {/* Hour labels */}
          <div className="border-r border-border">
            {hours.map((h) => (
              <div
                key={h}
                style={{ height: PX_PER_HOUR }}
                className="text-xs text-muted-foreground text-right pr-2 -mt-2"
              >
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {days.map((day) => {
            const dayStr = format(day, "yyyy-MM-dd");
            const dayBookings = bookings.filter(
              (b) => b.preferred_date === dayStr,
            );
            const dayBlocks = blocked.filter((bl) => {
              const s = parseISO(bl.start_date);
              const e = parseISO(bl.end_date);
              return day >= s && day <= e;
            });

            return (
              <div
                key={day.toISOString()}
                onClick={(e) => handleColumnClick(day, e)}
                className="relative border-l border-border cursor-crosshair"
                style={{ height: TOTAL_HEIGHT }}
              >
                {/* Grid lines */}
                {hours.slice(0, -1).map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-border/50 pointer-events-none"
                    style={{ top: (h - HOUR_START) * PX_PER_HOUR }}
                  />
                ))}

                {/* Now line */}
                {isSameDay(day, new Date()) && (() => {
                  const now = new Date();
                  const m = now.getHours() * 60 + now.getMinutes();
                  if (m < HOUR_START * 60 || m > HOUR_END * 60) return null;
                  return (
                    <div
                      className="absolute left-0 right-0 z-[5] pointer-events-none"
                      style={{ top: minutesToTopPx(m) }}
                    >
                      <div className="h-px bg-primary" />
                      <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-primary" />
                    </div>
                  );
                })()}

                {/* Blocked */}
                {dayBlocks.map((bl) => {
                  const start = bl.start_time ? timeToMinutes(bl.start_time) : HOUR_START * 60;
                  const end = bl.end_time ? timeToMinutes(bl.end_time) : HOUR_END * 60;
                  const top = minutesToTopPx(start);
                  const height = ((end - start) / 60) * PX_PER_HOUR;
                  return (
                    <div
                      key={bl.id}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute left-1 right-1 rounded-md bg-[repeating-linear-gradient(45deg,oklch(var(--destructive)/0.12)_0_10px,transparent_10px_20px)] border border-destructive/40 px-1.5 py-1 text-[11px] text-destructive overflow-hidden cursor-default"
                      style={{ top, height }}
                      title={bl.reason ?? "Geblokkeerd"}
                    >
                      <div className="font-semibold truncate">🚫 {bl.reason ?? "Geblokkeerd"}</div>
                      {bl.start_time && bl.end_time && (
                        <div className="opacity-80 truncate">{bl.start_time}–{bl.end_time}</div>
                      )}
                    </div>
                  );
                })}

                {/* Bookings */}
                {dayBookings.map((b) => {
                  const start = timeToMinutes(b.preferred_time);
                  // End from the API's pickup moment; multi-day work fills the rest of the day.
                  const end = b.same_day_end_time
                    ? timeToMinutes(b.same_day_end_time)
                    : b.ends_later
                      ? HOUR_END * 60
                      : start + (b.total_duration_minutes || 60);
                  const top = minutesToTopPx(start);
                  const height = Math.max(((end - start) / 60) * PX_PER_HOUR, 36);
                  const v = vehicleLabel(b);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(b);
                      }}
                      className={`absolute left-1 right-1 rounded-md border px-2 py-1 overflow-hidden text-[11px] leading-tight shadow-sm text-left transition ${STATUS_COLOR[b.status]}`}
                      style={{ top, height }}
                      title={`${b.customer_name} — ${b.service_title ?? ""}`}
                    >
                      <div className="font-semibold truncate">{b.customer_name}</div>
                      <div className="opacity-80 truncate">
                        {b.preferred_time}
                        {b.same_day_end_time
                          ? `–${b.same_day_end_time}`
                          : b.ends_later
                            ? `–+${b.pickup_time}`
                            : ""}
                      </div>
                      {v && height > 50 && <div className="opacity-70 truncate">{v}</div>}
                      {b.service_title && height > 70 && (
                        <div className="opacity-70 truncate">{b.service_title}</div>
                      )}
                      {height > 90 && (
                        <div className="mt-0.5 inline-block text-[10px] uppercase tracking-wide opacity-80">
                          {STATUS_LABEL[b.status]}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-primary/30 border border-primary/40" /> Nieuw
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-[oklch(0.92_0.08_155)] border border-[oklch(0.7_0.17_155)]/50" /> Bevestigd
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-muted border border-border" /> Voltooid
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-destructive/20 border border-destructive/40" /> Geannuleerd / Geblokkeerd
        </span>
        <span className="ml-auto italic">Tip: klik op een leeg uur om een nieuwe afspraak te maken.</span>
      </div>

      {/* Modals */}
      {createOpen && (
        <BookingCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          defaultDate={createDefault.date}
          defaultTime={createDefault.time}
          onCreated={() => {
            setCreateOpen(false);
            refresh();
          }}
        />
      )}
      {editing && (
        <BookingEditDialog
          bookingId={editing.id}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
          onStale={refresh}
        />
      )}
    </div>
  );
}
