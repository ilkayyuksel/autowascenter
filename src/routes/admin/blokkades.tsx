import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, CalendarX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/admin/blokkades")({
  component: AdminBlockedPage,
});

type BlockedPeriod = {
  id: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
};

function AdminBlockedPage() {
  const [periods, setPeriods] = useState<BlockedPeriod[]>([]);
  const [form, setForm] = useState({
    start_date: "",
    end_date: "",
    start_time: "",
    end_time: "",
    reason: "",
  });

  const refresh = async () => {
    const { data } = await supabase
      .from("blocked_periods")
      .select("*")
      .order("start_date", { ascending: false });
    if (data) setPeriods(data as BlockedPeriod[]);
  };

  useEffect(() => {
    refresh();
  }, []);

  const add = async () => {
    if (!form.start_date || !form.end_date) {
      toast.error("Vul start- en einddatum in");
      return;
    }
    const { error } = await supabase.from("blocked_periods").insert({
      start_date: form.start_date,
      end_date: form.end_date,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      reason: form.reason || null,
    });
    if (error) return toast.error(error.message);
    setForm({ start_date: "", end_date: "", start_time: "", end_time: "", reason: "" });
    toast.success("Toegevoegd");
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("Verwijderen?")) return;
    await supabase.from("blocked_periods").delete().eq("id", id);
    refresh();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Geblokkeerde periodes</h1>

      <div className="rounded-2xl border border-border bg-card p-5 mb-6">
        <h2 className="font-semibold mb-4">Nieuwe blokkade</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label>Vanaf datum</Label>
            <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </div>
          <div>
            <Label>Tot datum</Label>
            <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </div>
          <div>
            <Label>Vanaf uur (optioneel)</Label>
            <Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          </div>
          <div>
            <Label>Tot uur (optioneel)</Label>
            <Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
          </div>
          <div>
            <Label>Reden</Label>
            <Input placeholder="Vakantie, ..." value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
        </div>
        <Button onClick={add} className="mt-4 bg-gradient-primary">
          <Plus className="h-4 w-4" /> Toevoegen
        </Button>
      </div>

      <div className="space-y-2">
        {periods.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Geen geblokkeerde periodes.</p>
        ) : (
          periods.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <CalendarX className="h-5 w-5 text-destructive" />
                <div>
                  <div className="font-semibold text-sm">
                    {p.start_date === p.end_date ? p.start_date : `${p.start_date} → ${p.end_date}`}
                    {p.start_time && p.end_time && ` (${p.start_time} - ${p.end_time})`}
                  </div>
                  {p.reason && <div className="text-xs text-muted-foreground">{p.reason}</div>}
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => remove(p.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
