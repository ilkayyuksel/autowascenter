import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { Phone, Mail, Trash2, MapPin, Euro, Clock, Plus, Eye } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type Booking = {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  vehicle_info: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  service_title: string | null;
  preferred_date: string;
  preferred_time: string;
  end_time: string | null;
  total_duration_minutes: number;
  total_price: number;
  on_location: boolean;
  location_in_sint_niklaas: boolean | null;
  location_address: string | null;
  location_fee: number;
  company_name: string | null;
  vat_number: string | null;
  notes: string | null;
  status: "nieuw" | "bevestigd" | "voltooid" | "geannuleerd";
  created_at: string;
};

const STATUS_LABEL: Record<Booking["status"], string> = {
  nieuw: "Nieuw",
  bevestigd: "Bevestigd",
  voltooid: "Voltooid",
  geannuleerd: "Geannuleerd",
};

const STATUS_COLOR: Record<Booking["status"], string> = {
  nieuw: "bg-primary/10 text-primary border-primary/20",
  bevestigd: "bg-[oklch(0.7_0.17_155)]/10 text-[oklch(0.5_0.17_155)] border-[oklch(0.7_0.17_155)]/20",
  voltooid: "bg-muted text-muted-foreground border-border",
  geannuleerd: "bg-destructive/10 text-destructive border-destructive/20",
};

export const Route = createFileRoute("/admin/reservaties")({
  component: BookingsAdmin,
});

function BookingsAdmin() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("bookings")
      .select("*")
      .order("preferred_date", { ascending: false })
      .order("preferred_time", { ascending: false });
    setBookings((data as Booking[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const updateStatus = async (id: string, status: Booking["status"]) => {
    const { error } = await supabase.from("bookings").update({ status }).eq("id", id);
    if (error) return toast.error("Update mislukt");
    setBookings((b) => b.map((x) => (x.id === id ? { ...x, status } : x)));
    toast.success("Status bijgewerkt");
  };

  const remove = async (id: string) => {
    if (!confirm("Reservatie verwijderen?")) return;
    const { error } = await supabase.from("bookings").delete().eq("id", id);
    if (error) return toast.error("Verwijderen mislukt");
    setBookings((b) => b.filter((x) => x.id !== id));
    toast.success("Verwijderd");
  };

  const [openNew, setOpenNew] = useState(false);
  const [detail, setDetail] = useState<Booking | null>(null);
  const emptyForm = {
    customer_name: "", customer_email: "", customer_phone: "",
    vehicle_brand: "", vehicle_model: "",
    service_title: "", preferred_date: "", preferred_time: "",
    total_duration_minutes: 60, total_price: 0, notes: "",
  };
  const [form, setForm] = useState(emptyForm);

  const createBooking = async () => {
    if (!form.customer_name || !form.customer_phone || !form.preferred_date || !form.preferred_time) {
      return toast.error("Vul minstens naam, gsm, datum en uur in");
    }
    const { error } = await supabase.from("bookings").insert({
      customer_name: form.customer_name,
      customer_email: form.customer_email || "geen@autowascenter.be",
      customer_phone: form.customer_phone,
      vehicle_brand: form.vehicle_brand || null,
      vehicle_model: form.vehicle_model || null,
      service_title: form.service_title || null,
      preferred_date: form.preferred_date,
      preferred_time: form.preferred_time,
      total_duration_minutes: form.total_duration_minutes,
      total_price: form.total_price,
      notes: form.notes || null,
      status: "bevestigd",
    });
    if (error) return toast.error(error.message);
    toast.success("Reservatie aangemaakt");
    setOpenNew(false);
    setForm(emptyForm);
    load();
  };

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Reservaties</h1>
          <p className="mt-2 text-muted-foreground">Beheer alle binnenkomende afspraken.</p>
        </div>
        <Button onClick={() => setOpenNew(true)} className="bg-gradient-primary">
          <Plus className="h-4 w-4" /> Nieuwe afspraak
        </Button>
      </div>

      <div className="mt-8 space-y-3">
        {loading && <div className="text-sm text-muted-foreground">Laden...</div>}
        {!loading && bookings.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            Nog geen reservaties.
          </div>
        )}
        {bookings.map((b) => (
          <div key={b.id} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-lg">{b.customer_name}</h3>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_COLOR[b.status]}`}>
                    {STATUS_LABEL[b.status]}
                  </span>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {format(new Date(b.preferred_date), "EEEE d MMMM yyyy", { locale: nl })} • {b.preferred_time}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={b.status} onValueChange={(v) => updateStatus(b.id, v as Booking["status"])}>
                  <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" onClick={() => remove(b.id)} className="text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Dienst(en)</div>
                <div className="mt-1 font-medium">{b.service_title ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Wagen</div>
                <div className="mt-1 font-medium">
                  {b.vehicle_brand || b.vehicle_model
                    ? `${b.vehicle_brand ?? ""} ${b.vehicle_model ?? ""}`.trim()
                    : (b.vehicle_info ?? "—")}
                </div>
              </div>
              <div className="inline-flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                {b.total_duration_minutes} min
                {b.end_time && <span className="text-muted-foreground">→ {b.end_time}</span>}
              </div>
              <div className="inline-flex items-center gap-2 font-semibold">
                <Euro className="h-4 w-4 text-muted-foreground" />
                €{Number(b.total_price ?? 0).toFixed(2)}
                {b.location_fee > 0 && (
                  <span className="text-xs text-muted-foreground font-normal">
                    (+ €{Number(b.location_fee).toFixed(2)} verplaatsing)
                  </span>
                )}
              </div>
              <a href={`tel:${b.customer_phone}`} className="flex items-center gap-2 text-foreground hover:text-primary">
                <Phone className="h-4 w-4" /> {b.customer_phone}
              </a>
              <a href={`mailto:${b.customer_email}`} className="flex items-center gap-2 text-foreground hover:text-primary truncate">
                <Mail className="h-4 w-4 flex-shrink-0" /> <span className="truncate">{b.customer_email}</span>
              </a>
              {b.on_location && (
                <div className="sm:col-span-2 inline-flex items-start gap-2 text-foreground">
                  <MapPin className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                  <span>
                    Op locatie —{" "}
                    {b.location_in_sint_niklaas
                      ? "Sint-Niklaas"
                      : b.location_address ?? "adres niet opgegeven"}
                  </span>
                </div>
              )}
              {(b.company_name || b.vat_number) && (
                <div className="sm:col-span-2 text-xs text-muted-foreground">
                  {b.company_name} {b.vat_number && `• BTW: ${b.vat_number}`}
                </div>
              )}
            </div>

            {b.notes && (
              <div className="mt-3 p-3 rounded-lg bg-muted text-sm text-muted-foreground">
                {b.notes}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
