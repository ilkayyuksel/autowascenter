import { Award, Sparkles, Clock, MapPin } from "lucide-react";

const ITEMS = [
  {
    icon: Award,
    title: "Professionele aanpak",
    text: "Vakkundig team met jaren ervaring in premium auto detailing.",
  },
  {
    icon: Sparkles,
    title: "Kwalitatieve producten",
    text: "Wij gebruiken enkel topmerken voor blijvend resultaat.",
  },
  {
    icon: Clock,
    title: "Flexibele service",
    text: "Snel binnenstappen of vooraf reserveren — u kiest.",
  },
  {
    icon: MapPin,
    title: "Ook op locatie",
    text: "Bij u thuis of op kantoor, op afspraak mogelijk.",
  },
];

export function Highlights() {
  return (
    <section className="py-16 sm:py-20 bg-gradient-subtle border-y border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-10">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider">Waarom Autowascenter</p>
          <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">
            Vakmanschap waar u op kan rekenen
          </h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl bg-card border border-border p-6 shadow-soft hover:shadow-elegant hover:border-primary/30 transition-all"
            >
              <div className="h-11 w-11 rounded-xl bg-gradient-primary text-primary-foreground flex items-center justify-center shadow-elegant">
                <item.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-semibold text-lg">{item.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{item.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
