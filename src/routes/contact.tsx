import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MapPin, Phone, Mail, Clock, MessageCircle, Send, Home, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { SiteLayout } from "@/components/SiteLayout";
import { SITE } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

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

const schema = z.object({
  name: z.string().trim().min(2, "Naam is verplicht").max(100),
  email: z.string().trim().email("Ongeldig e-mailadres").max(255),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  message: z.string().trim().min(5, "Bericht is te kort").max(1500),
});

type FormData = z.infer<typeof schema>;

function ContactPage() {
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", phone: "", message: "" },
  });

  const onSubmit = async (_data: FormData) => {
    // Voorlopig: simuleer verzending. Later koppelen aan edge function.
    await new Promise((r) => setTimeout(r, 600));
    toast.success("Bericht verstuurd! We nemen snel contact op.");
    setSent(true);
    reset();
  };

  return (
    <SiteLayout>
      <section className="bg-gradient-subtle border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider">Contact</p>
          <h1 className="mt-2 text-4xl sm:text-5xl font-bold tracking-tight">Kom langs of bel ons</h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
            Heeft u een vraag of wenst u een persoonlijk advies? Wij staan voor u klaar.
            Wij komen ook op locatie — bij u thuis of op kantoor.
          </p>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 grid gap-8 lg:grid-cols-5">
          <div className="lg:col-span-2 space-y-3">
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

            <div className="flex items-start gap-4 p-5 rounded-2xl border border-primary/30 bg-accent/40">
              <div className="h-11 w-11 rounded-xl bg-gradient-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
                <Home className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold">Detailing op locatie</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Geen tijd om langs te komen? Wij werken ook bij u thuis of op kantoor.
                  Vraag een offerte aan.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-3 space-y-6">
            <div className="rounded-3xl border border-border bg-card p-6 sm:p-8 shadow-elegant">
              <h2 className="text-xl font-bold">Stuur ons een bericht</h2>
              <p className="text-sm text-muted-foreground mt-1">We antwoorden meestal binnen 24 uur.</p>

              {sent ? (
                <div className="mt-6 text-center py-8">
                  <div className="mx-auto h-14 w-14 rounded-full bg-accent flex items-center justify-center">
                    <CheckCircle2 className="h-7 w-7 text-primary" />
                  </div>
                  <p className="mt-4 font-semibold">Bedankt voor uw bericht!</p>
                  <p className="text-sm text-muted-foreground mt-1">We nemen snel contact met u op.</p>
                  <Button onClick={() => setSent(false)} variant="outline" className="mt-4">Nieuw bericht</Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="name">Naam *</Label>
                      <Input id="name" {...register("name")} className="mt-1.5" />
                      {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
                    </div>
                    <div>
                      <Label htmlFor="phone">Telefoon</Label>
                      <Input id="phone" {...register("phone")} className="mt-1.5" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="email">E-mail *</Label>
                    <Input id="email" type="email" {...register("email")} className="mt-1.5" />
                    {errors.email && <p className="text-xs text-destructive mt-1">{errors.email.message}</p>}
                  </div>
                  <div>
                    <Label htmlFor="message">Uw bericht *</Label>
                    <Textarea id="message" rows={5} {...register("message")} className="mt-1.5" />
                    {errors.message && <p className="text-xs text-destructive mt-1">{errors.message.message}</p>}
                  </div>
                  <Button type="submit" disabled={isSubmitting} className="w-full bg-gradient-primary h-12 text-base shadow-elegant">
                    <Send className="h-4 w-4" />
                    {isSubmitting ? "Versturen..." : "Bericht versturen"}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    Liever direct boeken? <a href="/reservatie" className="text-primary font-medium underline-offset-4 hover:underline">Maak een reservatie</a>.
                  </p>
                </form>
              )}
            </div>

            <div className="rounded-2xl overflow-hidden border border-border shadow-soft min-h-[320px]">
              <iframe
                title="Autowascenter locatie"
                src="https://www.google.com/maps?q=Raapstraat+34+9100+Sint-Niklaas&output=embed"
                className="w-full h-full min-h-[320px]"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
