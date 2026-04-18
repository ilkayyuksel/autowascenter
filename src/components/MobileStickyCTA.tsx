import { Link } from "@tanstack/react-router";
import { Calendar, Phone } from "lucide-react";
import { SITE } from "@/lib/site";

export function MobileStickyCTA() {
  return (
    <div className="sm:hidden fixed bottom-0 inset-x-0 z-30 p-3 bg-background/95 backdrop-blur-lg border-t border-border shadow-elegant">
      <div className="flex gap-2">
        <a
          href={`tel:${SITE.phoneE164}`}
          className="flex-1 h-12 rounded-xl border border-border flex items-center justify-center gap-2 font-medium text-sm hover:bg-muted"
          aria-label="Bellen"
        >
          <Phone className="h-4 w-4" /> Bellen
        </a>
        <Link
          to="/reservatie"
          className="flex-[2] h-12 rounded-xl bg-gradient-primary text-primary-foreground flex items-center justify-center gap-2 font-semibold text-sm shadow-elegant"
        >
          <Calendar className="h-4 w-4" /> Reserveer nu
        </Link>
      </div>
    </div>
  );
}
