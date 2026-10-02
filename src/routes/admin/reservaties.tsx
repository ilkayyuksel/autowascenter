import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { nl } from "date-fns/locale";
import { Phone, Mail, Trash2, MapPin, Euro, Clock, Plus, Eye, ChevronLeft, ChevronRight } from "lucide-react";
// Reads and writes through the API: GET/POST/PATCH/DELETE /api/admin/bookings.
import { useAdminLoad } from "@/hooks/useAdminLoad";
import { useAdminMutation } from "@/hooks/useAdminMutation";
import { BookingCreateDialog } from "@/components/admin/BookingCreateDialog";
import { deleteAdminBooking, updateAdminBooking } from "@/lib/api/admin-writes";
import { AdminLoadError } from "@/components/admin/AdminLoadError";
import {
  loadBookingDetail,
  loadBookingsPage,
  type BookingDetailView,
  type BookingRow,
} from "@/lib/api/admin-reads";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// READ model from GET /api/admin/bookings (paginated, newest date first).
type Booking = BookingRow;

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
  // Server-side pagination: the API is authoritative for page, limit, total, total_pages.
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const { api, state, run } = useAdminLoad();
  const loading = state.status === "loading";

  const load = useCallback(
    () =>
      run(
        (signal) => loadBookingsPage(api, { page }, { signal }),
        ({ items, meta }) => {
          setBookings(items);
          setTotalPages(meta.total_pages);
          setTotal(meta.total);
        },
      ),
    [api, run, page],
  );

  useEffect(() => { load(); }, [load]);

  const { mutate } = useAdminMutation();

  // PATCH status (cancel → server sets cancelled_at; reactivate → server re-checks overlap),
  // then reload the authoritative list.
  const updateStatus = async (id: string, status: Booking["status"]) => {
    await mutate((api) => updateAdminBooking(api, id, { status }), {
      success: "Status bijgewerkt",
    });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Reservatie verwijderen?")) return;
    await mutate((api) => deleteAdminBooking(api, id).then(() => true), { success: "Verwijderd" });
    load();
  };

  const [openNew, setOpenNew] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
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
        {state.status === "error" && <AdminLoadError error={state.error} onRetry={load} />}
        {state.status === "success" && bookings.length === 0 && (
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
                  {format(parseISO(b.preferred_date), "EEEE d MMMM yyyy", { locale: nl })} • {b.preferred_time}
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
                <Button variant="ghost" size="icon" onClick={() => setDetailId(b.id)}>
                  <Eye className="h-4 w-4" />
                </Button>
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
                <span className="text-muted-foreground">→ {b.pickup_label}</span>
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

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            Pagina {page} van {totalPages} · {total} reservaties
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" /> Vorige
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Volgende <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* New booking: same API flow as the agenda (server pricing, duration and slots) */}
      {openNew && (
        <BookingCreateDialog
          open={openNew}
          onOpenChange={setOpenNew}
          onCreated={() => {
            setOpenNew(false);
            load();
          }}
        />
      )}

      {/* Detail dialog: GET /api/admin/bookings/:id (no Supabase fallback) */}
      {detailId && <BookingDetailDialog id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function BookingDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { api, state, run } = useAdminLoad();
  const [detail, setDetail] = useState<BookingDetailView | null>(null);

  const load = useCallback(
    () => run((signal) => loadBookingDetail(api, id, { signal }), setDetail),
    [api, run, id],
  );
  useEffect(() => { load(); }, [load]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {state.status === "loading" && (
          <>
            <DialogHeader>
              <DialogTitle>Reservatie</DialogTitle>
            </DialogHeader>
            <div className="text-sm text-muted-foreground">Laden...</div>
          </>
        )}
        {state.status === "error" && (
          <>
            <DialogHeader>
              <DialogTitle>Reservatie</DialogTitle>
            </DialogHeader>
            <AdminLoadError error={state.error} onRetry={load} />
          </>
        )}
        {state.status === "success" && detail && (
          <>
            <DialogHeader>
              <DialogTitle>{detail.customer_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Datum</div>
                  <div className="font-medium">{format(parseISO(detail.preferred_date), "EEE d MMM yyyy", { locale: nl })}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Uur</div>
                  <div className="font-medium">{detail.preferred_time} – {detail.pickup_label}</div>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Dienst</div>
                <div className="font-medium">
                  {detail.lines.length > 0
                    ? detail.lines.map((l) => l.service_title).join(", ")
                    : (detail.service_title ?? "—")}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Wagen</div>
                <div className="font-medium">
                  {detail.vehicle_brand || detail.vehicle_model
                    ? `${detail.vehicle_brand ?? ""} ${detail.vehicle_model ?? ""}`.trim()
                    : (detail.vehicle_info ?? "—")}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <a href={`tel:${detail.customer_phone}`} className="text-primary hover:underline">{detail.customer_phone}</a>
                <a href={`mailto:${detail.customer_email}`} className="text-primary hover:underline truncate">{detail.customer_email}</a>
              </div>
              <div className="font-semibold text-lg">€{Number(detail.total_price).toFixed(2)}</div>
              {detail.notes && (
                <div className="p-3 rounded-lg bg-muted text-muted-foreground">{detail.notes}</div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
