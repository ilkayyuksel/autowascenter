import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { LogIn, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/admin/login")({
  head: () => ({
    meta: [{ title: "Admin Login — Autowascenter" }],
  }),
  component: AdminLogin,
});

function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (mode === "signup") {
      const redirectUrl = `${window.location.origin}/admin`;
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectUrl },
      });
      setLoading(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Account aangemaakt! Vraag aan een admin om je toegang te geven.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error("Inloggen mislukt: " + error.message);
      return;
    }
    navigate({ to: "/admin" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-subtle p-4">
      <div className="w-full max-w-md">
        <Link to="/" className="block text-center text-sm text-muted-foreground hover:text-primary mb-6">
          ← Terug naar website
        </Link>

        <div className="rounded-3xl border border-border bg-card p-8 shadow-elegant">
          <div className="text-center mb-6">
            <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-primary flex items-center justify-center shadow-elegant">
              <ShieldCheck className="h-6 w-6 text-primary-foreground" />
            </div>
            <h1 className="mt-4 text-2xl font-bold">Admin Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "signin" ? "Log in om verder te gaan" : "Maak een nieuw account aan"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1.5"
                autoComplete="email"
              />
            </div>
            <div>
              <Label htmlFor="password">Wachtwoord</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="mt-1.5"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full bg-gradient-primary h-11">
              <LogIn className="h-4 w-4" />
              {loading ? "Bezig..." : mode === "signin" ? "Inloggen" : "Account aanmaken"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-primary"
          >
            {mode === "signin"
              ? "Nog geen account? Registreer"
              : "Al een account? Log in"}
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Eerste account? Na registratie moet een bestaande admin je rol toekennen.
          Het allereerste account kan via Lovable Cloud handmatig admin gemaakt worden.
        </p>
      </div>
    </div>
  );
}
