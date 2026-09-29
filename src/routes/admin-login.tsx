import { useAuth0 } from "@auth0/auth0-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogIn, ShieldCheck } from "lucide-react";
import { useAdminAuthSettings } from "@/components/admin/admin-auth-settings";
import { Button } from "@/components/ui/button";
import { sanitizeReturnTo } from "@/lib/auth/auth-config";

export const Route = createFileRoute("/admin-login")({
  head: () => ({
    meta: [{ title: "Admin Login — Autowascenter" }],
  }),
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
  component: AdminLogin,
});

/**
 * Admin login via Auth0 Universal Login (redirect). Also the Auth0 callback URL:
 * AdminAuthProvider handles ?code=…&state=… here and then navigates to the stored returnTo.
 */
function AdminLogin() {
  const navigate = useNavigate();
  const { returnTo } = Route.useSearch();
  const { configured } = useAdminAuthSettings();
  const { isLoading, isAuthenticated, error, loginWithRedirect } = useAuth0();
  const [redirecting, setRedirecting] = useState(false);
  const target = sanitizeReturnTo(returnTo);

  // Already logged in (e.g. opened /admin-login directly): continue to the admin area.
  useEffect(() => {
    if (configured && !isLoading && isAuthenticated) {
      navigate({ to: target as "/admin", replace: true });
    }
  }, [configured, isLoading, isAuthenticated, navigate, target]);

  const handleLogin = async () => {
    setRedirecting(true);
    try {
      await loginWithRedirect({ appState: { returnTo: target } });
    } catch {
      // Auth0 unreachable before the redirect: allow a retry instead of spinning forever.
      setRedirecting(false);
    }
  };

  const busy = configured && (isLoading || redirecting || isAuthenticated);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-subtle p-4">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="block text-center text-sm text-muted-foreground hover:text-primary mb-6"
        >
          ← Terug naar website
        </Link>

        <div className="rounded-3xl border border-border bg-card p-8 shadow-elegant">
          <div className="text-center mb-6">
            <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-primary flex items-center justify-center shadow-elegant">
              <ShieldCheck className="h-6 w-6 text-primary-foreground" />
            </div>
            <h1 className="mt-4 text-2xl font-bold">Admin Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">Log in om verder te gaan</p>
          </div>

          {!configured ? (
            <p className="text-sm text-center text-muted-foreground">
              Inloggen is momenteel niet beschikbaar: de authenticatie is nog niet geconfigureerd.
            </p>
          ) : (
            <div className="space-y-4">
              {error && !busy && (
                <p role="alert" className="text-sm text-center text-destructive">
                  Inloggen is niet gelukt. Probeer het opnieuw.
                </p>
              )}
              <Button
                type="button"
                onClick={handleLogin}
                disabled={busy}
                className="w-full bg-gradient-primary h-11"
              >
                <LogIn className="h-4 w-4" />
                {busy ? "Bezig..." : "Inloggen"}
              </Button>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Alleen toegang voor beheerders. Nieuwe accounts worden enkel intern aangemaakt.
        </p>
      </div>
    </div>
  );
}
