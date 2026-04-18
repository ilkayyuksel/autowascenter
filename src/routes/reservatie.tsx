import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Calendar } from "lucide-react";
import { toast } from "sonner";
import { SiteLayout } from "@/components/SiteLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const TIME_SLOTS = [
  "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00",
];

const schema = z.object({
  customer_name: z.string().trim().min(2, "Naam is verplicht").max(100),
  customer_email: z.string().trim().email("Ongeldig e-mailadres").max(255),
  customer_phone: z.string().trim().min(6, "Telefoonnummer is verplicht").max(30),
  vehicle_info: z.string().trim().max(200).optional().or(z.literal("")),
  service_id: z.string().min(1, "Kies een dienst"),
  preferred_date: z.string().min(1, "Kies een datum"),
  preferred_time: z.string().min(1, "Kies een tijdstip"),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

type FormData = z.infer<typeof schema>;

type Service = { id: string; title: string; price: number | null };

export const Route = createFileRoute("/reservatie")({
  head: () => ({
    meta: [
      { title: "Reserveer nu — Autowascenter" },
      { name: "description", content: "Reserveer eenvoudig online uw afspraak bij Autowascenter in Sint-Niklaas." },
      { property: "og:title", content: "Reserveer een afspraak — Autowascenter" },
      { property: "og:description", content: "Boek online uw detailing afspraak." },
    ],
  }),
  component: BookingPage,
});

function BookingPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
    setValue,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      customer_name: "", customer_email: "", customer_phone: "",
      vehicle_info: "", service_id: "", preferred_date: "", preferred_time: "", notes: "",
    },
  });

  useEffect(() => {
    supabase
      .from("services")
      .select("id,title,price")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => data && setServices(data));
  }, []);

  const selectedService = watch("service_id");
  const selectedTime = watch("preferred_time");

  const today = new Date().toISOString().split("T")[0];

  const onSubmit = async (data: FormData) => {
    const service = services.find((s) => s.id === data.service_id);
    const { error } = await supabase.from("bookings").insert({
      customer_name: data.customer_name,
      customer_email: data.customer_email,
      customer_phone: data.customer_phone,
      vehicle_info: data.vehicle_info || null,
      service_id: data.service_id,
      service_title: service?.title ?? null,
      preferred_date: data.preferred_date,
      preferred_time: data.preferred_time,
      notes: data.notes || null,
    });

    if (error) {
      toast.error("Er ging iets mis. Probeer opnieuw of bel ons.");
      return;
    }
    toast.success("Reservatie verstuurd! We nemen snel contact op.");
    setSuccess(true);
    reset();
  };

  return (
    <SiteLayout>
      <section className="bg-gradient-subtle border-b border-border">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20 text-center">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider">Reservatie</p>
          <h1 className="mt-2 text-4xl sm:text-5xl font-bold tracking-tight">Maak een afspraak</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Vul het formulier in — wij bevestigen uw afspraak telefonisch of per e-mail.
          </p>
        </div>
      </section>

      <section className="py-12 sm:py-16">
        <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8">
          {success ? (
            <div className="rounded-3xl border border-border bg-card p-10 text-center shadow-elegant">
              <div className="mx-auto h-16 w-16 rounded-full bg-accent flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-primary" />
              </div>
              <h2 className="mt-6 text-2xl font-bold">Bedankt voor uw reservatie!</h2>
              <p className="mt-3 text-muted-foreground">
                We hebben uw aanvraag ontvangen en nemen binnenkort contact op om
                de afspraak te bevestigen.
              </p>
              <Button onClick={() => setSuccess(false)} className="mt-6 bg-gradient-primary">
                Nieuwe reservatie
              </Button>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="rounded-3xl border border-border bg-card p-6 sm:p-8 shadow-elegant space-y-5"
            >
              <div>
                <Label>Dienst *</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {services.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setValue("service_id", s.id, { shouldValidate: true })}
                      className={`text-left p-3 rounded-xl border-2 transition-all ${
                        selectedService === s.id
                          ? "border-primary bg-accent"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      <div className="font-medium text-sm">{s.title}</div>
                      {s.price != null && (
                        <div className="text-xs text-muted-foreground mt-0.5">€{Number(s.price).toFixed(0)}</div>
                      )}
                    </button>
                  ))}
                </div>
                {errors.service_id && <p className="text-xs text-destructive mt-1">{errors.service_id.message}</p>}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="preferred_date">Datum *</Label>
                  <Input id="preferred_date" type="date" min={today} {...register("preferred_date")} className="mt-1.5" />
                  {errors.preferred_date && <p className="text-xs text-destructive mt-1">{errors.preferred_date.message}</p>}
                </div>
                <div>
                  <Label>Tijdstip *</Label>
                  <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                    {TIME_SLOTS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setValue("preferred_time", t, { shouldValidate: true })}
                        className={`py-2 text-xs rounded-lg border-2 font-medium transition-all ${
                          selectedTime === t
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  {errors.preferred_time && <p className="text-xs text-destructive mt-1">{errors.preferred_time.message}</p>}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="customer_name">Naam *</Label>
                  <Input id="customer_name" {...register("customer_name")} className="mt-1.5" />
                  {errors.customer_name && <p className="text-xs text-destructive mt-1">{errors.customer_name.message}</p>}
                </div>
                <div>
                  <Label htmlFor="customer_phone">Telefoon *</Label>
                  <Input id="customer_phone" {...register("customer_phone")} className="mt-1.5" />
                  {errors.customer_phone && <p className="text-xs text-destructive mt-1">{errors.customer_phone.message}</p>}
                </div>
              </div>

              <div>
                <Label htmlFor="customer_email">E-mail *</Label>
                <Input id="customer_email" type="email" {...register("customer_email")} className="mt-1.5" />
                {errors.customer_email && <p className="text-xs text-destructive mt-1">{errors.customer_email.message}</p>}
              </div>

              <div>
                <Label htmlFor="vehicle_info">Wagen (merk, model, kleur)</Label>
                <Input id="vehicle_info" placeholder="Bv. BMW 3-Reeks zwart" {...register("vehicle_info")} className="mt-1.5" />
              </div>

              <div>
                <Label htmlFor="notes">Opmerkingen</Label>
                <Textarea id="notes" rows={3} {...register("notes")} className="mt-1.5" />
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-gradient-primary shadow-elegant hover:shadow-glow h-12 text-base"
              >
                <Calendar className="h-4 w-4" />
                {isSubmitting ? "Versturen..." : "Reservatie versturen"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Geen aanbetaling vereist — wij bevestigen uw afspraak persoonlijk.
              </p>
            </form>
          )}
        </div>
      </section>
    </SiteLayout>
  );
}
