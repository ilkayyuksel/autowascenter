import { createFileRoute } from "@tanstack/react-router";
import { MapPin, Phone, Mail, Clock, MessageCircle } from "lucide-react";
import { SiteLayout } from "@/components/SiteLayout";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — Autowascenter Sint-Niklaas" },
      { name: "description", content: `Contacteer Autowascenter: ${SITE.address}. Bel ${SITE.phone} of mail ${SITE.email}.` },
      { property: "og:title", content: "Contact — Autowascenter" },
      { property: "og:description", content: "Neem contact op met Autowascenter in Sint-Niklaas." },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <SiteLayout>
      <section className="bg-gradient-subtle border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider">Contact</p>
          <h1 className="mt-2 text-4xl sm:text-5xl font-bold tracking-tight">Kom langs of bel ons</h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
            Heeft u een vraag of wenst u een persoonlijk advies? Wij staan voor u klaar.
          </p>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 grid gap-8 lg:grid-cols-2">
          <div className="space-y-4">
            <a href={SITE.mapsUrl} target="_blank" rel="noopener noreferrer" className="flex items-start gap-4 p-5 rounded-2xl border border-border bg-card shadow-soft hover:shadow-elegant hover:border-primary/30 transition-all">
              <div className="h-11 w-11 rounded-xl bg-accent text-primary flex items-center justify-center flex-shrink-0">
                <MapPin className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold">Adres</h3>
                <p className="text-sm text-muted-foreground mt-1">{SITE.address}</p>
                <p className="text-xs text-primary mt-2 font-medium">Open in Google Maps →</p>
              </div>
            </a>

            <a href={`tel:${SITE.phoneE164}`} className="flex items-start gap-4 p-5 rounded-2xl border border-border bg-card shadow-soft hover:shadow-elegant hover:border-primary/30 transition-all">
              <div className="h-11 w-11 rounded-xl bg-accent text-primary flex items-center justify-center flex-shrink-0">
                <Phone className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold">Telefoon</h3>
                <p className="text-sm text-muted-foreground mt-1">{SITE.phone}</p>
              </div>
            </a>

            <a href={`https://wa.me/${SITE.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="flex items-start gap-4 p-5 rounded-2xl border border-border bg-card shadow-soft hover:shadow-elegant hover:border-primary/30 transition-all">
              <div className="h-11 w-11 rounded-xl bg-accent text-primary flex items-center justify-center flex-shrink-0">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold">WhatsApp</h3>
                <p className="text-sm text-muted-foreground mt-1">Snel contact via WhatsApp</p>
              </div>
            </a>

            <a href={`mailto:${SITE.email}`} className="flex items-start gap-4 p-5 rounded-2xl border border-border bg-card shadow-soft hover:shadow-elegant hover:border-primary/30 transition-all">
              <div className="h-11 w-11 rounded-xl bg-accent text-primary flex items-center justify-center flex-shrink-0">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold">E-mail</h3>
                <p className="text-sm text-muted-foreground mt-1">{SITE.email}</p>
              </div>
            </a>

            <div className="flex items-start gap-4 p-5 rounded-2xl border border-border bg-card shadow-soft">
              <div className="h-11 w-11 rounded-xl bg-accent text-primary flex items-center justify-center flex-shrink-0">
                <Clock className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold">Openingsuren</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {SITE.hours.map((h) => (
                    <li key={h.day} className="flex justify-between">
                      <span className="text-muted-foreground">{h.day}</span>
                      <span className="font-medium">{h.time}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="rounded-2xl overflow-hidden border border-border shadow-soft min-h-[400px] lg:min-h-full">
            <iframe
              title="Autowascenter locatie"
              src="https://www.google.com/maps?q=Raapstraat+34+9100+Sint-Niklaas&output=embed"
              className="w-full h-full min-h-[400px]"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
