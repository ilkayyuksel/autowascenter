import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Upload, Trash2 } from "lucide-react";
// Reads, metadata writes and image uploads through the API; the server stores the files
// (self-hosted storage) and deletes a managed file together with its item.
import { useAdminLoad } from "@/hooks/useAdminLoad";
import { useAdminMutation } from "@/hooks/useAdminMutation";
import { AdminLoadError } from "@/components/admin/AdminLoadError";
import { loadGallery, toGalleryItem, type GalleryItem } from "@/lib/api/admin-reads";
import {
  deleteGalleryItem,
  updateGalleryItem,
  uploadGalleryImage,
  UPLOAD_TYPES,
} from "@/lib/api/admin-writes";
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

  const { mutate } = useAdminMutation();

  // POST /api/admin/gallery/upload (multipart): the server checks type and size, stores the
  // file and creates the item; the response (with the new image_url) is shown directly.
  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    const created = await mutate((api) => uploadGalleryImage(api, file), {
      success: "Afbeelding toegevoegd",
    });
    setUploading(false);
    input.value = "";
    if (created) setItems((arr) => [...arr, toGalleryItem(created)]);
  };

  const updateField = (id: string, patch: Partial<Item>) =>
    setItems((arr) => arr.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const save = async (it: Item) => {
    const saved = await mutate(
      (api) =>
        updateGalleryItem(api, it.id, {
          title: it.title,
          description: it.description,
          sort_order: it.sort_order,
        }),
      { success: "Opgeslagen", onStale: load },
    );
    if (saved) setItems((arr) => arr.map((x) => (x.id === saved.id ? toGalleryItem(saved) : x)));
  };

  // DELETE /api/admin/gallery/:id: the server removes the item and, only if it manages the
  // file itself, the stored image. The browser never handles file names or storage paths.
  const remove = async (it: Item) => {
    if (!confirm("Afbeelding verwijderen?")) return;
    const done = await mutate((api) => deleteGalleryItem(api, it.id).then(() => true), {
      success: "Verwijderd",
      onStale: load,
    });
    if (done) load();
  };

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Galerij</h1>
          <p className="mt-2 text-muted-foreground">Upload en beheer realisaties.</p>
        </div>
        <label>
          <input type="file" accept={UPLOAD_TYPES.join(",")} onChange={handleUpload} className="hidden" disabled={uploading} />
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
