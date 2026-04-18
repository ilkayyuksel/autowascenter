import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Star, Check, X, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type Review = {
  id: string;
  customer_name: string;
  rating: number;
  content: string;
  approved: boolean;
  created_at: string;
};

export const Route = createFileRoute("/admin/reviews")({
  component: ReviewsAdmin,
});

function ReviewsAdmin() {
  const [items, setItems] = useState<Review[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ customer_name: "", rating: 5, content: "" });

  const load = async () => {
    const { data } = await supabase.from("reviews").select("*").order("created_at", { ascending: false });
    setItems((data as Review[]) ?? []);
  };

  useEffect(() => { load(); }, []);

  const setApproved = async (id: string, approved: boolean) => {
    const { error } = await supabase.from("reviews").update({ approved }).eq("id", id);
    if (error) return toast.error("Update mislukt");
    setItems(items.map((r) => (r.id === id ? { ...r, approved } : r)));
  };

  const remove = async (id: string) => {
    if (!confirm("Verwijderen?")) return;
    const { error } = await supabase.from("reviews").delete().eq("id", id);
    if (error) return toast.error("Verwijderen mislukt");
    setItems(items.filter((r) => r.id !== id));
  };

  const create = async () => {
    if (!draft.customer_name || !draft.content) return toast.error("Vul alle velden in");
    const { data, error } = await supabase
      .from("reviews")
      .insert({ ...draft, approved: true })
      .select()
      .single();
    if (error) return toast.error("Aanmaken mislukt");
    if (data) setItems([data as Review, ...items]);
    setDraft({ customer_name: "", rating: 5, content: "" });
    setShowForm(false);
    toast.success("Review toegevoegd");
  };

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Reviews</h1>
          <p className="mt-2 text-muted-foreground">Beheer en keur reviews goed.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="bg-gradient-primary">
          <Plus className="h-4 w-4" /> Review toevoegen
        </Button>
      </div>

      {showForm && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-soft space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Naam klant</Label>
              <Input value={draft.customer_name} onChange={(e) => setDraft({ ...draft, customer_name: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>Rating (1-5)</Label>
              <Input type="number" min={1} max={5} value={draft.rating} onChange={(e) => setDraft({ ...draft, rating: Number(e.target.value) })} className="mt-1.5" />
            </div>
          </div>
          <div>
            <Label>Tekst</Label>
            <Textarea rows={3} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} className="mt-1.5" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowForm(false)}>Annuleer</Button>
            <Button onClick={create}>Aanmaken</Button>
          </div>
        </div>
      )}

      <div className="mt-8 space-y-3">
        {items.map((r) => (
          <div key={r.id} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold">{r.customer_name}</h3>
                  <div className="flex">
                    {[...Array(r.rating)].map((_, i) => (
                      <Star key={i} className="h-4 w-4 fill-primary text-primary" />
                    ))}
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                    r.approved
                      ? "bg-[oklch(0.7_0.17_155)]/10 text-[oklch(0.5_0.17_155)] border-[oklch(0.7_0.17_155)]/20"
                      : "bg-muted text-muted-foreground border-border"
                  }`}>
                    {r.approved ? "Zichtbaar" : "Wachtend"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-foreground/80 leading-relaxed">"{r.content}"</p>
              </div>
              <div className="flex gap-2">
                {r.approved ? (
                  <Button variant="ghost" size="sm" onClick={() => setApproved(r.id, false)}>
                    <X className="h-4 w-4" /> Verbergen
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setApproved(r.id, true)} className="bg-gradient-primary">
                    <Check className="h-4 w-4" /> Goedkeuren
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => remove(r.id)} className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            Nog geen reviews.
          </div>
        )}
      </div>
    </div>
  );
}
