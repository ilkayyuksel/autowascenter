import { Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles, ShieldCheck, Star } from "lucide-react";
import heroImg from "@/assets/hero-car.jpg";
import { Button } from "./ui/button";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <img
          src={heroImg}
          alt="Premium auto detailing studio"
          className="h-full w-full object-cover"
          width={1920}
          height={1080}
          fetchPriority="high"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent text-primary text-xs font-semibold mb-6 border border-primary/20">
            <Sparkles className="h-3.5 w-3.5" />
            Premium Auto Detailing in Sint-Niklaas
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
            Uw wagen verdient
            <br />
            <span className="text-gradient-primary">een tweede leven.</span>
          </h1>

          <p className="mt-6 text-lg text-muted-foreground max-w-xl leading-relaxed">
            Van handwas tot keramische coating — wij behandelen elke wagen met de
            zorg en precisie die hij verdient. Boek vandaag uw afspraak.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-gradient-primary shadow-elegant hover:shadow-glow transition-shadow text-base h-12 px-6">
              <Link to="/reservatie">
                Reserveer nu
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="text-base h-12 px-6 border-border bg-background/60 backdrop-blur">
              <Link to="/diensten">Onze diensten</Link>
            </Button>
          </div>

          <div className="mt-12 flex flex-wrap gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="flex">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-primary text-primary" />
                ))}
              </div>
              <span className="text-muted-foreground"><strong className="text-foreground">5.0</strong> beoordeling</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Vakmanschap & garantie
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
