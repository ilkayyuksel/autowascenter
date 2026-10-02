import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
// WRITE side (create, save, package contents, delete) still uses Supabase until phase 6D-2.
import { supabase } from "@/integrations/supabase/client";
import { useAdminLoad } from "@/hooks/useAdminLoad";
import { AdminLoadError } from "@/components/admin/AdminLoadError";
import { loadServices, type ServiceItem, type ServiceKind } from "@/lib/api/admin-reads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

type Kind = ServiceKind;
// READ model from GET /api/admin/services (package contents via included_service_ids).
type Service = ServiceItem;

const ICONS = ["sparkles", "spray-can", "car", "shield"];
const KIND_LABELS: Record<Kind, string> = { pakket: "Pakketten", dienst: "Diensten", extra: "Extra diensten" };

export const Route = createFileRoute("/admin/diensten")({
  component: ServicesAdmin,
});

function ServicesAdmin() {
  const [items, setItems] = useState<Service[]>([]);
  const [contents, setContents] = useState<Record<string, string[]>>({});

  const { api, state, run } = useAdminLoad();

  const load = useCallback(
    () =>
      run(
        (signal) => loadServices(api, { signal }),
        (data) => {
          setItems(data.items);
          setContents(data.contents);
        },
      ),
    [api, run],
  );

  useEffect(() => { load(); }, [load]);

  const addNew = async (kind: Kind) => {
    const title = kind === "pakket" ? "Nieuw pakket" : kind === "extra" ? "Nieuwe extra dienst" : "Nieuwe dienst";
    const { data, error } = await supabase
      .from("services")
      .insert({ title, sort_order: items.length, icon: "sparkles", kind })
      .select()
      .single();
    if (error) return toast.error("Aanmaken mislukt");
    if (data) {
      // create price rows for all vehicle types so it can be priced immediately
      const { data: vts } = await supabase.from("vehicle_types").select("id");
      if (vts?.length) {
        await supabase.from("vehicle_type_services").insert(
          vts.map((v) => ({ vehicle_type_id: v.id, service_id: data.id, available: true, price: 0, duration_minutes: 60 })),
        );
      }
      setItems([...items, data as Service]);
      toast.success("Aangemaakt — stel prijs & duur in onder Voertuigen & prijzen");
    }
  };

  const save = async (s: Service) => {
    const { error } = await supabase.from("services").update({
      title: s.title, description: s.description,
      icon: s.icon, category: s.category, badge: s.badge,
      bookable: s.bookable, sort_order: s.sort_order, active: s.active, kind: s.kind,
    }).eq("id", s.id);
    if (error) return toast.error("Opslaan mislukt");
    if (s.kind === "pakket") {
      await supabase.from("package_services").delete().eq("package_id", s.id);
      const ids = contents[s.id] ?? [];
      if (ids.length) {
        const { error: e2 } = await supabase.from("package_services").insert(ids.map((sid) => ({ package_id: s.id, service_id: sid })));
        if (e2) return toast.error("Pakketinhoud opslaan mislukt");
      }
    }
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

  const toggleContent = (pkgId: string, sid: string) =>
    setContents((c) => {
      const cur = c[pkgId] ?? [];
      return { ...c, [pkgId]: cur.includes(sid) ? cur.filter((x) => x !== sid) : [...cur, sid] };
    });

  const regular = items.filter((x) => x.kind !== "pakket");

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Diensten, pakketten & extra's</h1>
          <p className="mt-2 text-muted-foreground">
            Prijs en duur stel je per voertuigtype in onder
            <span className="font-medium text-foreground"> Voertuigen & prijzen</span>.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => addNew("pakket")} variant="outline"><Plus className="h-4 w-4" /> Pakket</Button>
          <Button onClick={() => addNew("extra")} variant="outline"><Plus className="h-4 w-4" /> Extra dienst</Button>
          <Button onClick={() => addNew("dienst")} className="bg-gradient-primary"><Plus className="h-4 w-4" /> Dienst</Button>
        </div>
      </div>

      {state.status === "loading" && <p className="mt-10 text-sm text-muted-foreground">Laden...</p>}
      {state.status === "error" && (
        <div className="mt-10">
          <AdminLoadError error={state.error} onRetry={load} />
        </div>
      )}

      {(state.status === "success" ? (["pakket", "dienst", "extra"] as Kind[]) : []).map((kind) => {
        const group = items.filter((x) => x.kind === kind);
        return (
          <section key={kind} className="mt-10">
            <h2 className="text-lg font-bold">{KIND_LABELS[kind]}</h2>
            {group.length === 0 && <p className="mt-2 text-sm text-muted-foreground italic">Nog niets toegevoegd.</p>}
            <div className="mt-4 space-y-4">
              {group.map((s) => (
                <div key={s.id} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label>Titel</Label>
                      <Input value={s.title} onChange={(e) => update(s.id, { title: e.target.value })} className="mt-1.5" />
                    </div>
                    <div>
                      <Label>Type</Label>
                      <select
                        value={s.kind}
                        onChange={(e) => update(s.id, { kind: e.target.value as Kind })}
                        className="mt-1.5 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="dienst">Dienst</option>
                        <option value="extra">Extra dienst</option>
                        <option value="pakket">Pakket</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <Label>Beschrijving</Label>
                      <Textarea rows={2} value={s.description ?? ""} onChange={(e) => update(s.id, { description: e.target.value })} className="mt-1.5" />
                    </div>
                    {s.kind === "pakket" && (
                      <div className="md:col-span-2">
                        <Label>Inbegrepen diensten</Label>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {regular.map((r) => (
                            <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={(contents[s.id] ?? []).includes(r.id)}
                                onCheckedChange={() => toggleContent(s.id, r.id)}
                              />
                              {r.title}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <Label>Categorie</Label>
                      <Input value={s.category ?? ""} placeholder="bv. Exterieur, Interieur" onChange={(e) => update(s.id, { category: e.target.value })} className="mt-1.5" />
                    </div>
                    <div>
                      <Label>Badge (optioneel)</Label>
                      <Input value={s.badge ?? ""} placeholder="bv. Populair" onChange={(e) => update(s.id, { badge: e.target.value })} className="mt-1.5" />
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
                    <div>
                      <Label>Volgorde</Label>
                      <Input type="number" value={s.sort_order} onChange={(e) => update(s.id, { sort_order: Number(e.target.value) })} className="mt-1.5" />
                    </div>
                    <div className="flex items-end gap-4 md:col-span-2">
                      <div className="flex items-center gap-2">
                        <Switch checked={s.active} onCheckedChange={(v) => update(s.id, { active: v })} />
                        <Label>Actief op site</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={s.bookable} onCheckedChange={(v) => update(s.id, { bookable: v })} />
                        <Label>Online boekbaar</Label>
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
          </section>
        );
      })}
    </div>
  );
}
