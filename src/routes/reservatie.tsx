import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Calendar, ArrowRight, ArrowLeft, Info, Check } from "lucide-react";
import { toast } from "sonner";
import { SiteLayout } from "@/components/SiteLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const TIME_SLOTS = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00"];

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
type Service = { id: string; title: string; price: number | null; duration_minutes: number | null; category: string | null };

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

const STEPS = [
  { id: 1, label: "Dienst" },
  { id: 2, label: "Datum & uur" },
  { id: 3, label: "Gegevens" },
  { id: 4, label: "Bevestigen" },
];

function BookingPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [step, setStep] = useState(1);
  const [success, setSuccess] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting }, reset, watch, setValue, trigger } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      customer_name: "", customer_email: "", customer_phone: "",
      vehicle_info: "", service_id: "", preferred_date: "", preferred_time: "", notes: "",
    },
  });

  useEffect(() => {
    supabase
      .from("services")
      .select("id,title,price,duration_minutes,category")
      .eq("active", true)
      .eq("bookable", true)
      .order("sort_order")
      .then(({ data }) => data && setServices(data as Service[]));
  }, []);

  const values = watch();
  const selectedService = services.find((s) => s.id === values.service_id);
  const today = new Date().toISOString().split("T")[0];

  const next = async () => {
    let valid = true;
    if (step === 1) valid = await trigger(["service_id"]);
    if (step === 2) valid = await trigger(["preferred_date", "preferred_time"]);
    if (step === 3) valid = await trigger(["customer_name", "customer_email", "customer_phone"]);
    if (valid) setStep((s) => Math.min(4, s + 1));
  };

  const prev = () => setStep((s) => Math.max(1, s - 1));

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
    setStep(1);
  };

  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

  return (
    <SiteLayout>
      <section className="bg-gradient-subtle border-b border-border">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16 text-center">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider">Reservatie</p>
          <h1 className="mt-2 text-3xl sm:text-5xl font-bold tracking-tight">Maak een afspraak</h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground">
            In een paar klikken geregeld — wij bevestigen uw afspraak persoonlijk.
          </p>
          <div className="mt-5 inline-flex items-start gap-2 px-4 py-2.5 rounded-xl bg-card border border-primary/20 text-left max-w-md">
            <Info className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Voor basisbeurten (express handwas, standaard wasbeurt, velgen) hoef je
              <span className="font-semibold text-foreground"> geen reservatie </span>
              te maken — kom gewoon langs.
            </p>
          </div>
        </div>
      </section>

      <section className="py-10 sm:py-14">
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
            <>
              {/* Progress */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  {STEPS.map((s, i) => (
                    <div key={s.id} className="flex items-center flex-1">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                        step > s.id ? "bg-primary text-primary-foreground" :
                        step === s.id ? "bg-primary text-primary-foreground shadow-elegant scale-110" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {step > s.id ? <Check className="h-4 w-4" /> : s.id}
                      </div>
                      {i < STEPS.length - 1 && (
                        <div className={`h-0.5 flex-1 mx-2 transition-colors ${step > s.id ? "bg-primary" : "bg-muted"}`} />
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-xs">
                  {STEPS.map((s) => (
                    <span key={s.id} className={`${step >= s.id ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                      {s.label}
                    </span>
                  ))}
                </div>
                <div className="mt-3 h-1 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-primary transition-all duration-500" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="rounded-3xl border border-border bg-card p-5 sm:p-8 shadow-elegant">
                {/* Step 1: Service */}
                {step === 1 && (
                  <div className="space-y-4">
                    <h2 className="text-xl font-bold">Welke dienst wenst u?</h2>
                    <p className="text-sm text-muted-foreground">Enkel reserveerbare diensten worden hier getoond.</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {services.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setValue("service_id", s.id, { shouldValidate: true })}
                          className={`text-left p-4 rounded-2xl border-2 transition-all min-h-[88px] ${
                            values.service_id === s.id
                              ? "border-primary bg-accent shadow-elegant"
                              : "border-border hover:border-primary/40"
                          }`}
                        >
                          {s.category && <div className="text-[10px] font-semibold text-primary uppercase tracking-wider">{s.category}</div>}
                          <div className="font-semibold text-sm mt-0.5">{s.title}</div>
                          <div className="mt-1.5 flex items-center justify-between text-xs">
                            {s.price != null && <span className="font-bold text-base">€{Number(s.price).toFixed(0)}</span>}
                            {s.duration_minutes != null && <span className="text-muted-foreground">± {s.duration_minutes} min</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                    {errors.service_id && <p className="text-xs text-destructive">{errors.service_id.message}</p>}
                  </div>
                )}

                {/* Step 2: Date & time */}
                {step === 2 && (
                  <div className="space-y-5">
                    <h2 className="text-xl font-bold">Wanneer past het u?</h2>
                    <div>
                      <Label htmlFor="preferred_date">Datum</Label>
                      <Input id="preferred_date" type="date" min={today} {...register("preferred_date")} className="mt-1.5 h-12 text-base" />
                      {errors.preferred_date && <p className="text-xs text-destructive mt-1">{errors.preferred_date.message}</p>}
                    </div>
                    <div>
                      <Label>Tijdstip</Label>
                      <div className="mt-1.5 grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {TIME_SLOTS.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setValue("preferred_time", t, { shouldValidate: true })}
                            className={`py-3 text-sm rounded-xl border-2 font-semibold transition-all ${
                              values.preferred_time === t
                                ? "border-primary bg-primary text-primary-foreground shadow-elegant"
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
                )}

                {/* Step 3: Contact */}
                {step === 3 && (
                  <div className="space-y-4">
                    <h2 className="text-xl font-bold">Uw gegevens</h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="customer_name">Naam *</Label>
                        <Input id="customer_name" {...register("customer_name")} className="mt-1.5 h-11" />
                        {errors.customer_name && <p className="text-xs text-destructive mt-1">{errors.customer_name.message}</p>}
                      </div>
                      <div>
                        <Label htmlFor="customer_phone">Telefoon *</Label>
                        <Input id="customer_phone" {...register("customer_phone")} className="mt-1.5 h-11" />
                        {errors.customer_phone && <p className="text-xs text-destructive mt-1">{errors.customer_phone.message}</p>}
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="customer_email">E-mail *</Label>
                      <Input id="customer_email" type="email" {...register("customer_email")} className="mt-1.5 h-11" />
                      {errors.customer_email && <p className="text-xs text-destructive mt-1">{errors.customer_email.message}</p>}
                    </div>
                    <div>
                      <Label htmlFor="vehicle_info">Wagen (merk, model, kleur)</Label>
                      <Input id="vehicle_info" placeholder="Bv. BMW 3-Reeks zwart" {...register("vehicle_info")} className="mt-1.5 h-11" />
                    </div>
                    <div>
                      <Label htmlFor="notes">Opmerkingen</Label>
                      <Textarea id="notes" rows={3} {...register("notes")} className="mt-1.5" />
                    </div>
                  </div>
                )}

                {/* Step 4: Review */}
                {step === 4 && (
                  <div className="space-y-4">
                    <h2 className="text-xl font-bold">Controleer uw reservatie</h2>
                    <dl className="rounded-2xl bg-accent/40 p-5 space-y-3 text-sm">
                      <Row label="Dienst" value={selectedService?.title ?? "-"} />
                      <Row label="Prijs" value={selectedService?.price != null ? `€${Number(selectedService.price).toFixed(0)}` : "Op offerte"} />
                      <Row label="Datum" value={values.preferred_date} />
                      <Row label="Tijdstip" value={values.preferred_time} />
                      <Row label="Naam" value={values.customer_name} />
                      <Row label="Telefoon" value={values.customer_phone} />
                      <Row label="E-mail" value={values.customer_email} />
                      {values.vehicle_info && <Row label="Wagen" value={values.vehicle_info} />}
                    </dl>
                    <p className="text-xs text-muted-foreground text-center">
                      Geen aanbetaling vereist — wij bevestigen uw afspraak persoonlijk.
                    </p>
                  </div>
                )}

                {/* Nav buttons */}
                <div className="mt-6 flex gap-3">
                  {step > 1 && (
                    <Button type="button" variant="outline" onClick={prev} className="h-12 flex-1 sm:flex-none">
                      <ArrowLeft className="h-4 w-4" /> Terug
                    </Button>
                  )}
                  {step < 4 ? (
                    <Button type="button" onClick={next} className="h-12 flex-1 bg-gradient-primary shadow-elegant">
                      Volgende <ArrowRight className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button type="submit" disabled={isSubmitting} className="h-12 flex-1 bg-gradient-primary shadow-elegant">
                      <Calendar className="h-4 w-4" />
                      {isSubmitting ? "Versturen..." : "Bevestig reservatie"}
                    </Button>
                  )}
                </div>
              </form>
            </>
          )}
        </div>
      </section>
    </SiteLayout>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold text-right">{value}</dd>
    </div>
  );
}
