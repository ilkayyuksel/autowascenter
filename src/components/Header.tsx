import { useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Menu, X, Calendar } from "lucide-react";
import { Logo } from "./Logo";
import { Button } from "./ui/button";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/diensten", label: "Diensten" },
  { to: "/galerij", label: "Galerij" },
  { to: "/over-ons", label: "Over ons" },
  { to: "/contact", label: "Contact" },
] as const;

export function Header() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur-lg">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Logo />

        <nav className="hidden md:flex items-center gap-1">
          {NAV.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "text-primary bg-accent"
                    : "text-foreground/70 hover:text-foreground hover:bg-muted"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          <Button asChild size="sm" className="bg-gradient-primary shadow-elegant hover:shadow-glow transition-shadow">
            <Link to="/reservatie">
              <Calendar className="h-4 w-4" />
              Reserveer nu
            </Link>
          </Button>
        </div>

        <button
          className="md:hidden p-2 rounded-lg hover:bg-muted"
          onClick={() => setOpen(!open)}
          aria-label="Menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-border bg-background">
          <div className="px-4 py-3 flex flex-col gap-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={`px-3 py-2.5 rounded-lg text-sm font-medium ${
                  pathname === item.to
                    ? "text-primary bg-accent"
                    : "text-foreground/80 hover:bg-muted"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <Button asChild className="mt-2 bg-gradient-primary">
              <Link to="/reservatie" onClick={() => setOpen(false)}>
                <Calendar className="h-4 w-4" />
                Reserveer nu
              </Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
