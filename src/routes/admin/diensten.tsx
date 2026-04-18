import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Service = {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  duration_minutes: number | null;
  icon: string | null;
  sort_order: number;
  active: boolean;
};

const ICONS = ["sparkles", "spray-can", "car", "shield"];

export const Route = createFileRoute("/admin/diensten")({
  component: ServicesAdmin,
});

function ServicesAdmin() {
  const [items, setItems] = useState<Service[]>([]);

  const load = async () => {
    const { data } = await supabase.from("services").select("*").order("sort_order");
    setItems((data as Service[]) ?? []);
  };

  useEffect(() => { load(); }, []);

  const addNew = async () => {
    const { data, error } = await supabase
      .from("services")
      .insert({ title: "Nieuwe dienst", sort_order: items.length, icon: "sparkles" })
      .select()
      .single();
    if (error) return toast.error("Aanmaken mislukt");
    if (data) setItems([...items, data as Service]);
  };

  const save = async (s: Service) => {
    const { error } = await supabase.from("services").update({
      title: s.title, description: s.description, price: s.price,
      duration_minutes: s.duration_minutes, icon: s.icon, sort_order: s.sort_order, active: s.active,
    }).eq("id", s.id);
    if (error) return toast.error("Opslaan mislukt");
    toast.success("Opgeslagen");
  };

  const remove = async (id: string) => {
    if (!confirm("Verwijderen?")) return;
    const { error } = await supabase.from("services").delete().eq("id", id);
    if (error) return toast.error("Verwijderen mislukt");
    setItems(items.filter((x) => x.id !== id));
  };

  const update = (id: string, patch: Partial<Service>) =>
    setItems(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Diensten</h1>
          <p className="mt-2 text-muted-foreground">Beheer wat klanten op de site zien.</p>
        </div>
        <Button onClick={addNew} className="bg-gradient-primary"><Plus className="h-4 w-4" /> Nieuwe dienst</Button>
      </div>

      <div className="mt-8 space-y-4">
        {items.map((s) => (
          <div key={s.id} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Titel</Label>
                <Input value={s.title} onChange={(e) => update(s.id, { title: e.target.value })} className="mt-1.5" />
              </div>
              <div>
                <Label>Icoon</Label>
                <select
                  value={s.icon ?? "sparkles"}
                  onChange={(e) => update(s.id, { icon: e.target.value })}
                  className="mt-1.5 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <Label>Beschrijving</Label>
                <Textarea rows={2} value={s.description ?? ""} onChange={(e) => update(s.id, { description: e.target.value })} className="mt-1.5" />
              </div>
              <div>
                <Label>Prijs (€)</Label>
                <Input type="number" step="0.01" value={s.price ?? ""} onChange={(e) => update(s.id, { price: e.target.value === "" ? null : Number(e.target.value) })} className="mt-1.5" />
              </div>
              <div>
                <Label>Duur (minuten)</Label>
                <Input type="number" value={s.duration_minutes ?? ""} onChange={(e) => update(s.id, { duration_minutes: e.target.value === "" ? null : Number(e.target.value) })} className="mt-1.5" />
              </div>
              <div>
                <Label>Volgorde</Label>
                <Input type="number" value={s.sort_order} onChange={(e) => update(s.id, { sort_order: Number(e.target.value) })} className="mt-1.5" />
              </div>
              <div className="flex items-end gap-3">
                <div className="flex items-center gap-2">
                  <Switch checked={s.active} onCheckedChange={(v) => update(s.id, { active: v })} />
                  <Label>Actief op site</Label>
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => remove(s.id)} className="text-destructive">
                <Trash2 className="h-4 w-4" /> Verwijderen
              </Button>
              <Button onClick={() => save(s)}>
                <Save className="h-4 w-4" /> Opslaan
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
