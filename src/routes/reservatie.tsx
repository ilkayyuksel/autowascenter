import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CheckCircle2,
  Calendar,
  ArrowRight,
  ArrowLeft,
  Info,
  Check,
  MapPin,
  Car,
  Clock,
} from "lucide-react";
import { getVehicleIcon } from "@/lib/vehicleIcons";
import { toast } from "sonner";
import { SiteLayout } from "@/components/SiteLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { computeAvailableSlots, computePickup, formatDuration, fetchSlotData } from "@/lib/slots";

export const Route = createFileRoute("/reservatie")({
  head: () => ({
    meta: [
      { title: "Reserveer nu — Autowascenter" },
      { name: "description", content: "Reserveer eenvoudig online uw afspraak bij Autowascenter in Sint-Niklaas." },
      { property: "og:title", content: "Reserveer een afspraak — Autowascenter" },
      { property: "og:description", content: "Boek online uw detailing afspraak in een paar klikken." },
    ],
  }),
  component: BookingPage,
});

// --- Types ---
type VehicleType = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  image_url: string | null;
};

type ServiceOption = {
  id: string; // vts.id
  service_id: string;
  title: string;
  description: string | null;
  category: string | null;
  badge: string | null;
  price: number;
  duration_minutes: number;
  kind: string;
  includes: string[];
};

type Booking = {
  preferred_date: string;
  preferred_time: string;
  total_duration_minutes: number;
};

type BlockedPeriod = {
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
};

type SiteSettings = {
  km_fee: number;
  free_km?: number;
  opening_hour: string;
  closing_hour: string;
  slot_interval_minutes: number;
};

function formatDateNL(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short" });
}

// --- Validation ---
const customerSchema = z.object({
  customer_name: z.string().trim().min(2, "Naam is verplicht").max(100),
  customer_phone: z.string().trim().min(6, "GSM-nummer is verplicht").max(30),
  customer_email: z.string().trim().email("Ongeldig e-mailadres").max(255),
  vehicle_brand: z.string().trim().min(1, "Merk is verplicht").max(60),
  vehicle_model: z.string().trim().min(1, "Model is verplicht").max(60),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  company_name: z.string().trim().max(120).optional().or(z.literal("")),
  vat_number: z.string().trim().max(40).optional().or(z.literal("")),
  on_location: z.boolean(),
  location_in_sint_niklaas: z.boolean().optional(),
  location_address: z.string().trim().max(255).optional().or(z.literal("")),
}).refine(
  (data) => !data.on_location || data.location_in_sint_niklaas || (data.location_address && data.location_address.length > 5),
  { message: "Vul uw adres in", path: ["location_address"] },
);

type CustomerForm = z.infer<typeof customerSchema>;

const STEPS = [
  { id: 1, label: "Voertuig" },
  { id: 2, label: "Diensten" },
  { id: 3, label: "Extra's" },
  { id: 4, label: "Datum & uur" },
  { id: 5, label: "Gegevens" },
  { id: 6, label: "Bevestigen" },
];

