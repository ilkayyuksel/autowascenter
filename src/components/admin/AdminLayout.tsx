import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, Outlet } from "@tanstack/react-router";
import { LayoutDashboard, Calendar, Sparkles, Image, Star, LogOut, Menu, X, Car, CalendarX, Settings } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/admin", label: "Overzicht", icon: LayoutDashboard, exact: true },
  { to: "/admin/reservaties", label: "Reservaties", icon: Calendar },
  { to: "/admin/diensten", label: "Diensten", icon: Sparkles },
  { to: "/admin/voertuigen", label: "Voertuigen & prijzen", icon: Car },
  { to: "/admin/blokkades", label: "Blokkades", icon: CalendarX },
  { to: "/admin/galerij", label: "Galerij", icon: Image },
  { to: "/admin/reviews", label: "Reviews", icon: Star },
  { to: "/admin/instellingen", label: "Instellingen", icon: Settings },
] as const;

export function AdminLayout({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname.startsWith(to);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/admin-login" });
  };

  return (
    <div className="min-h-screen bg-gradient-subtle">
      {/* Mobile header */}
      <header className="lg:hidden sticky top-0 z-30 h-14 bg-background/90 backdrop-blur border-b border-border flex items-center justify-between px-4">
        <Logo />
        <button onClick={() => setOpen(!open)} className="p-2 rounded-lg hover:bg-muted">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`${
            open ? "block" : "hidden"
          } lg:block fixed lg:sticky top-14 lg:top-0 inset-x-0 lg:inset-auto z-20 lg:h-screen w-full lg:w-64 bg-background border-b lg:border-b-0 lg:border-r border-border`}
        >
          <div className="hidden lg:flex h-16 items-center px-6 border-b border-border">
            <Logo />
          </div>
          <nav className="p-3 space-y-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive(item.to, "exact" in item ? item.exact : false)
                    ? "bg-accent text-primary"
                    : "text-foreground/70 hover:bg-muted hover:text-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="p-3 lg:absolute lg:bottom-0 lg:left-0 lg:right-0 border-t border-border">
            <Button variant="ghost" onClick={handleLogout} className="w-full justify-start">
              <LogOut className="h-4 w-4" />
              Uitloggen
            </Button>
          </div>
        </aside>

        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-10">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}
