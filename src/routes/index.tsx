import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/SiteLayout";
import { Hero } from "@/components/Hero";
import { Highlights } from "@/components/Highlights";
import { ServicesPreview } from "@/components/ServicesPreview";
import { RealisationsPreview } from "@/components/RealisationsPreview";
import { Testimonials } from "@/components/Testimonials";
import { FAQ } from "@/components/FAQ";
import { CtaBanner } from "@/components/CtaBanner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Autowascenter — Premium Auto Detailing in Sint-Niklaas" },
      {
        name: "description",
        content:
          "Premium auto detailing in Sint-Niklaas: handwas, interieurreiniging, full detail en keramische coating. Reserveer eenvoudig online.",
      },
      { property: "og:title", content: "Autowascenter — Premium Auto Detailing" },
      { property: "og:description", content: "Vakkundige auto detailing in Sint-Niklaas. Reserveer online." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <SiteLayout>
      <Hero />
      <Highlights />
      <ServicesPreview />
      <RealisationsPreview />
      <Testimonials />
      <CtaBanner />
      <FAQ />
    </SiteLayout>
  );
}
