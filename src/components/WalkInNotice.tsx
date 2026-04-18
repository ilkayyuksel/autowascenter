import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";

const STORAGE_KEY = "awc-walkin-dismissed";

export function WalkInNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = sessionStorage.getItem(STORAGE_KEY);
    if (dismissed) return;
    const t = setTimeout(() => setOpen(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    setOpen(false);
    if (typeof window !== "undefined") sessionStorage.setItem(STORAGE_KEY, "1");
  };

  if (!open) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 sm:bottom-6 left-4 right-4 sm:left-6 sm:right-auto sm:max-w-sm z-40 animate-in slide-in-from-bottom-4 fade-in duration-500"
    >
      <div className="rounded-2xl border border-primary/20 bg-card shadow-elegant p-4 flex gap-3">
        <div className="h-9 w-9 rounded-xl bg-accent text-primary flex items-center justify-center flex-shrink-0">
          <Info className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Geen reservatie nodig?</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            Voor basisbeurten hoef je geen reservatie te maken. Je kan gewoon langskomen
            tijdens onze openingsuren.
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Sluiten"
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
