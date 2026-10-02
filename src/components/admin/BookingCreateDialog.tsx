import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { FieldError, ServiceChecklist, SlotPicker } from "@/components/admin/BookingFields";
import { useAdminAvailability } from "@/hooks/useAdminAvailability";
import { useAdminLoad } from "@/hooks/useAdminLoad";
import { useAdminMutation } from "@/hooks/useAdminMutation";
import { loadAgendaVehicleOptions, type AgendaVehicleService } from "@/lib/api/admin-reads";
import { bookingPriceSummary, createAdminBooking, todayLocal } from "@/lib/api/admin-writes";
import type { FieldErrors } from "@/lib/api/admin-writes";
import {
  emptyBookingForm,
  validateBookingForm,
  type BookingFormState,
  type CreatableStatus,
} from "@/lib/api/booking-form";
import { formatDuration } from "@/lib/time-display";

/**
 * "Nieuwe afspraak" (agenda and reservations): POST /api/admin/bookings. The admin picks the
 * vehicle type, one or more services, a date and a FREE SLOT FROM THE SERVER
 * (GET /api/admin/availability). Price, duration, end time and cancel token are computed by
 * the server; there are no price/duration/service-name inputs. E-mail is required.
 */
export function BookingCreateDialog({
  open,
  onOpenChange,
  defaultDate,
  defaultTime,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: string;
  defaultTime?: string;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<BookingFormState>(() =>
    emptyBookingForm(defaultDate ?? todayLocal(), defaultTime ?? ""),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (patch: Partial<BookingFormState>) => setForm((f) => ({ ...f, ...patch }));

  // Vehicle types + per-type services: one GET /api/admin/vehicle-types.
  const options = useAdminLoad();
  const [vehicleTypes, setVehicleTypes] = useState<{ id: string; title: string }[]>([]);
  const [servicesByType, setServicesByType] = useState<Record<string, AgendaVehicleService[]>>({});
  const { api: optionsApi, run: runOptions } = options;
  useEffect(() => {
    runOptions(
      (signal) => loadAgendaVehicleOptions(optionsApi, { signal }),
      (data) => {
        setVehicleTypes(data.vehicleTypes);
        setServicesByType(data.servicesByType);
      },
    );
  }, [optionsApi, runOptions]);
  const services = form.vehicle_type_id ? (servicesByType[form.vehicle_type_id] ?? []) : [];

  const availabilityQuery = useMemo(
    () =>
      form.preferred_date && form.vehicle_type_id && form.service_ids.length > 0
        ? {
            date: form.preferred_date,
            vehicle_type_id: form.vehicle_type_id,
            service_ids: form.service_ids,
          }
        : null,
    [form.preferred_date, form.vehicle_type_id, form.service_ids],
  );
  const availability = useAdminAvailability(availabilityQuery);

  // A chosen time that is no longer offered by the server is cleared.
  useEffect(() => {
    if (
      availability.data &&
      form.preferred_time &&
      !availability.data.slots.some((s) => s.time === form.preferred_time)
    ) {
      setForm((f) => ({ ...f, preferred_time: "" }));
    }
  }, [availability.data, form.preferred_time]);

  const { mutate, pending } = useAdminMutation();

  const submit = async () => {
    const result = validateBookingForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      toast.error(Object.values(result.errors)[0] ?? "Controleer de velden");
      return;
    }
    setErrors({});
    const created = await mutate((api) => createAdminBooking(api, result.request), {
      // Totals exactly as computed by the server.
      success: (booking) => `Afspraak aangemaakt — ${bookingPriceSummary(booking.pricing).text}`,
      onStale: () => {
        set({ preferred_time: "" });
        availability.reload();
      },
    });
    if (created) onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nieuwe afspraak</DialogTitle>
          <DialogDescription>
            Vrije tijdsloten, duur en prijs worden door de server berekend.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Klantnaam *</Label>
              <Input
                value={form.customer_name}
                onChange={(e) => set({ customer_name: e.target.value })}
              />
              <FieldError message={errors.customer_name} />
            </div>
            <div>
              <Label>Telefoon *</Label>
              <Input
                value={form.customer_phone}
                onChange={(e) => set({ customer_phone: e.target.value })}
              />
              <FieldError message={errors.customer_phone} />
            </div>
          </div>
          <div>
            <Label>E-mail *</Label>
            <Input
              type="email"
              required
              value={form.customer_email}
              onChange={(e) => set({ customer_email: e.target.value })}
            />
            <FieldError message={errors.customer_email} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Merk</Label>
              <Input
                value={form.vehicle_brand}
                onChange={(e) => set({ vehicle_brand: e.target.value })}
              />
              <FieldError message={errors.vehicle_brand} />
            </div>
            <div>
              <Label>Model</Label>
              <Input
                value={form.vehicle_model}
                onChange={(e) => set({ vehicle_model: e.target.value })}
              />
              <FieldError message={errors.vehicle_model} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Voertuigtype *</Label>
              <Select
                value={form.vehicle_type_id}
                onValueChange={(v) =>
                  set({ vehicle_type_id: v, service_ids: [], preferred_time: "" })
                }
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
              <FieldError message={errors.vehicle_type_id} />
            </div>
            <div>
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => set({ status: v as CreatableStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nieuw">Nieuw</SelectItem>
                  <SelectItem value="bevestigd">Bevestigd</SelectItem>
                  <SelectItem value="voltooid">Voltooid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Dienst(en) *</Label>
            {options.state.status === "error" ? (
              <div className="mt-1.5">
                <AdminLoadError error={options.state.error} />
              </div>
            ) : !form.vehicle_type_id ? (
              <p className="text-xs text-muted-foreground italic mt-1.5">
                Kies eerst een voertuigtype om beschikbare diensten te zien.
              </p>
            ) : (
              <ServiceChecklist
                services={services}
                selected={form.service_ids}
                onChange={(ids) => set({ service_ids: ids, preferred_time: "" })}
              />
            )}
            <FieldError message={errors.service_ids} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Datum *</Label>
              <Input
                type="date"
                value={form.preferred_date}
                min={todayLocal()}
                onChange={(e) => set({ preferred_date: e.target.value, preferred_time: "" })}
              />
              <FieldError message={errors.preferred_date} />
            </div>
            <div>
              <Label>Duur</Label>
              <Input
                value={
                  availability.data ? formatDuration(availability.data.total_duration_minutes) : "—"
                }
                readOnly
                className="bg-muted"
                title="Berekend door de server op basis van de gekozen diensten"
              />
            </div>
          </div>

          <div>
            <Label>Wagen afgeven om — kies een vrij tijdslot *</Label>
            <SlotPicker
              date={form.preferred_date}
              slots={availability.data?.slots ?? null}
              state={availability.state}
              value={form.preferred_time}
              onChange={(time) => set({ preferred_time: time })}
              hint="Kies een voertuigtype, dienst(en) en datum om vrije slots te zien."
              onRetry={availability.reload}
            />
            <FieldError message={errors.preferred_time} />
          </div>

          <div>
            <Label>Notities</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
            <FieldError message={errors.notes} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button onClick={submit} disabled={pending} className="bg-gradient-primary">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Opslaan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
