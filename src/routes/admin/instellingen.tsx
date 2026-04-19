import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Settings as SettingsIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/admin/instellingen")({
  component: AdminSettingsPage,
});

type Settings = {
  id: string;
  km_fee: number;
  base_address: string;
  base_city: string;
  opening_hour: string;
  closing_hour: string;
  slot_interval_minutes: number;
  notification_email: string | null;
};

function AdminSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    supabase.from("site_settings").select("*").limit(1).single().then(({ data }) => {
      if (data) setSettings(data as Settings);
    });
  }, []);

  if (!settings) return <p className="text-muted-foreground">Laden...</p>;

  const save = async () => {
    const { error } = await supabase
      .from("site_settings")
      .update({
        km_fee: settings.km_fee,
        base_address: settings.base_address,
        base_city: settings.base_city,
        opening_hour: settings.opening_hour,
        closing_hour: settings.closing_hour,
        slot_interval_minutes: settings.slot_interval_minutes,
        notification_email: settings.notification_email,
      })
      .eq("id", settings.id);
    if (error) return toast.error(error.message);
    toast.success("Opgeslagen");
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

        <Button onClick={save} className="w-full bg-gradient-primary">
          <Save className="h-4 w-4" /> Opslaan
        </Button>
      </div>
    </div>
  );
}
