import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Autowascenter" }] }),
  component: AdminGuard,
});

function AdminGuard() {
  const { user, isAdmin, loading } = useAdminAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Laden...</div>
      </div>
    );
  }

  if (!user) {
    // soft client-side redirect
    if (typeof window !== "undefined") window.location.href = "/admin-login";
    return null;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-subtle p-4">
        <div className="max-w-md w-full text-center rounded-3xl border border-border bg-card p-8 shadow-elegant">
          <div className="mx-auto h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center">
            <ShieldAlert className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="mt-4 text-xl font-bold">Geen toegang</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Je account heeft geen admin-rechten. Vraag aan een bestaande admin om je rol toe te kennen.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/">Terug naar website</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  );
}
