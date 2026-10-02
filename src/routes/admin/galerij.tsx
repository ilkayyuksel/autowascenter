import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
// WRITE side (upload, save, delete) still uses Supabase until phase 6D-3.
import { supabase } from "@/integrations/supabase/client";
import { useAdminLoad } from "@/hooks/useAdminLoad";
import { AdminLoadError } from "@/components/admin/AdminLoadError";
import { loadGallery, type GalleryItem } from "@/lib/api/admin-reads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// READ model from GET /api/admin/gallery (ordered by sort_order).
type Item = GalleryItem;

export const Route = createFileRoute("/admin/galerij")({
  component: GalleryAdmin,
});

function GalleryAdmin() {
  const [items, setItems] = useState<Item[]>([]);
  const [uploading, setUploading] = useState(false);

  const { api, state, run } = useAdminLoad();

  const load = useCallback(
    () => run((signal) => loadGallery(api, { signal }), setItems),
    [api, run],
  );

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const filename = `${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("gallery").upload(filename, file);
    if (upErr) {
      setUploading(false);
      return toast.error("Upload mislukt: " + upErr.message);
    }
    const { data: urlData } = supabase.storage.from("gallery").getPublicUrl(filename);
    const { data, error } = await supabase
      .from("gallery_items")
      .insert({ image_url: urlData.publicUrl, sort_order: items.length })
      .select()
      .single();
    setUploading(false);
    if (error) return toast.error("Opslaan mislukt");
    if (data) setItems([...items, data as Item]);
    toast.success("Afbeelding toegevoegd");
    e.target.value = "";
  };

  const updateField = (id: string, patch: Partial<Item>) =>
    setItems((arr) => arr.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const save = async (it: Item) => {
    const { error } = await supabase.from("gallery_items").update({
      title: it.title, description: it.description, sort_order: it.sort_order,
    }).eq("id", it.id);
    if (error) return toast.error("Opslaan mislukt");
    toast.success("Opgeslagen");
  };

  const remove = async (it: Item) => {
    if (!confirm("Afbeelding verwijderen?")) return;
    // Try to remove from storage too (extract filename)
    const filename = it.image_url.split("/").pop();
    if (filename) await supabase.storage.from("gallery").remove([filename]);
    const { error } = await supabase.from("gallery_items").delete().eq("id", it.id);
    if (error) return toast.error("Verwijderen mislukt");
    setItems((arr) => arr.filter((x) => x.id !== it.id));
  };

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Galerij</h1>
          <p className="mt-2 text-muted-foreground">Upload en beheer realisaties.</p>
        </div>
        <label>
          <input type="file" accept="image/*" onChange={handleUpload} className="hidden" disabled={uploading} />
          <Button asChild className="bg-gradient-primary cursor-pointer">
            <span><Upload className="h-4 w-4" /> {uploading ? "Bezig..." : "Afbeelding toevoegen"}</span>
          </Button>
        </label>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div key={it.id} className="rounded-2xl border border-border bg-card overflow-hidden shadow-soft">
            <img src={it.image_url} alt={it.title ?? ""} className="w-full aspect-[4/3] object-cover" />
            <div className="p-4 space-y-3">
              <div>
                <Label>Titel</Label>
                <Input value={it.title ?? ""} onChange={(e) => updateField(it.id, { title: e.target.value })} className="mt-1.5" />
              </div>
              <div>
                <Label>Beschrijving</Label>
                <Input value={it.description ?? ""} onChange={(e) => updateField(it.id, { description: e.target.value })} className="mt-1.5" />
              </div>
              <div>
                <Label>Volgorde</Label>
                <Input type="number" value={it.sort_order} onChange={(e) => updateField(it.id, { sort_order: Number(e.target.value) })} className="mt-1.5" />
              </div>
              <div className="flex justify-between gap-2">
                <Button variant="ghost" size="sm" onClick={() => remove(it)} className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button size="sm" onClick={() => save(it)}>Opslaan</Button>
              </div>
            </div>
          </div>
        ))}
        {state.status === "loading" && items.length === 0 && (
          <div className="md:col-span-2 lg:col-span-3 text-sm text-muted-foreground">Laden...</div>
        )}
        {state.status === "error" && (
          <div className="md:col-span-2 lg:col-span-3">
            <AdminLoadError error={state.error} onRetry={load} />
          </div>
        )}
        {state.status === "success" && items.length === 0 && (
          <div className="md:col-span-2 lg:col-span-3 rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            Nog geen afbeeldingen. Upload je eerste foto!
          </div>
        )}
      </div>
    </div>
  );
}
