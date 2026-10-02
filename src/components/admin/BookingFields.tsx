import { Checkbox } from "@/components/ui/checkbox";
import { AdminLoadError } from "@/components/admin/AdminLoadError";
import type { AgendaVehicleService } from "@/lib/api/admin-reads";
import type { LoadState } from "@/lib/api/load-runner";
import { formatDuration } from "@/lib/time-display";

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-destructive">{message}</p>;
}

/**
 * Services available for the chosen vehicle type (catalogue price/duration per service for
 * information only; the booking total is computed by the server).
 */
export function ServiceChecklist({
  services,
  selected,
  onChange,
}: {
  services: AgendaVehicleService[];
  selected: string[];
  onChange: (serviceIds: string[]) => void;
}) {
  if (services.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic mt-1.5">
        Geen diensten beschikbaar voor dit voertuigtype.
      </p>
    );
  }
  return (
    <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
      {services.map((s) => {
        const checked = selected.includes(s.service_id);
        return (
          <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={checked}
              onCheckedChange={() =>
                onChange(
                  checked
                    ? selected.filter((x) => x !== s.service_id)
                    : [...selected, s.service_id],
                )
              }
            />
            <span className="flex-1">{s.title}</span>
            <span className="text-xs text-muted-foreground">
              €{s.price.toFixed(2)} · {formatDuration(s.duration_minutes)}
            </span>
          </label>
        );
      })}
    </div>
  );
}

interface Slot {
  time: string;
  pickup_date: string;
  pickup_time: string;
}

/** Slot list exactly as returned by GET /api/admin/availability. */
export function SlotPicker({
  date,
  slots,
  state,
  value,
  onChange,
  hint,
  onRetry,
}: {
  date: string;
  slots: Slot[] | null;
  state: LoadState | null;
  value: string;
  onChange: (time: string) => void;
  /** Shown when there is not enough input for an availability request yet. */
  hint: string;
  onRetry?: () => void;
}) {
  if (!state) return <p className="text-sm text-muted-foreground italic mt-2">{hint}</p>;
  if (state.status === "error") {
    return (
      <div className="mt-2">
        <AdminLoadError error={state.error} onRetry={onRetry} />
      </div>
    );
  }
  if (state.status === "loading" || !slots) {
    return <p className="text-sm text-muted-foreground italic mt-2">Vrije slots laden…</p>;
  }
  if (slots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic mt-2">
        Geen vrije slots op deze datum. Kies een andere datum.
      </p>
    );
  }
  return (
    <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto">
      {slots.map((s) => {
        const sameDay = s.pickup_date === date;
        return (
          <button
            key={s.time}
            type="button"
            onClick={() => onChange(s.time)}
            className={`px-2 py-1.5 rounded-md text-sm border transition flex flex-col items-center leading-tight ${value === s.time ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"}`}
          >
            <span className="font-semibold">{s.time}</span>
            <span
              className={`text-[10px] ${value === s.time ? "opacity-90" : "text-muted-foreground"}`}
            >
              ophalen {sameDay ? "" : "+"}
              {s.pickup_time}
              {!sameDay && "*"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
