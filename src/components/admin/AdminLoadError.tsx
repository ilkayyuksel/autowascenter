import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeApiError } from "@/lib/api/errors";
import { useAdminApi } from "./admin-api-context";

/** Error state of an admin page's data load: fixed Dutch texts, never backend details. */
export function AdminLoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { login } = useAdminApi();
  const view = describeApiError(error);

  return (
    <div
      role="alert"
      className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold text-foreground">{view.title}</div>
          <p className="mt-1 text-muted-foreground">{view.message}</p>
          <div className="mt-4 flex gap-2">
            {view.kind === "reauth" && (
              <Button size="sm" onClick={login} className="bg-gradient-primary">
                Opnieuw inloggen
              </Button>
            )}
            {view.retryable && onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry}>
                Opnieuw proberen
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
