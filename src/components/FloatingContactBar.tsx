import { Phone, MessageCircle, Mail, MapPin, Instagram } from "lucide-react";
import { SITE } from "@/lib/site";

const items = [
  {
    label: "WhatsApp",
    href: `https://wa.me/${SITE.whatsapp.replace(/\D/g, "")}`,
    icon: MessageCircle,
    color: "hover:text-[oklch(0.7_0.17_155)]",
  },
  {
    label: "Bellen",
    href: `tel:${SITE.phoneE164}`,
    icon: Phone,
    color: "hover:text-primary",
  },
  {
    label: "E-mail",
    href: `mailto:${SITE.email}`,
    icon: Mail,
    color: "hover:text-primary",
  },
  {
    label: "Instagram",
    href: SITE.instagram,
    icon: Instagram,
    color: "hover:text-[oklch(0.65_0.22_15)]",
  },
  {
    label: "Maps",
    href: SITE.mapsUrl,
    icon: MapPin,
    color: "hover:text-primary",
  },
];

export function FloatingContactBar() {
  return (
    <div className="fixed left-3 top-1/2 -translate-y-1/2 z-30 hidden sm:block">
      <div className="flex flex-col gap-1.5 p-1.5 rounded-2xl bg-background/85 backdrop-blur-lg border border-border shadow-elegant">
        {items.map((item) => (
          <a
            key={item.label}
            href={item.href}
            target={item.href.startsWith("http") ? "_blank" : undefined}
            rel="noopener noreferrer"
            aria-label={item.label}
            className={`group h-10 w-10 rounded-xl flex items-center justify-center text-muted-foreground transition-all hover:bg-accent ${item.color}`}
            title={item.label}
          >
            <item.icon className="h-4 w-4 transition-transform group-hover:scale-110" />
          </a>
        ))}
      </div>
    </div>
  );
}