// --- Helpers ---
function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(m: number) {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

function BookingPage() {
  // Wizard state
  const [step, setStep] = useState(1);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const isFirstStep = useRef(true);

  useEffect(() => {
    if (isFirstStep.current) {
      isFirstStep.current = false;
      return;
    }
    progressRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  // Data from DB
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocked, setBlocked] = useState<BlockedPeriod[]>([]);
  const [settings, setSettings] = useState<SiteSettings>({
    km_fee: 1,
    opening_hour: "10:00",
    closing_hour: "21:00",
    slot_interval_minutes: 30,
  });

  // Selections
  const [vehicleTypeId, setVehicleTypeId] = useState<string>("");
  const [selectedServiceVtsIds, setSelectedServiceVtsIds] = useState<string[]>([]);
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("");

  const customerForm = useForm<CustomerForm>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      customer_name: "",
      customer_phone: "",
      customer_email: "",
      vehicle_brand: "",
      vehicle_model: "",
      notes: "",
      company_name: "",
      vat_number: "",
      on_location: false,
      location_in_sint_niklaas: true,
      location_address: "",
    },
  });

  const onLocation = customerForm.watch("on_location");
  const inSN = customerForm.watch("location_in_sint_niklaas");

  // Initial loads
  useEffect(() => {
    supabase
      .from("vehicle_types")
      .select("id,slug,title,description,image_url")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => data && setVehicleTypes(data as VehicleType[]));

    supabase
      .from("blocked_periods")
      .select("start_date,end_date,start_time,end_time")
      .then(({ data }) => data && setBlocked(data as BlockedPeriod[]));

    supabase
      .from("site_settings")
      .select("km_fee,free_km,opening_hour,closing_hour,slot_interval_minutes")
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          setSettings({
            km_fee: Number(data.km_fee),
            free_km: Number(data.free_km),
            opening_hour: data.opening_hour,
            closing_hour: data.closing_hour,
            slot_interval_minutes: data.slot_interval_minutes,
          });
        }
      });
  }, []);

  // Load services for chosen vehicle type
  useEffect(() => {
    if (!vehicleTypeId) {
      setServiceOptions([]);
      return;
    }
    supabase
      .from("vehicle_type_services")
      .select(
        "id,service_id,price,duration_minutes,available,services!inner(id,title,description,category,badge,bookable,active,sort_order,kind)",
      )
      .eq("vehicle_type_id", vehicleTypeId)
      .eq("available", true)
      .then(async ({ data }) => {
        if (!data) return;
        const { data: ps } = await supabase.from("package_services").select("package_id,services!package_services_service_id_fkey(title)");
        const inc: Record<string, string[]> = {};
        ((ps as any[]) ?? []).forEach((r) => { if (r.services?.title) (inc[r.package_id] ??= []).push(r.services.title); });
        const opts: ServiceOption[] = (data as any[])
          .filter((row) => row.services?.bookable && row.services?.active)
          .map((row) => ({
            id: row.id,
            service_id: row.service_id,
            title: row.services.title,
            description: row.services.description,
            category: row.services.category,
            badge: row.services.badge,
            price: Number(row.price),
            duration_minutes: Number(row.duration_minutes),
            kind: row.services.kind ?? "dienst",
            includes: inc[row.service_id] ?? [],
          }))
          .sort((a, b) => a.title.localeCompare(b.title));
        setServiceOptions(opts);
      });
    // Reset downstream when vehicle type changes
    setSelectedServiceVtsIds([]);
    setTime("");
  }, [vehicleTypeId]);

  // Load bookings around the chosen date so multi-day services are accounted for
  useEffect(() => {
    if (!date) {
      setBookings([]);
      return;
    }
    fetchSlotData(date).then(({ bookings: bs, blocked: bl, settings: st }) => {
      setBookings(bs);
      setBlocked(bl);
      setSettings((s) => ({ ...s, ...st }));
    });
    setTime("");
  }, [date]);

  // Derived totals
  const selectedServices = useMemo(
    () => serviceOptions.filter((s) => selectedServiceVtsIds.includes(s.id)),
    [serviceOptions, selectedServiceVtsIds],
  );
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration_minutes, 0);
  const totalServicesPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const locationFee = onLocation && !inSN ? 0 : 0; // dynamic distance not yet computed
  const totalPrice = totalServicesPrice + locationFee;
  const vatAmount = totalPrice * 0.21;
  const totalInclVat = totalPrice + vatAmount;
  const freeKm = settings.free_km ?? 20;
  const selectedVehicleType = vehicleTypes.find((v) => v.id === vehicleTypeId);

  // Available time slots — uses shared computation (single source of truth)
  const availableSlots = useMemo(
    () =>
      computeAvailableSlots({
        date,
        durationMinutes: totalDuration,
        bookings,
        blocked,
        settings,
      }),
    [date, totalDuration, bookings, blocked, settings],
  );

  // Step navigation guards
  const canNext = () => {
    if (step === 1) return !!vehicleTypeId;
    if (step === 2) return selectedServices.some((x) => x.kind !== "extra");
    if (step === 4) return !!date && !!time;
    return true;
  };

  const next = async () => {
    if (step === 5) {
      const valid = await customerForm.trigger();
      if (!valid) return;
    }
    if (!canNext() && step !== 5) {
      toast.error("Vul deze stap eerst in.");
      return;
    }
    setStep((s) => Math.min(STEPS.length, s + 1));
  };
  const prev = () => setStep((s) => Math.max(1, s - 1));

  const toggleService = (id: string) => {
    setSelectedServiceVtsIds((curr) =>
      curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id],
    );
    setTime("");
  };

  const submit = async () => {
    const data = customerForm.getValues();
    setSubmitting(true);
    try {
      const endTime = minutesToTime(timeToMinutes(time) + totalDuration);
      const serviceTitles = selectedServices.map((s) => s.title).join(", ");

      const { data: booking, error } = await supabase
        .from("bookings")
        .insert({
          customer_name: data.customer_name,
          customer_email: data.customer_email,
          customer_phone: data.customer_phone,
          vehicle_type_id: vehicleTypeId,
          vehicle_brand: data.vehicle_brand,
          vehicle_model: data.vehicle_model,
          vehicle_info: `${data.vehicle_brand} ${data.vehicle_model}`,
          service_id: selectedServices[0]?.service_id ?? null,
          service_title: serviceTitles,
          preferred_date: date,
          preferred_time: time,
          end_time: endTime,
          total_duration_minutes: totalDuration,
          total_price: totalPrice,
          on_location: data.on_location,
          location_in_sint_niklaas: data.on_location ? !!data.location_in_sint_niklaas : null,
          location_address: data.on_location && !data.location_in_sint_niklaas ? data.location_address : null,
          location_fee: locationFee,
          company_name: data.company_name || null,
          vat_number: data.vat_number || null,
          notes: data.notes || null,
          status: "nieuw",
        })
        .select("id")
        .single();

      if (error || !booking) throw error ?? new Error("Geen reservatie aangemaakt");

      // Insert booking_services
      const bsRows = selectedServices.map((s) => ({
        booking_id: booking.id,
        service_id: s.service_id,
        service_title: s.title,
        price: s.price,
        duration_minutes: s.duration_minutes,
      }));
      if (bsRows.length > 0) {
        const { error: bsErr } = await supabase.from("booking_services").insert(bsRows);
        if (bsErr) throw bsErr;
      }

      toast.success("Reservatie ontvangen!");
      setSuccess(true);
    } catch (err) {
      console.error(err);
      toast.error("Er ging iets mis. Probeer opnieuw of bel ons.");
    } finally {
      setSubmitting(false);
    }
  };

  const resetAll = () => {
    setSuccess(false);
    setStep(1);
    setVehicleTypeId("");
    setSelectedServiceVtsIds([]);
    setDate("");
    setTime("");
    customerForm.reset();
  };

  const today = new Date().toISOString().split("T")[0];
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
              Voor basisbeurten hoef je <span className="font-semibold text-foreground">geen reservatie</span> te
              maken — kom gewoon langs tijdens de openingsuren.
            </p>
          </div>
        </div>
      </section>

      <section className="py-10 sm:py-14">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          {success ? (
            <div className="rounded-3xl border border-border bg-card p-10 text-center shadow-elegant">
              <div className="mx-auto h-16 w-16 rounded-full bg-accent flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-primary" />
              </div>
              <h2 className="mt-6 text-2xl font-bold">Bedankt voor uw reservatie!</h2>
              <p className="mt-3 text-muted-foreground">
                We hebben uw aanvraag ontvangen. U krijgt een bevestiging per e-mail. Wij nemen
                contact op indien nodig.
              </p>
              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={resetAll} className="bg-gradient-primary">Nieuwe reservatie</Button>
                <Link to="/"><Button variant="outline">Terug naar home</Button></Link>
              </div>
            </div>
          ) : (
            <>
              {/* Progress */}
              <div className="mb-6 scroll-mt-20" ref={progressRef}>
                <div className="relative">
                  {/* Connecting track */}
                  <div className="absolute top-4 left-0 right-0 h-0.5 bg-muted -z-0" style={{ marginLeft: `${100 / STEPS.length / 2}%`, marginRight: `${100 / STEPS.length / 2}%` }} />
                  <div
                    className="absolute top-4 h-0.5 bg-primary transition-all duration-500 -z-0"
                    style={{
                      left: `${100 / STEPS.length / 2}%`,
                      width: `${((step - 1) / (STEPS.length - 1)) * (100 - (100 / STEPS.length))}%`,
                    }}
                  />
                  <div className="relative grid" style={{ gridTemplateColumns: `repeat(${STEPS.length}, 1fr)` }}>
                    {STEPS.map((s) => (
                      <div key={s.id} className="flex flex-col items-center gap-2">
                        <div
                          className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-all bg-background ring-2 ${
                            step > s.id
                              ? "bg-primary text-primary-foreground ring-primary"
                              : step === s.id
                                ? "bg-primary text-primary-foreground ring-primary shadow-elegant scale-110"
                                : "bg-muted text-muted-foreground ring-muted"
                          }`}
                        >
                          {step > s.id ? <Check className="h-4 w-4" /> : s.id}
                        </div>
                        <span
                          className={`text-[10px] sm:text-xs text-center leading-tight ${
                            step >= s.id ? "text-foreground font-semibold" : "text-muted-foreground"
                          }`}
                        >
                          {s.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-border bg-card p-5 sm:p-8 shadow-elegant">
                {/* Step 1: Vehicle type */}
                {step === 1 && (
                  <div className="space-y-4">
                    <h2 className="text-xl font-bold">Welk type voertuig heeft u?</h2>
                    <p className="text-sm text-muted-foreground">
                      Selecteer het type dat het best bij uw wagen past.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {vehicleTypes.map((v) => {
                        const VIcon = getVehicleIcon(v.slug);
                        const selected = vehicleTypeId === v.id;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setVehicleTypeId(v.id)}
                            className={`text-left p-4 rounded-2xl border-2 transition-all min-h-[120px] flex flex-col ${
                              selected
                                ? "border-primary bg-accent shadow-elegant"
                                : "border-border hover:border-primary/40"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={`h-12 w-12 rounded-xl flex items-center justify-center ${
                                  selected ? "bg-primary text-primary-foreground" : "bg-muted text-primary"
                                }`}
                              >
                                <VIcon className="h-6 w-6" strokeWidth={1.75} />
                              </div>
                              <div className="font-semibold">{v.title}</div>
                            </div>
                            {v.description && (
                              <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{v.description}</p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Step 2: Packages & services */}
                {step === 2 && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-xl font-bold">Diensten en pakketten</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Meerdere keuzes mogelijk. Prijs en duur zijn aangepast aan uw voertuigtype. Alle prijzen excl. btw.
                      </p>
                    </div>
                    {serviceOptions.filter((s) => s.kind !== "extra").length === 0 && (
                      <p className="text-sm text-muted-foreground italic">Geen diensten beschikbaar voor dit voertuigtype.</p>
                    )}
                    {(["pakket", "dienst"] as const).map((k) => {
                      const group = serviceOptions.filter((s) => s.kind === k);
                      if (!group.length) return null;
                      return (
                        <div key={k}>
                          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                            {k === "pakket" ? "Pakketten" : "Diensten"}
                          </h3>
                          <div className="grid gap-3">
                            {group.map((s) => (
                              <OptionCard key={s.id} s={s} sel={selectedServiceVtsIds.includes(s.id)} onClick={() => toggleService(s.id)} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Step 3: Extras */}
                {step === 3 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-xl font-bold">Extra diensten</h2>
                      <p className="mt-1 text-sm text-muted-foreground">Optioneel — voeg extra's toe of ga gewoon verder. Prijzen excl. btw.</p>
                    </div>
                    {serviceOptions.filter((s) => s.kind === "extra").length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">Geen extra diensten beschikbaar voor dit voertuigtype.</p>
                    ) : (
                      <div className="grid gap-3">
                        {serviceOptions.filter((s) => s.kind === "extra").map((s) => (
                          <OptionCard key={s.id} s={s} sel={selectedServiceVtsIds.includes(s.id)} onClick={() => toggleService(s.id)} />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Step 4: Date & time */}
                {step === 4 && (
                  <div className="space-y-5">
                    <h2 className="text-xl font-bold">Wanneer past het u?</h2>
                    <div>
                      <Label htmlFor="date">Datum</Label>
                      <Input
                        id="date"
                        type="date"
                        min={today}
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="mt-1.5 h-12 text-base"
                      />
                    </div>
                    {date && (
                      <div>
                        <Label>Wagen afgeven om — kies een vrij tijdstip ({formatDuration(totalDuration)} nodig)</Label>
                        {availableSlots.length === 0 ? (
                          <p className="mt-2 text-sm text-muted-foreground italic">
                            Geen beschikbare tijdstippen op deze datum. Kies een andere datum.
                          </p>
                        ) : (
                          <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {availableSlots.map((t) => {
                              const pickup = computePickup(date, t, totalDuration, settings);
                              const sameDay = pickup.date === date;
                              return (
                                <button
                                  key={t}
                                  type="button"
                                  onClick={() => setTime(t)}
                                  className={`py-2.5 px-2 text-sm rounded-xl border-2 font-semibold transition-all flex flex-col items-center gap-0.5 ${
                                    time === t
                                      ? "border-primary bg-primary text-primary-foreground shadow-elegant"
                                      : "border-border hover:border-primary/40"
                                  }`}
                                >
                                  <span className="text-base">{t}</span>
                                  <span className={`text-[10px] font-normal ${time === t ? "opacity-90" : "text-muted-foreground"}`}>
                                    ophalen {sameDay ? "" : `${formatDateNL(pickup.date)} `}{pickup.time}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {time && (
                          <p className="mt-3 text-xs text-muted-foreground">
                            U levert uw wagen af om <span className="font-semibold text-foreground">{time}</span> en kan ze ophalen om{" "}
                            <span className="font-semibold text-foreground">
                              {(() => {
                                const p = computePickup(date, time, totalDuration, settings);
                                return p.date === date ? p.time : `${formatDateNL(p.date)} ${p.time}`;
                              })()}
                            </span>.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Step 4: Customer */}
                {step === 5 && (
                  <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                    <h2 className="text-xl font-bold">Uw gegevens</h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="customer_name">Naam *</Label>
                        <Input id="customer_name" {...customerForm.register("customer_name")} className="mt-1.5 h-11" />
                        {customerForm.formState.errors.customer_name && (
                          <p className="text-xs text-destructive mt-1">{customerForm.formState.errors.customer_name.message}</p>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="customer_phone">GSM *</Label>
                        <Input id="customer_phone" {...customerForm.register("customer_phone")} className="mt-1.5 h-11" />
                        {customerForm.formState.errors.customer_phone && (
                          <p className="text-xs text-destructive mt-1">{customerForm.formState.errors.customer_phone.message}</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="customer_email">E-mail *</Label>
                      <Input id="customer_email" type="email" {...customerForm.register("customer_email")} className="mt-1.5 h-11" />
                      {customerForm.formState.errors.customer_email && (
                        <p className="text-xs text-destructive mt-1">{customerForm.formState.errors.customer_email.message}</p>
                      )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="vehicle_brand">Automerk *</Label>
                        <Input id="vehicle_brand" placeholder="BMW" {...customerForm.register("vehicle_brand")} className="mt-1.5 h-11" />
                        {customerForm.formState.errors.vehicle_brand && (
                          <p className="text-xs text-destructive mt-1">{customerForm.formState.errors.vehicle_brand.message}</p>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="vehicle_model">Model *</Label>
                        <Input id="vehicle_model" placeholder="3-Reeks" {...customerForm.register("vehicle_model")} className="mt-1.5 h-11" />
                        {customerForm.formState.errors.vehicle_model && (
                          <p className="text-xs text-destructive mt-1">{customerForm.formState.errors.vehicle_model.message}</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="notes">Opmerking (optioneel)</Label>
                      <Textarea id="notes" rows={3} placeholder="Bv. specifieke vlekken, wensen of vragen over uw wagen" {...customerForm.register("notes")} className="mt-1.5" />
                    </div>

                    {/* Company */}
                    <details className="rounded-xl border border-border p-4">
                      <summary className="cursor-pointer text-sm font-semibold">
                        Bedrijfsgegevens (optioneel)
                      </summary>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="company_name">Bedrijfsnaam</Label>
                          <Input id="company_name" {...customerForm.register("company_name")} className="mt-1.5 h-11" />
                        </div>
                        <div>
                          <Label htmlFor="vat_number">BTW-nummer</Label>
                          <Input id="vat_number" placeholder="BE0123.456.789" {...customerForm.register("vat_number")} className="mt-1.5 h-11" />
                        </div>
                      </div>
                    </details>

                    {/* On location */}
                    <div className="rounded-xl border-2 border-border p-4 space-y-3">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <Checkbox
                          checked={onLocation}
                          onCheckedChange={(v) => customerForm.setValue("on_location", !!v)}
                        />
                        <span className="text-sm font-semibold inline-flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-primary" />
                          Ik wil dat de reiniging op locatie gebeurt
                        </span>
                      </label>

                      {onLocation && (
                        <div className="pl-7 space-y-3">
                          <div className="space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer text-sm">
                              <input
                                type="radio"
                                checked={!!inSN}
                                onChange={() => customerForm.setValue("location_in_sint_niklaas", true)}
                              />
                              Ik woon in Sint-Niklaas
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer text-sm">
                              <input
                                type="radio"
                                checked={!inSN}
                                onChange={() => customerForm.setValue("location_in_sint_niklaas", false)}
                              />
                              Ander adres
                            </label>
                          </div>

                          {!inSN && (
                            <>
                              <div>
                                <Label htmlFor="location_address">Adres</Label>
                                <Input
                                  id="location_address"
                                  placeholder="Straat 12, 9000 Gent"
                                  {...customerForm.register("location_address")}
                                  className="mt-1.5 h-11"
                                />
                                {customerForm.formState.errors.location_address && (
                                  <p className="text-xs text-destructive mt-1">
                                    {customerForm.formState.errors.location_address.message}
                                  </p>
                                )}
                              </div>
                              <div className="rounded-lg bg-accent/50 p-3 text-xs text-muted-foreground flex gap-2">
                                <Info className="h-4 w-4 text-primary flex-shrink-0" />
                                <span>
                                  De eerste <span className="font-semibold text-foreground">{freeKm} km</span> vanaf
                                  Raapstraat 34, 9100 Sint-Niklaas zijn gratis. Daarbuiten rekenen we
                                  <span className="font-semibold text-foreground"> €{settings.km_fee.toFixed(2)} per km</span> (excl. btw).
                                  De exacte vergoeding wordt met u afgestemd na ontvangst van uw aanvraag.
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </form>
                )}

                {/* Step 6: Confirm */}
                {step === 6 && (
                  <div className="space-y-4">
                    <h2 className="text-xl font-bold">Controleer uw reservatie</h2>
                    <dl className="rounded-2xl bg-accent/40 p-5 space-y-3 text-sm">
                      <Row label="Voertuigtype" value={selectedVehicleType?.title ?? "-"} />
                      <Row
                        label="Diensten"
                        value={selectedServices.map((s) => s.title).join(", ") || "-"}
                      />
                      <Row label="Datum" value={formatDateNL(date)} />
                      <Row
                        label="Wagen afgeven om"
                        value={time || "-"}
                      />
                      <Row
                        label="Wagen ophalen"
                        value={(() => {
                          if (!time || !date) return "-";
                          const p = computePickup(date, time, totalDuration, settings);
                          return p.date === date ? p.time : `${formatDateNL(p.date)} om ${p.time}`;
                        })()}
                      />
                      <Row label="Totale duur" value={formatDuration(totalDuration)} />
                      {customerForm.getValues("notes") && <Row label="Opmerking" value={customerForm.getValues("notes") ?? ""} />}
                      <Row label="Wagen" value={`${customerForm.getValues("vehicle_brand")} ${customerForm.getValues("vehicle_model")}`} />
                      <Row label="Naam" value={customerForm.getValues("customer_name")} />
                      <Row label="GSM" value={customerForm.getValues("customer_phone")} />
                      <Row label="E-mail" value={customerForm.getValues("customer_email")} />
                      <Row
                        label="Op locatie"
                        value={
                          customerForm.getValues("on_location")
                            ? customerForm.getValues("location_in_sint_niklaas")
                              ? "Ja, in Sint-Niklaas"
                              : `Ja, ${customerForm.getValues("location_address")}`
                            : "Nee"
                        }
                      />
                      <div className="border-t border-border pt-3 mt-3 flex justify-between text-base">
                        <dt className="font-semibold">Totaal excl. btw</dt>
                        <dd className="font-semibold">€{totalPrice.toFixed(2)}</dd>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <dt>Btw 21%</dt>
                        <dd>€{vatAmount.toFixed(2)}</dd>
                      </div>
                      <div className="flex justify-between text-base">
                        <dt className="font-semibold">Totaal incl. btw</dt>
                        <dd className="font-bold text-primary">€{totalInclVat.toFixed(2)}</dd>
                      </div>
                    </dl>
                    <p className="text-xs text-muted-foreground text-center">
                      Geen aanbetaling vereist — wij bevestigen uw afspraak persoonlijk.
                    </p>
                  </div>
                )}

                {/* Live summary (steps 2-4) */}
                {step >= 2 && step < 6 && selectedServices.length > 0 && (
                  <div className="mt-6 rounded-xl bg-accent/40 border border-border p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Samenvatting
                    </p>
                    <div className="mt-2 space-y-1.5 text-sm">
                      {selectedVehicleType && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Voertuig</span>
                          <span className="font-semibold">{selectedVehicleType.title}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Diensten</span>
                        <span className="font-semibold">{selectedServices.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Totale duur</span>
                        <span className="font-semibold">{formatDuration(totalDuration)}</span>
                      </div>
                      <div className="flex justify-between text-base pt-1.5 border-t border-border mt-1.5">
                        <span className="font-semibold">Totaal excl. btw</span>
                        <span className="font-semibold">€{totalPrice.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-semibold">Totaal incl. btw</span>
                        <span className="font-bold text-primary">€{totalInclVat.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Nav buttons */}
                <div className="mt-6 flex gap-3">
                  {step > 1 && (
                    <Button type="button" variant="outline" onClick={prev} className="h-12 flex-1 sm:flex-none">
                      <ArrowLeft className="h-4 w-4" /> Terug
                    </Button>
                  )}
                  {step < STEPS.length ? (
                    <Button
                      type="button"
                      onClick={next}
                      disabled={!canNext() && step !== 5}
                      className="h-12 flex-1 bg-gradient-primary shadow-elegant"
                    >
                      Volgende <ArrowRight className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={submit}
                      disabled={submitting}
                      className="h-12 flex-1 bg-gradient-primary shadow-elegant"
                    >
                      <Calendar className="h-4 w-4" />
                      {submitting ? "Versturen..." : "Bevestig reservatie"}
                    </Button>
                  )}
                </div>
              </div>
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
      <dd className="font-semibold text-right break-words">{value}</dd>
    </div>
  );
}

function OptionCard({ s, sel, onClick }: { s: ServiceOption; sel: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 rounded-2xl border-2 transition-all flex items-start gap-3 ${
        sel ? "border-primary bg-accent shadow-elegant" : "border-border hover:border-primary/40"
      }`}
    >
      <div
        className={`h-6 w-6 mt-0.5 rounded-md flex items-center justify-center flex-shrink-0 border-2 ${
          sel ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30"
        }`}
      >
        {sel && <Check className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-semibold">{s.title}</div>
          {s.kind === "pakket" && (
            <span className="text-[10px] font-semibold bg-primary text-primary-foreground px-2 py-0.5 rounded-full">Pakket</span>
          )}
          {s.kind === "extra" && (
            <span className="text-[10px] font-semibold bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">Extra dienst</span>
          )}
          {s.badge && (
            <span className="text-[10px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">{s.badge}</span>
          )}
        </div>
        {s.description && <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{s.description}</p>}
        {s.includes.length > 0 && (
          <ul className="mt-2 text-xs text-muted-foreground space-y-0.5">
            {s.includes.map((t) => (
              <li key={t} className="flex items-center gap-1.5"><Check className="h-3 w-3 text-primary" /> {t}</li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">€{s.price.toFixed(2)} <span className="font-normal text-muted-foreground">excl. btw</span></span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> {formatDuration(s.duration_minutes)}
          </span>
        </div>
      </div>
    </button>
  );
}
