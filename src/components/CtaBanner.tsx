import { Link } from "@tanstack/react-router";
import { Calendar, Phone } from "lucide-react";
import { SITE } from "@/lib/site";
import { Button } from "./ui/button";

export function CtaBanner() {
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-hero p-10 sm:p-14 text-center shadow-elegant">
          <div className="absolute inset-0 opacity-30">
            <div className="absolute -top-20 -right-20 h-72 w-72 rounded-full bg-primary blur-3xl" />
            <div className="absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-primary-glow blur-3xl" />
          </div>
          <div className="relative">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-primary-foreground">
              Klaar om uw wagen te laten stralen?
            </h2>
            <p className="mt-4 text-primary-foreground/80 max-w-xl mx-auto">
              Reserveer vandaag online of bel ons rechtstreeks — wij staan voor u klaar.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" className="bg-background text-foreground hover:bg-background/90 h-12 px-6">
                <Link to="/reservatie">
                  <Calendar className="h-4 w-4" /> Online reserveren
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 h-12 px-6">
                <a href={`tel:${SITE.phoneE164}`}>
                  <Phone className="h-4 w-4" /> {SITE.phone}
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
