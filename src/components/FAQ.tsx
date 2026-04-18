import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQS = [
  {
    q: "Hoe lang duurt een behandeling?",
    a: "Dit hangt af van de gekozen dienst. Een handwas duurt ongeveer 1 uur, een volledige detail tot 4 uur en een keramische coating een volledige dag.",
  },
  {
    q: "Moet ik op voorhand reserveren?",
    a: "Ja, om een vlotte service te garanderen werken wij uitsluitend op afspraak. Reserveer eenvoudig online of bel ons.",
  },
  {
    q: "Welke betaalmiddelen aanvaarden jullie?",
    a: "Cash, bancontact en mobiele betalingen. Voor grotere pakketten is overschrijving mogelijk.",
  },
  {
    q: "Is er een garantie op de keramische coating?",
    a: "Ja, op onze keramische coatings geven wij garantie afhankelijk van het gekozen pakket. Meer info bij reservatie.",
  },
  {
    q: "Kan ik mijn wagen brengen en later ophalen?",
    a: "Zeker. U kan uw sleutels achterlaten en wij verwittigen u zodra de wagen klaar is.",
  },
];

export function FAQ() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider">FAQ</p>
          <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">Veelgestelde vragen</h2>
        </div>

        <Accordion type="single" collapsible className="space-y-3">
          {FAQS.map((f, i) => (
            <AccordionItem
              key={i}
              value={`item-${i}`}
              className="border border-border rounded-xl px-5 bg-card shadow-soft"
            >
              <AccordionTrigger className="text-left font-semibold hover:no-underline py-5">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-relaxed">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
