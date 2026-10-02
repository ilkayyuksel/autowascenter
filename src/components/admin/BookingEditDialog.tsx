import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminLoadError } from "@/components/admin/AdminLoadError";
import { ServiceChecklist, SlotPicker } from "@/components/admin/BookingFields";
import { useAdminAvailability } from "@/hooks/useAdminAvailability";
import { useAdminLoad } from "@/hooks/useAdminLoad";
import { useAdminMutation } from "@/hooks/useAdminMutation";
import {
  loadAgendaVehicleOptions,
  loadBookingDetail,
  type AgendaVehicleService,
  type BookingDetailView,
  type BookingStatus,
} from "@/lib/api/admin-reads";
import {
  bookingPriceSummary,
  deleteAdminBooking,
  updateAdminBooking,
} from "@/lib/api/admin-writes";
import { bookingPatchFrom, type BookingEditState } from "@/lib/api/booking-edit";

const STATUS_LABEL: Record<BookingStatus, string> = {
  nieuw: "Nieuw",
  bevestigd: "Bevestigd",
  voltooid: "Voltooid",
  geannuleerd: "Geannuleerd",
};

/**
 * Edit an appointment through the API only:
 * - the booking is (re)loaded with GET /api/admin/bookings/:id (never stale list data);
 * - move / status / notes / vehicle type / services → PATCH /api/admin/bookings/:id with the
 *   changed fields only; the server re-checks the schedule (excluding this booking),
 *   re-prices and replaces the service snapshots;
 * - free slots → GET /api/admin/availability with exclude_booking_id;
 * - delete → DELETE /api/admin/bookings/:id.
 * Duration, price and service names can no longer be typed in: they follow from services.
 */
