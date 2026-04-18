import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { Phone, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type Booking = {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  vehicle_info: string | null;
  service_title: string | null;
  preferred_date: string;
  preferred_time: string;
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

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Reservaties</h1>
      <p className="mt-2 text-muted-foreground">Beheer alle binnenkomende afspraken.</p>

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
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Dienst</div>
                <div className="mt-1 font-medium">{b.service_title ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Wagen</div>
                <div className="mt-1 font-medium">{b.vehicle_info ?? "—"}</div>
              </div>
              <a href={`tel:${b.customer_phone}`} className="flex items-center gap-2 text-foreground hover:text-primary">
                <Phone className="h-4 w-4" /> {b.customer_phone}
              </a>
              <a href={`mailto:${b.customer_email}`} className="flex items-center gap-2 text-foreground hover:text-primary truncate">
                <Mail className="h-4 w-4 flex-shrink-0" /> <span className="truncate">{b.customer_email}</span>
              </a>
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
