import { createFileRoute, Link } from "@tanstack/react-router";
import { Award, Heart, Sparkles, ShieldCheck, MapPin, Clock, ArrowRight } from "lucide-react";
import { SiteLayout } from "@/components/SiteLayout";
import { CtaBanner } from "@/components/CtaBanner";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/site";
import heroImg from "@/assets/hero-car.jpg";
import gallery2 from "@/assets/gallery-2.jpg";

export const Route = createFileRoute("/over-ons")({
  head: () => ({
    meta: [
      { title: "Over ons — Autowascenter Sint-Niklaas" },
      { name: "description", content: "Leer Autowascenter kennen: vakmanschap, premium producten en passie voor elke wagen in Sint-Niklaas." },
      { property: "og:title", content: "Over Autowascenter" },
      { property: "og:description", content: "Premium auto detailing met passie en vakmanschap." },
      { property: "og:image", content: heroImg },
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

const APPROACH = [
  { step: "01", title: "Inspectie", text: "We bekijken samen de wagen en bespreken uw verwachtingen." },
  { step: "02", title: "Behandeling", text: "Met de juiste producten en technieken pakken we elk detail aan." },
  { step: "03", title: "Eindcontrole", text: "Niets verlaat onze studio zonder grondige kwaliteitscontrole." },
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
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 grid gap-10 lg:grid-cols-2 items-center">
          <div className="rounded-3xl overflow-hidden shadow-elegant">
            <img src={gallery2} alt="Autowascenter studio" className="w-full h-full object-cover aspect-[4/3]" loading="lazy" />
          </div>
          <div>
            <p className="text-sm font-semibold text-primary uppercase tracking-wider">Onze filosofie</p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">
              Zorg voor wagens, vertrouwen van klanten
            </h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Detailing is voor ons meer dan een wasbeurt. Het is de tijd nemen om
              de lak, het interieur en zelfs de kleinste hoekjes met respect te
              behandelen. Dankzij die aanpak komen onze klanten al jarenlang terug —
              en sturen ze hun vrienden, familie en collega's onze richting uit.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              <li className="flex items-start gap-3"><ShieldCheck className="h-5 w-5 text-primary flex-shrink-0" /> 100% handwerk, geen automatische roller</li>
              <li className="flex items-start gap-3"><ShieldCheck className="h-5 w-5 text-primary flex-shrink-0" /> Premium producten en microvezels</li>
              <li className="flex items-start gap-3"><ShieldCheck className="h-5 w-5 text-primary flex-shrink-0" /> Persoonlijk advies, geen verrassingen</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20 bg-gradient-subtle border-y border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-10">
            <p className="text-sm font-semibold text-primary uppercase tracking-wider">Onze waarden</p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">Waar we elke dag voor staan</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map((v) => (
              <div key={v.title} className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                <div className="h-11 w-11 rounded-xl bg-gradient-primary text-primary-foreground flex items-center justify-center shadow-elegant">
                  <v.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-semibold text-lg">{v.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{v.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-10">
            <p className="text-sm font-semibold text-primary uppercase tracking-wider">Onze aanpak</p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">Hoe we te werk gaan</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {APPROACH.map((a) => (
              <div key={a.step} className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                <div className="text-4xl font-bold text-gradient-primary">{a.step}</div>
                <h3 className="mt-3 font-semibold text-lg">{a.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{a.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20 bg-gradient-subtle border-t border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 grid gap-8 lg:grid-cols-2 items-center">
          <div>
            <p className="text-sm font-semibold text-primary uppercase tracking-wider">Bedrijfslocatie</p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">Bezoek onze studio</h2>
            <p className="mt-4 text-muted-foreground">
              Gemakkelijk bereikbaar in het hart van Sint-Niklaas. Kom langs voor een
              vrijblijvend advies of een snelle wasbeurt.
            </p>
            <div className="mt-6 space-y-3">
              <div className="flex items-start gap-3"><MapPin className="h-5 w-5 text-primary mt-0.5" /><span>{SITE.address}</span></div>
              <div className="flex items-start gap-3"><Clock className="h-5 w-5 text-primary mt-0.5" /><span>Ma–Vr 09:00–18:00 · Za 09:00–17:00</span></div>
            </div>
            <Button asChild className="mt-6 bg-gradient-primary">
              <Link to="/contact">Contacteer ons <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
          <div className="rounded-2xl overflow-hidden border border-border shadow-soft min-h-[320px]">
            <iframe
              title="Autowascenter locatie"
              src="https://www.google.com/maps?q=Raapstraat+34+9100+Sint-Niklaas&output=embed"
              className="w-full h-full min-h-[320px]"
              loading="lazy"
            />
          </div>
        </div>
      </section>

      <CtaBanner />
    </SiteLayout>
  );
}
