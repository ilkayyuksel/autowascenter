import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Save } from "lucide-react";
// Reads and writes through the API (services, package contents); pricing rows for a new
// service are created by the server in the same transaction.
import { useAdminLoad } from "@/hooks/useAdminLoad";
import { useAdminMutation } from "@/hooks/useAdminMutation";
import { AdminLoadError } from "@/components/admin/AdminLoadError";
import {
  loadServices,
  toServiceItem,
  type ServiceItem,
  type ServiceKind,
} from "@/lib/api/admin-reads";
import {
  createAdminService,
  deleteAdminService,
  updateAdminService,
  updatePackageContent,
} from "@/lib/api/admin-writes";
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

  const { mutate } = useAdminMutation();

  // POST /api/admin/services: defaults (title, icon, sort order) and a pricing row for every
  // vehicle type are created by the server, in one transaction.
  const addNew = async (kind: Kind) => {
    const created = await mutate((api) => createAdminService(api, { kind }), {
      success: "Aangemaakt — stel prijs & duur in onder Voertuigen & prijzen",
    });
    if (created) load();
  };

  // PATCH the service; for a package also PUT the complete contents (replaced server-side
  // in one transaction). The card then shows the API's response; other cards keep their
  // unsaved edits.
  const save = async (s: Service) => {
    const saved = await mutate(
      async (api) => {
        let result = await updateAdminService(api, s.id, {
          title: s.title,
          description: s.description,
          icon: s.icon,
          category: s.category,
          badge: s.badge,
          bookable: s.bookable,
          sort_order: s.sort_order,
          active: s.active,
          kind: s.kind,
        });
        if (s.kind === "pakket") result = await updatePackageContent(api, s.id, contents[s.id] ?? []);
        return result;
      },
      { success: "Opgeslagen", onStale: load },
    );
    if (saved) {
      setItems((list) => list.map((x) => (x.id === saved.id ? toServiceItem(saved) : x)));
      setContents((c) => ({ ...c, [saved.id]: [...saved.included_service_ids] }));
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Verwijderen?")) return;
    const done = await mutate((api) => deleteAdminService(api, id).then(() => true), {
      success: "Verwijderd",
      onStale: load,
    });
    if (done) load();
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
