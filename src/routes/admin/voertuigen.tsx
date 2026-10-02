import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Save } from "lucide-react";
// Reads and writes through the API; pricing rows of a new type are created by the server,
// and the matrix is saved all-or-nothing with one PUT.
import { useAdminLoad } from "@/hooks/useAdminLoad";
import { useAdminMutation } from "@/hooks/useAdminMutation";
import {
  createAdminVehicleType,
  deleteAdminVehicleType,
  updateAdminPricing,
  updateAdminVehicleType,
} from "@/lib/api/admin-writes";
import { AdminLoadError } from "@/components/admin/AdminLoadError";
import {
  loadVehiclesPage,
  type PricingRow,
  type PricingService,
  type VehicleTypeItem,
} from "@/lib/api/admin-reads";
import { getVehicleIcon } from "@/lib/vehicleIcons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/admin/voertuigen")({
  component: AdminVehiclesPage,
});

// READ models from GET /api/admin/vehicle-types (types + full pricing matrix in one call).
type VehicleType = VehicleTypeItem;
type Service = PricingService;
type Vts = PricingRow;
type VehiclePatch = Partial<
  Pick<VehicleType, "title" | "description" | "image_url" | "active" | "sort_order">
>;

function AdminVehiclesPage() {
  const [vts, setVts] = useState<Vts[]>([]);
  const [vehicles, setVehicles] = useState<VehicleType[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);

  const { api, state, run } = useAdminLoad();

  const refresh = useCallback(
    () =>
      run(
        (signal) => loadVehiclesPage(api, { signal }),
        (data) => {
          setVehicles(data.vehicles);
          setServices(data.services);
          setVts(data.vts);
        },
      ),
    [api, run],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const { mutate } = useAdminMutation();

  // POST /api/admin/vehicle-types: slug, title, sort order and a pricing row for every
  // active, bookable service are created by the server, in one transaction.
  const addVehicle = async () => {
    const created = await mutate((api) => createAdminVehicleType(api), {
      success: "Voertuigtype aangemaakt",
    });
    if (created) refresh();
  };

  const updateVehicle = async (id: string, patch: VehiclePatch) => {
    await mutate((api) => updateAdminVehicleType(api, id, patch), { onStale: refresh });
    refresh();
  };

  // 409 RESOURCE_IN_USE (still used by bookings) is shown as a clear message.
  const deleteVehicle = async (id: string) => {
    if (!confirm("Verwijderen?")) return;
    const done = await mutate((api) => deleteAdminVehicleType(api, id).then(() => true), {
      success: "Verwijderd",
      onStale: refresh,
    });
    if (done) refresh();
  };

  const updateVts = async (vtsId: string, patch: Partial<Vts>) => {
    setVts((curr) => curr.map((x) => (x.id === vtsId ? { ...x, ...patch } : x)));
  };

  // PUT /api/admin/vehicle-types/:id/pricing with all rows of the open type (also rows that
  // are hidden here); one invalid row → nothing is saved. Then reload the matrix.
  const saveVts = async () => {
    if (!selectedVehicle) return;
    const rows = vts.filter((v) => v.vehicle_type_id === selectedVehicle);
    const saved = await mutate((api) => updateAdminPricing(api, selectedVehicle, rows), {
      success: "Prijzen opgeslagen",
      onStale: refresh,
    });
    if (saved) refresh();
  };

  const currentVts = vts.filter((v) => v.vehicle_type_id === selectedVehicle);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Voertuigtypes & prijzen</h1>
        <Button onClick={addVehicle} className="bg-gradient-primary">
          <Plus className="h-4 w-4" /> Nieuw voertuigtype
        </Button>
      </div>

      {state.status === "loading" && vehicles.length === 0 && (
        <p className="text-sm text-muted-foreground">Laden...</p>
      )}
      {state.status === "error" && (
        <div className="mb-6">
          <AdminLoadError error={state.error} onRetry={refresh} />
        </div>
      )}
      {state.status === "success" && vehicles.length === 0 && (
        <p className="text-sm text-muted-foreground italic">Nog geen voertuigtypes.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {vehicles.map((v) => {
          const VIcon = getVehicleIcon(v.slug);
          return (
          <div key={v.id} className="rounded-2xl border border-border bg-card p-5 space-y-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-accent flex items-center justify-center">
                <VIcon className="h-5 w-5 text-primary" strokeWidth={1.75} />
              </div>
              <div className="flex-1 space-y-2">
                <Input
                  value={v.title}
                  onChange={(e) => setVehicles((c) => c.map((x) => x.id === v.id ? { ...x, title: e.target.value } : x))}
                  onBlur={(e) => updateVehicle(v.id, { title: e.target.value })}
                />
                <Textarea
                  rows={2}
                  value={v.description ?? ""}
                  placeholder="Korte beschrijving"
                  onChange={(e) => setVehicles((c) => c.map((x) => x.id === v.id ? { ...x, description: e.target.value } : x))}
                  onBlur={(e) => updateVehicle(v.id, { description: e.target.value })}
                />
                <Input
                  value={v.image_url ?? ""}
                  placeholder="Foto URL (optioneel)"
                  onChange={(e) => setVehicles((c) => c.map((x) => x.id === v.id ? { ...x, image_url: e.target.value } : x))}
                  onBlur={(e) => updateVehicle(v.id, { image_url: e.target.value || null })}
                />
                <div className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={v.active}
                      onCheckedChange={(c) => updateVehicle(v.id, { active: !!c })}
                    />
                    Actief
                  </label>
                  <Input
                    type="number"
                    className="w-24"
                    value={v.sort_order}
                    onChange={(e) => updateVehicle(v.id, { sort_order: Number(e.target.value) })}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedVehicle(selectedVehicle === v.id ? null : v.id)}
                  >
                    {selectedVehicle === v.id ? "Sluit prijzen" : "Prijzen / diensten"}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteVehicle(v.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>

            {selectedVehicle === v.id && (
              <div className="border-t border-border pt-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Prijs & duur per dienst</p>
                {currentVts.map((row) => {
                  const svc = services.find((s) => s.id === row.service_id);
                  if (!svc) return null;
                  return (
                    <div key={row.id} className="grid grid-cols-12 gap-2 items-center text-sm">
                      <Checkbox
                        className="col-span-1"
                        checked={row.available}
                        onCheckedChange={(c) => updateVts(row.id, { available: !!c })}
                      />
                      <div className="col-span-5 truncate">{svc.title}{svc.kind !== "dienst" && <span className="ml-1 text-[10px] text-primary">({svc.kind === "pakket" ? "pakket" : "extra"})</span>}</div>
                      <div className="col-span-3">
                        <Input
                          type="number"
                          step="0.01"
                          value={row.price}
                          onChange={(e) => updateVts(row.id, { price: Number(e.target.value) })}
                          className="h-9"
                        />
                      </div>
                      <div className="col-span-3">
                        <Input
                          type="number"
                          value={row.duration_minutes}
                          onChange={(e) => updateVts(row.id, { duration_minutes: Number(e.target.value) })}
                          className="h-9"
                          placeholder="min"
                        />
                      </div>
                    </div>
                  );
                })}
                <Button onClick={saveVts} className="bg-gradient-primary w-full mt-2">
                  <Save className="h-4 w-4" /> Prijzen opslaan
                </Button>
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
