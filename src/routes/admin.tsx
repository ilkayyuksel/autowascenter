import { createFileRoute, Outlet, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminApiProvider } from "@/components/admin/AdminApiProvider";
import { shouldRecheckSession } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Autowascenter" }] }),
  component: AdminGuard,
});

/**
 * UX guard for the admin area. NOT a security boundary: every admin API call is authorized
 * by the backend (valid Auth0 access token + admin:access). This guard only decides what to
 * show, based on GET /api/admin/me.
 */
function AdminGuard() {
  const { state, login, logout, retry } = useAdminAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // A 401 from an admin page's API call: re-check the session via /api/admin/me, which then
  // shows "Opnieuw inloggen" below. At most once per 30 s, so a 401 can never cause a loop.
  const lastRecheck = useRef<number | null>(null);
  const onUnauthorized = useCallback(() => {
    const now = Date.now();
    if (!shouldRecheckSession(lastRecheck.current, now)) return;
    lastRecheck.current = now;
    retry();
  }, [retry]);
  const loginHere = useCallback(() => login(pathname), [login, pathname]);

  useEffect(() => {
    if (state.status === "unauthenticated") {
      navigate({ to: "/admin-login", search: { returnTo: pathname }, replace: true });
    }
  }, [state.status, navigate, pathname]);

  switch (state.status) {
    case "loading":
    case "unauthenticated":
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-sm text-muted-foreground">Laden...</div>
        </div>
      );

    case "misconfigured":
      return (
        <Notice title="Inloggen niet beschikbaar">
          De authenticatie is nog niet geconfigureerd.
          <Button asChild variant="outline" className="mt-6">
            <Link to="/">Terug naar website</Link>
          </Button>
        </Notice>
      );

    case "reauth":
      return (
        <Notice title="Opnieuw inloggen">
          Je sessie is verlopen of niet meer geldig.
          <Button onClick={() => login(pathname)} className="mt-6 bg-gradient-primary">
            Opnieuw inloggen
          </Button>
        </Notice>
      );

    case "forbidden":
      return (
        <Notice title="Geen toegang">
          Je account heeft geen admin-rechten. Vraag aan een bestaande admin om je rol toe te
          kennen.
          <div className="mt-6 flex justify-center gap-2">
            <Button asChild variant="outline">
              <Link to="/">Terug naar website</Link>
            </Button>
            <Button variant="outline" onClick={logout}>
              Uitloggen
            </Button>
          </div>
        </Notice>
      );

    case "error":
      return (
        <Notice title="Toegang kon niet gecontroleerd worden">
          Probeer het zo meteen opnieuw.
          <Button onClick={retry} className="mt-6 bg-gradient-primary">
            Opnieuw proberen
          </Button>
        </Notice>
      );

    case "authorized":
      return (
        <AdminApiProvider onUnauthorized={onUnauthorized} login={loginHere}>
          <AdminLayout>
            <Outlet />
          </AdminLayout>
        </AdminApiProvider>
      );
  }
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-subtle p-4">
      <div className="max-w-md w-full text-center rounded-3xl border border-border bg-card p-8 shadow-elegant">
        <div className="mx-auto h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center">
          <ShieldAlert className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="mt-4 text-xl font-bold">{title}</h1>
        <div className="mt-2 text-sm text-muted-foreground flex flex-col items-center">
          {children}
        </div>
      </div>
    </div>
  );
}
