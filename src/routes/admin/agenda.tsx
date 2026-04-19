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
  Trash2,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  computeAvailableSlots,
  fetchSlotData,
  timeToMinutes,
  minutesToTime,
} from "@/lib/slots";

export const Route = createFileRoute("/admin/agenda")({
  component: AgendaPage,
});

// ---------- Types ----------
type BookingStatus = "nieuw" | "bevestigd" | "voltooid" | "geannuleerd";

type Booking = {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_info: string | null;
  service_title: string | null;
  preferred_date: string;
  preferred_time: string;
  end_time: string | null;
  total_duration_minutes: number;
  status: BookingStatus;
  notes: string | null;
};

type Blocked = {
  id: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
};

type VehicleType = { id: string; title: string };
type VtService = {
  id: string; // vehicle_type_services.id
  service_id: string;
  title: string;
  price: number;
  duration_minutes: number;
};

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

const HOUR_START = 8;
const HOUR_END = 22;
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
  const [loading, setLoading] = useState(false);

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

  const refresh = useCallback(async () => {
    setLoading(true);
    const fromStr = format(days[0], "yyyy-MM-dd");
    const toStr = format(days[days.length - 1], "yyyy-MM-dd");
    const [b, bl] = await Promise.all([
      supabase
        .from("bookings")
        .select(
          "id,customer_name,customer_email,customer_phone,vehicle_brand,vehicle_model,vehicle_info,service_title,preferred_date,preferred_time,end_time,total_duration_minutes,status,notes",
        )
        .gte("preferred_date", fromStr)
        .lte("preferred_date", toStr),
      supabase
        .from("blocked_periods")
        .select("*")
        .lte("start_date", toStr)
        .gte("end_date", fromStr),
    ]);
    setBookings((b.data as Booking[]) ?? []);
    setBlocked((bl.data as Blocked[]) ?? []);
    setLoading(false);
  }, [days]);

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
                  const end = b.end_time
                    ? timeToMinutes(b.end_time)
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
                        {b.end_time ? `–${b.end_time}` : ""}
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
        <CreateBookingDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          defaultDate={createDefault.date}
          defaultTime={createDefault.time}
          onSaved={() => {
            setCreateOpen(false);
            refresh();
          }}
        />
      )}
      {editing && (
        <EditBookingDialog
          booking={editing}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------- Create dialog ----------
function CreateBookingDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultDate: string;
  defaultTime?: string;
  onSaved: () => void;
}) {
  const { open, onOpenChange, defaultDate, defaultTime, onSaved } = props;
  const [form, setForm] = useState({
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    vehicle_brand: "",
    vehicle_model: "",
    service_title: "",
    service_id: "" as string | null | "",
    vts_id: "",
    vehicle_type_id: "",
    duration: 60,
    price: 0,
    notes: "",
    status: "bevestigd" as BookingStatus,
  });
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState<string>(defaultTime ?? "");
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [vtServices, setVtServices] = useState<VtService[]>([]);

  useEffect(() => {
    supabase
      .from("vehicle_types")
      .select("id,title")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => data && setVehicleTypes(data as VehicleType[]));
  }, []);

  // Load services for chosen vehicle type
  useEffect(() => {
    if (!form.vehicle_type_id) {
      setVtServices([]);
      return;
    }
    supabase
      .from("vehicle_type_services")
      .select(
        "id,service_id,price,duration_minutes,available,services!inner(id,title,bookable,active)",
      )
      .eq("vehicle_type_id", form.vehicle_type_id)
      .eq("available", true)
      .then(({ data }) => {
        if (!data) return;
        const opts: VtService[] = (data as any[])
          .filter((row) => row.services?.bookable && row.services?.active)
          .map((row) => ({
            id: row.id,
            service_id: row.service_id,
            title: row.services.title,
            price: Number(row.price),
            duration_minutes: Number(row.duration_minutes),
          }))
          .sort((a, b) => a.title.localeCompare(b.title));
        setVtServices(opts);
      });
    // Reset selected service when vehicle type changes
    setForm((f) => ({ ...f, vts_id: "", service_id: "", service_title: "" }));
  }, [form.vehicle_type_id]);

  const loadSlots = useCallback(async () => {
    if (!date || !form.duration) {
      setSlots([]);
      return;
    }
    setLoadingSlots(true);
    const { bookings, blocked, settings } = await fetchSlotData(date);
    const s = computeAvailableSlots({
      date,
      durationMinutes: form.duration,
      bookings,
      blocked,
      settings,
    });
    setSlots(s);
    setLoadingSlots(false);
    if (time && !s.includes(time)) setTime("");
  }, [date, form.duration, time]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const submit = async () => {
    if (!form.customer_name.trim()) return toast.error("Klantnaam is verplicht");
    if (!form.customer_email.trim()) return toast.error("E-mail is verplicht");
    if (!form.customer_phone.trim()) return toast.error("Telefoon is verplicht");
    if (!form.vehicle_type_id) return toast.error("Kies een voertuigtype");
    if (!form.vts_id) return toast.error("Kies een dienst");
    if (!date || !time) return toast.error("Kies een datum en een vrij tijdslot");

    setSaving(true);
    // Re-check conflict server-side at save time
    const { bookings, blocked, settings } = await fetchSlotData(date);
    const stillFree = computeAvailableSlots({
      date,
      durationMinutes: form.duration,
      bookings,
      blocked,
      settings,
    }).includes(time);
    if (!stillFree) {
      setSaving(false);
      toast.error("Dit tijdslot is intussen bezet. Kies een ander.");
      await loadSlots();
      return;
    }

    const startMin = timeToMinutes(time);
    const endTime = minutesToTime(startMin + form.duration);
    const { data: booking, error } = await supabase
      .from("bookings")
      .insert({
        customer_name: form.customer_name.trim(),
        customer_email: form.customer_email.trim(),
        customer_phone: form.customer_phone.trim(),
        vehicle_brand: form.vehicle_brand.trim() || null,
        vehicle_model: form.vehicle_model.trim() || null,
        vehicle_info: `${form.vehicle_brand} ${form.vehicle_model}`.trim() || null,
        service_id: form.service_id || null,
        service_title: form.service_title || null,
        vehicle_type_id: form.vehicle_type_id || null,
        preferred_date: date,
        preferred_time: time,
        end_time: endTime,
        total_duration_minutes: form.duration,
        notes: form.notes.trim() || null,
        status: form.status,
        total_price: form.price,
      })
      .select("id")
      .single();
    if (error || !booking) {
      setSaving(false);
      return toast.error(error?.message ?? "Kon afspraak niet opslaan");
    }
    // Insert booking_services row for consistency with public flow
    await supabase.from("booking_services").insert({
      booking_id: booking.id,
      service_id: form.service_id || null,
      service_title: form.service_title,
      price: form.price,
      duration_minutes: form.duration,
    });
    setSaving(false);
    toast.success("Afspraak aangemaakt");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nieuwe afspraak</DialogTitle>
          <DialogDescription>
            Vrije tijdsloten worden live berekend uit de database.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Klantnaam *</Label>
              <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
            </div>
            <div>
              <Label>Telefoon *</Label>
              <Input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>E-mail *</Label>
            <Input type="email" value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Merk</Label>
              <Input value={form.vehicle_brand} onChange={(e) => setForm({ ...form, vehicle_brand: e.target.value })} />
            </div>
            <div>
              <Label>Model</Label>
              <Input value={form.vehicle_model} onChange={(e) => setForm({ ...form, vehicle_model: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Voertuigtype</Label>
              <Select value={form.vehicle_type_id} onValueChange={(v) => setForm({ ...form, vehicle_type_id: v })}>
                <SelectTrigger><SelectValue placeholder="Kies type" /></SelectTrigger>
                <SelectContent>
                  {vehicleTypes.map((vt) => (
                    <SelectItem key={vt.id} value={vt.id}>{vt.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as BookingStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nieuw">Nieuw</SelectItem>
                  <SelectItem value="bevestigd">Bevestigd</SelectItem>
                  <SelectItem value="voltooid">Voltooid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Dienst *</Label>
            {!form.vehicle_type_id ? (
              <p className="text-xs text-muted-foreground italic mt-1.5">
                Kies eerst een voertuigtype om beschikbare diensten te zien.
              </p>
            ) : vtServices.length === 0 ? (
              <p className="text-xs text-muted-foreground italic mt-1.5">
                Geen diensten beschikbaar voor dit voertuigtype.
              </p>
            ) : (
              <Select
                value={form.vts_id}
                onValueChange={(v) => {
                  const svc = vtServices.find((x) => x.id === v);
                  if (!svc) return;
                  setForm((f) => ({
                    ...f,
                    vts_id: v,
                    service_id: svc.service_id,
                    service_title: svc.title,
                    duration: svc.duration_minutes,
                    price: svc.price,
                  }));
                  setTime("");
                }}
              >
                <SelectTrigger><SelectValue placeholder="Kies een dienst" /></SelectTrigger>
                <SelectContent>
                  {vtServices.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title} — €{s.price.toFixed(2)} · {s.duration_minutes} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Datum *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} min={format(new Date(), "yyyy-MM-dd")} />
            </div>
            <div>
              <Label>Duur (min)</Label>
              <Input
                value={form.duration}
                readOnly
                className="bg-muted"
                title="Automatisch ingesteld op basis van de gekozen dienst"
              />
            </div>
          </div>

          <div>
            <Label>Vrij tijdslot * {loadingSlots && <span className="text-xs text-muted-foreground">(laden…)</span>}</Label>
            {!loadingSlots && slots.length === 0 ? (
              <p className="text-sm text-muted-foreground italic mt-2">
                Geen vrije slots op deze datum voor {form.duration} min. Kies een andere datum of duur.
              </p>
            ) : (
              <div className="mt-2 grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-40 overflow-y-auto">
                {slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTime(s)}
                    className={`px-2 py-1.5 rounded-md text-sm border transition ${time === s ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Notities</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuleren</Button>
          <Button onClick={submit} disabled={saving} className="bg-gradient-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Opslaan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Edit dialog ----------
function EditBookingDialog(props: {
  booking: Booking;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const { booking, onOpenChange, onSaved } = props;
  const [date, setDate] = useState(booking.preferred_date);
  const [time, setTime] = useState(booking.preferred_time);
  const [duration, setDuration] = useState(booking.total_duration_minutes || 60);
  const [status, setStatus] = useState<BookingStatus>(booking.status);
  const [notes, setNotes] = useState(booking.notes ?? "");
  const [serviceTitle, setServiceTitle] = useState(booking.service_title ?? "");
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [moveMode, setMoveMode] = useState(false);

  const loadSlots = useCallback(async () => {
    if (!date || !duration) return;
    setLoadingSlots(true);
    const { bookings, blocked, settings } = await fetchSlotData(date, booking.id);
    const s = computeAvailableSlots({
      date,
      durationMinutes: duration,
      bookings,
      blocked,
      settings,
    });
    // Always include current time if same date so it shows as selected option
    if (date === booking.preferred_date && !s.includes(booking.preferred_time)) {
      s.push(booking.preferred_time);
      s.sort();
    }
    setSlots(s);
    setLoadingSlots(false);
  }, [date, duration, booking.id, booking.preferred_date, booking.preferred_time]);

  useEffect(() => {
    if (moveMode) loadSlots();
  }, [moveMode, loadSlots]);

  const save = async () => {
    setSaving(true);
    // Conflict check (excluding self) when date/time/duration changed
    if (
      date !== booking.preferred_date ||
      time !== booking.preferred_time ||
      duration !== booking.total_duration_minutes
    ) {
      const { bookings, blocked, settings } = await fetchSlotData(date, booking.id);
      const free = computeAvailableSlots({
        date,
        durationMinutes: duration,
        bookings,
        blocked,
        settings,
      }).includes(time);
      if (!free) {
        setSaving(false);
        toast.error("Dit tijdslot is bezet. Kies een ander vrij slot.");
        return;
      }
    }

    const endTime = minutesToTime(timeToMinutes(time) + duration);
    const { error } = await supabase
      .from("bookings")
      .update({
        preferred_date: date,
        preferred_time: time,
        end_time: endTime,
        total_duration_minutes: duration,
        status,
        notes: notes.trim() || null,
        service_title: serviceTitle.trim() || null,
      })
      .eq("id", booking.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Afspraak bijgewerkt");
    onSaved();
  };

  const cancelBooking = async () => {
    if (!confirm("Deze afspraak annuleren?")) return;
    const { error } = await supabase
      .from("bookings")
      .update({ status: "geannuleerd", cancelled_at: new Date().toISOString() })
      .eq("id", booking.id);
    if (error) return toast.error(error.message);
    toast.success("Afspraak geannuleerd");
    onSaved();
  };

  const removeBooking = async () => {
    if (!confirm("Definitief verwijderen? Dit kan niet ongedaan gemaakt worden.")) return;
    const { error } = await supabase.from("bookings").delete().eq("id", booking.id);
    if (error) return toast.error(error.message);
    toast.success("Verwijderd");
    onSaved();
  };

  const v = vehicleLabel(booking);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>{booking.customer_name}</span>
            <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {STATUS_LABEL[booking.status]}
            </span>
          </DialogTitle>
          <DialogDescription>
            {booking.customer_phone} · {booking.customer_email}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {v && <div className="text-sm"><span className="text-muted-foreground">Voertuig:</span> {v}</div>}

          <div>
            <Label>Dienst</Label>
            <Input value={serviceTitle} onChange={(e) => setServiceTitle(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Datum</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setMoveMode(true);
                }}
              />
            </div>
            <div>
              <Label>Duur (min)</Label>
              <Select
                value={String(duration)}
                onValueChange={(val) => {
                  setDuration(Number(val));
                  setMoveMode(true);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[30, 45, 60, 90, 120, 150, 180, 240, 300].map((m) => (
                    <SelectItem key={m} value={String(m)}>{m} min</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Tijdstip</Label>
              {!moveMode && (
                <button
                  type="button"
                  onClick={() => setMoveMode(true)}
                  className="text-xs text-primary hover:underline"
                >
                  Verplaatsen naar ander vrij slot
                </button>
              )}
            </div>
            {!moveMode ? (
              <Input value={time} readOnly className="bg-muted" />
            ) : loadingSlots ? (
              <p className="text-sm text-muted-foreground italic mt-2">Vrije slots laden…</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-muted-foreground italic mt-2">
                Geen vrije slots op deze datum voor {duration} min.
              </p>
            ) : (
              <div className="mt-2 grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-40 overflow-y-auto">
                {slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTime(s)}
                    className={`px-2 py-1.5 rounded-md text-sm border transition ${time === s ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as BookingStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nieuw">Nieuw</SelectItem>
                <SelectItem value="bevestigd">Bevestigd</SelectItem>
                <SelectItem value="voltooid">Voltooid</SelectItem>
                <SelectItem value="geannuleerd">Geannuleerd</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Notities</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
          <div className="flex gap-2 mr-auto">
            <Button variant="outline" size="sm" onClick={cancelBooking}>
              <X className="h-4 w-4" /> Annuleren
            </Button>
            <Button variant="outline" size="sm" onClick={removeBooking} className="text-destructive">
              <Trash2 className="h-4 w-4" /> Verwijderen
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Sluiten</Button>
            <Button onClick={save} disabled={saving} className="bg-gradient-primary">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Opslaan
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
