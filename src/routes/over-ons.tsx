import { createFileRoute } from "@tanstack/react-router";
import { Award, Heart, Sparkles, ShieldCheck } from "lucide-react";
import { SiteLayout } from "@/components/SiteLayout";
import { CtaBanner } from "@/components/CtaBanner";

export const Route = createFileRoute("/over-ons")({
  head: () => ({
    meta: [
      { title: "Over ons — Autowascenter Sint-Niklaas" },
      { name: "description", content: "Leer Autowascenter kennen: vakmanschap, premium producten en passie voor elke wagen." },
      { property: "og:title", content: "Over Autowascenter" },
      { property: "og:description", content: "Premium auto detailing met passie en vakmanschap." },
    ],
  }),
  component: AboutPage,
});

const VALUES = [
  { icon: Sparkles, title: "Passie", text: "Elke wagen krijgt onze volle aandacht alsof het onze eigen is." },
  { icon: Award, title: "Vakmanschap", text: "Jarenlange ervaring en opleiding in premium detailing technieken." },
  { icon: ShieldCheck, title: "Kwaliteit", text: "Wij werken enkel met topproducten van bewezen kwaliteit." },
  { icon: Heart, title: "Service", text: "Persoonlijk advies en eerlijke communicatie staan centraal." },
];

function AboutPage() {
  return (
    <SiteLayout>
      <section className="bg-gradient-subtle border-b border-border">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16 sm:py-24 text-center">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider">Over ons</p>
          <h1 className="mt-2 text-4xl sm:text-5xl font-bold tracking-tight">
            Vakmanschap met <span className="text-gradient-primary">karakter</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            Autowascenter is uw vertrouwde detailingpartner in Sint-Niklaas. Wij geloven
            dat elke wagen — of het nu een dagelijkse stadsauto is of een liefdevol
            onderhouden klassieker — de beste zorg verdient. Met premium producten,
            jaren ervaring en een gezonde dosis perfectionisme zorgen we dat uw wagen
            er weer als nieuw uitziet.
          </p>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map((v) => (
              <div key={v.title} className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                <div className="h-11 w-11 rounded-xl bg-accent text-primary flex items-center justify-center">
                  <v.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-semibold text-lg">{v.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{v.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaBanner />
    </SiteLayout>
  );
}
