import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Settings as SettingsIcon } from "lucide-react";
// Reads and writes through the API: GET/PATCH /api/admin/settings (partial update).
import { useAdminLoad } from "@/hooks/useAdminLoad";
import { useAdminMutation } from "@/hooks/useAdminMutation";
import { AdminLoadError } from "@/components/admin/AdminLoadError";
import { loadSettings, toSettingsForm, type SettingsForm } from "@/lib/api/admin-reads";
import { changedFields, updateSettings } from "@/lib/api/admin-writes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/admin/instellingen")({
  component: AdminSettingsPage,
});

// READ model from GET /api/admin/settings (one object; no client-side defaults).
type Settings = SettingsForm;

function AdminSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  // Last state confirmed by the API: only fields that differ from it are sent.
  const [saved, setSaved] = useState<Settings | null>(null);
  const { mutate, pending } = useAdminMutation();

  const { api, state, run } = useAdminLoad();

  const load = useCallback(
    () =>
      run(
        (signal) => loadSettings(api, { signal }),
        (data) => {
          setSettings(data);
          setSaved(data);
        },
      ),
    [api, run],
  );

  useEffect(() => {
    load();
  }, [load]);

  // 500 SETTINGS_NOT_CONFIGURED is shown as a configuration error (not retryable).
  if (state.status === "error") return <AdminLoadError error={state.error} onRetry={load} />;
  if (!settings) return <p className="text-muted-foreground">Laden...</p>;

  // PATCH only the changed settings; the server merges them with the stored row and
  // validates the result (e.g. opening before closing hour).
  const save = async () => {
    const { id: _id, ...patch } = saved ? changedFields(saved, settings) : settings;
    if (Object.keys(patch).length === 0) return toast.info("Geen wijzigingen");
    const result = await mutate((api) => updateSettings(api, patch), {
      success: "Opgeslagen",
      onStale: load,
    });
    if (result) {
      const form = toSettingsForm(result);
      setSettings(form);
      setSaved(form);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <SettingsIcon className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Algemene instellingen</h1>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 max-w-2xl space-y-4">
        <div>
          <Label>Km-vergoeding (€/km)</Label>
          <Input
            type="number"
            step="0.01"
            value={settings.km_fee}
            onChange={(e) => setSettings({ ...settings, km_fee: Number(e.target.value) })}
          />
        </div>
        <div>
          <Label>Gratis km (straal vanaf basisadres)</Label>
          <Input
            type="number"
            value={settings.free_km}
            onChange={(e) => setSettings({ ...settings, free_km: Number(e.target.value) })}
          />
        </div>
        <div>
          <Label>Basisadres (vertrekpunt km-berekening)</Label>
          <Input
            value={settings.base_address}
            onChange={(e) => setSettings({ ...settings, base_address: e.target.value })}
          />
        </div>
        <div>
          <Label>Basisgemeente (gratis op locatie)</Label>
          <Input
            value={settings.base_city}
            onChange={(e) => setSettings({ ...settings, base_city: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Openingsuur</Label>
            <Input
              type="time"
              value={settings.opening_hour}
              onChange={(e) => setSettings({ ...settings, opening_hour: e.target.value })}
            />
          </div>
          <div>
            <Label>Sluitingsuur</Label>
            <Input
              type="time"
              value={settings.closing_hour}
              onChange={(e) => setSettings({ ...settings, closing_hour: e.target.value })}
            />
          </div>
          <div>
            <Label>Slotinterval (min)</Label>
            <Input
              type="number"
              value={settings.slot_interval_minutes}
              onChange={(e) => setSettings({ ...settings, slot_interval_minutes: Number(e.target.value) })}
            />
          </div>
        </div>
        <div>
          <Label>Notificatie e-mail</Label>
          <Input
            type="email"
            value={settings.notification_email ?? ""}
            onChange={(e) => setSettings({ ...settings, notification_email: e.target.value })}
          />
        </div>

        <Button onClick={save} disabled={pending} className="w-full bg-gradient-primary">
          <Save className="h-4 w-4" /> Opslaan
        </Button>
      </div>
    </div>
  );
}