export function BookingEditDialog({
  bookingId,
  onOpenChange,
  onSaved,
  onStale,
}: {
  bookingId: string;
  onOpenChange: (open: boolean) => void;
  /** A change was saved: the page closes the dialog and reloads its data from the API. */
  onSaved: () => void;
  /** The shown data is stale (404/409/timeout): the page reloads, the dialog stays open. */
  onStale: () => void;
}) {
  const detailLoad = useAdminLoad();
  const [booking, setBooking] = useState<BookingDetailView | null>(null);
  const [edit, setEdit] = useState<BookingEditState | null>(null);
  const [moveMode, setMoveMode] = useState(false);
  const [editServices, setEditServices] = useState(false);

  const { api: detailApi, run: runDetail } = detailLoad;
  const reloadBooking = useCallback(
    () =>
      runDetail(
        (signal) => loadBookingDetail(detailApi, bookingId, { signal }),
        (detail) => {
          setBooking(detail);
          setEdit({
            preferred_date: detail.preferred_date,
            preferred_time: detail.preferred_time,
            status: detail.status,
            notes: detail.notes ?? "",
            vehicle_type_id: detail.vehicle_type_id ?? "",
            service_ids: detail.lines.flatMap((l) => (l.service_id ? [l.service_id] : [])),
          });
        },
      ),
    [detailApi, runDetail, bookingId],
  );
  useEffect(() => {
    reloadBooking();
  }, [reloadBooking]);

  const options = useAdminLoad();
  const [vehicleTypes, setVehicleTypes] = useState<{ id: string; title: string }[]>([]);
  const [servicesByType, setServicesByType] = useState<Record<string, AgendaVehicleService[]>>({});
  const { api: optionsApi, run: runOptions } = options;
  useEffect(() => {
    if (!editServices) return;
    runOptions(
      (signal) => loadAgendaVehicleOptions(optionsApi, { signal }),
      (data) => {
        setVehicleTypes(data.vehicleTypes);
        setServicesByType(data.servicesByType);
      },
    );
  }, [editServices, optionsApi, runOptions]);

  const original = useMemo<BookingEditState | null>(
    () =>
      booking && {
        preferred_date: booking.preferred_date,
        preferred_time: booking.preferred_time,
        status: booking.status,
        notes: booking.notes ?? "",
        vehicle_type_id: booking.vehicle_type_id ?? "",
        service_ids: booking.lines.flatMap((l) => (l.service_id ? [l.service_id] : [])),
      },
    [booking],
  );
  const servicesChanged =
    !!edit && !!original && bookingPatchFrom(original, edit).service_ids !== undefined;

  // Server slots for the move; with changed services, for the new selection.
  const availabilityQuery = useMemo(() => {
    if (!moveMode || !edit?.preferred_date) return null;
    if (servicesChanged) {
      if (!edit.vehicle_type_id || edit.service_ids.length === 0) return null;
      return {
        date: edit.preferred_date,
        exclude_booking_id: bookingId,
        vehicle_type_id: edit.vehicle_type_id,
        service_ids: edit.service_ids,
      };
    }
    return { date: edit.preferred_date, exclude_booking_id: bookingId };
  }, [moveMode, edit, servicesChanged, bookingId]);
  const availability = useAdminAvailability(availabilityQuery);

  const { mutate, pending } = useAdminMutation();
  const update = (patch: Partial<BookingEditState>) => setEdit((e) => (e ? { ...e, ...patch } : e));

  const afterStale = () => {
    availability.reload();
    reloadBooking();
    onStale();
  };

  const save = async () => {
    if (!edit || !original) return;
    const patch = bookingPatchFrom(original, edit);
    if (Object.keys(patch).length === 0) return onOpenChange(false);
    const saved = await mutate((api) => updateAdminBooking(api, bookingId, patch), {
      success: (b) => `Afspraak bijgewerkt — ${bookingPriceSummary(b.pricing).text}`,
      onStale: afterStale,
    });
    if (saved) onSaved();
  };

  const cancelBooking = async () => {
    if (!confirm("Deze afspraak annuleren?")) return;
    const saved = await mutate(
      (api) => updateAdminBooking(api, bookingId, { status: "geannuleerd" }),
      {
        success: "Afspraak geannuleerd",
        onStale: afterStale,
      },
    );
    if (saved) onSaved();
  };

  const removeBooking = async () => {
    if (!confirm("Definitief verwijderen? Dit kan niet ongedaan gemaakt worden.")) return;
    const done = await mutate((api) => deleteAdminBooking(api, bookingId).then(() => true), {
      success: "Verwijderd",
      onStale,
    });
    if (done) onSaved();
  };

  const vehicle = booking
    ? `${booking.vehicle_brand ?? ""} ${booking.vehicle_model ?? ""}`.trim() ||
      booking.vehicle_info ||
      ""
    : "";
  const services = edit?.vehicle_type_id ? (servicesByType[edit.vehicle_type_id] ?? []) : [];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {detailLoad.state.status === "error" ? (
          <>
            <DialogHeader>
              <DialogTitle>Afspraak</DialogTitle>
            </DialogHeader>
            <AdminLoadError error={detailLoad.state.error} onRetry={reloadBooking} />
          </>
        ) : !booking || !edit ? (
          <>
            <DialogHeader>
              <DialogTitle>Afspraak</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">Laden...</p>
          </>
        ) : (
          <>
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
              {vehicle && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Voertuig:</span> {vehicle}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <Label>Dienst(en)</Label>
                  {!editServices && (
                    <button
                      type="button"
                      onClick={() => setEditServices(true)}
                      className="text-xs text-primary hover:underline"
                    >
                      Voertuigtype / diensten wijzigen
                    </button>
                  )}
                </div>
                {!editServices ? (
                  <div className="mt-1 text-sm font-medium">
                    {booking.lines.map((l) => l.service_title).join(", ") ||
                      booking.service_title ||
                      "—"}
                    {booking.vehicle_type_title && (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        · {booking.vehicle_type_title}
                      </span>
                    )}
                  </div>
                ) : options.state.status === "error" ? (
                  <AdminLoadError error={options.state.error} />
                ) : (
                  <div className="mt-1 space-y-2">
                    <Select
                      value={edit.vehicle_type_id}
                      onValueChange={(v) => update({ vehicle_type_id: v, service_ids: [] })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Kies type" />
                      </SelectTrigger>
                      <SelectContent>
                        {vehicleTypes.map((vt) => (
                          <SelectItem key={vt.id} value={vt.id}>
                            {vt.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <ServiceChecklist
                      services={services}
                      selected={edit.service_ids}
                      onChange={(ids) => {
                        update({ service_ids: ids });
                        setMoveMode(true);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Prijs en duur worden bij het opslaan door de server herberekend.
                    </p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Datum</Label>
                  <Input
                    type="date"
                    value={edit.preferred_date}
                    onChange={(e) => {
                      update({ preferred_date: e.target.value });
                      setMoveMode(true);
                    }}
                  />
                </div>
                <div>
                  <Label>Ophalen</Label>
                  <Input
                    value={booking.pickup_label}
                    readOnly
                    className="bg-muted"
                    title="Berekend door de server"
                  />
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
                  <Input value={edit.preferred_time} readOnly className="bg-muted" />
                ) : (
                  <SlotPicker
                    date={edit.preferred_date}
                    slots={availability.data?.slots ?? null}
                    state={availability.state}
                    value={edit.preferred_time}
                    onChange={(time) => update({ preferred_time: time })}
                    hint="Kies minstens één dienst om vrije slots te zien."
                    onRetry={availability.reload}
                  />
                )}
              </div>

              <div>
                <Label>Status</Label>
                <Select
                  value={edit.status}
                  onValueChange={(v) => update({ status: v as BookingStatus })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
                <Textarea
                  rows={2}
                  value={edit.notes}
                  onChange={(e) => update({ notes: e.target.value })}
                />
              </div>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
              <div className="flex gap-2 mr-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={cancelBooking}
                  disabled={pending || booking.status === "geannuleerd"}
                >
                  <X className="h-4 w-4" /> Annuleren
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={removeBooking}
                  disabled={pending}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4" /> Verwijderen
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Sluiten
                </Button>
                <Button onClick={save} disabled={pending} className="bg-gradient-primary">
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Opslaan
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
