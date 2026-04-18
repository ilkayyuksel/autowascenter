import { Link } from "@tanstack/react-router";
import { MapPin, Phone, Mail, Instagram, Facebook, Clock } from "lucide-react";
import { SITE } from "@/lib/site";
import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-border bg-gradient-subtle mt-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-1">
            <Logo />
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              Premium auto detailing in Sint-Niklaas. Met passie en vakmanschap voor uw wagen.
            </p>
            <div className="mt-4 flex gap-2">
              <a href={SITE.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="h-9 w-9 rounded-lg border border-border hover:bg-accent hover:text-primary flex items-center justify-center transition-colors">
                <Instagram className="h-4 w-4" />
              </a>
              <a href={SITE.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="h-9 w-9 rounded-lg border border-border hover:bg-accent hover:text-primary flex items-center justify-center transition-colors">
                <Facebook className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-sm uppercase tracking-wider mb-4">Navigatie</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/" className="text-muted-foreground hover:text-primary">Home</Link></li>
              <li><Link to="/diensten" className="text-muted-foreground hover:text-primary">Diensten</Link></li>
              <li><Link to="/galerij" className="text-muted-foreground hover:text-primary">Galerij</Link></li>
              <li><Link to="/over-ons" className="text-muted-foreground hover:text-primary">Over ons</Link></li>
              <li><Link to="/contact" className="text-muted-foreground hover:text-primary">Contact</Link></li>
              <li><Link to="/reservatie" className="text-primary font-medium">Reserveer nu</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-sm uppercase tracking-wider mb-4">Contact</h3>
            <ul className="space-y-3 text-sm">
              <li>
                <a href={SITE.mapsUrl} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 text-muted-foreground hover:text-primary">
                  <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{SITE.address}</span>
                </a>
              </li>
              <li>
                <a href={`tel:${SITE.phoneE164}`} className="flex items-center gap-2 text-muted-foreground hover:text-primary">
                  <Phone className="h-4 w-4" />
                  {SITE.phone}
                </a>
              </li>
              <li>
                <a href={`mailto:${SITE.email}`} className="flex items-center gap-2 text-muted-foreground hover:text-primary">
                  <Mail className="h-4 w-4" />
                  {SITE.email}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-sm uppercase tracking-wider mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4" /> Openingsuren
            </h3>
            <ul className="space-y-1.5 text-sm">
              {SITE.hours.map((h) => (
                <li key={h.day} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{h.day}</span>
                  <span className="font-medium">{h.time}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-border flex flex-col sm:flex-row justify-between gap-3 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} Autowascenter. Alle rechten voorbehouden.</p>
          <p>{SITE.domain}</p>
        </div>
      </div>
    </footer>
  );
}
