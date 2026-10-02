import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminApi } from "@/components/admin/admin-api-context";
import { createLoadRunner, type LoadState } from "@/lib/api/load-runner";

/**
 * Load state for an admin page's READ: `run(load, apply)` shows loading, applies the data
 * of the latest load only, and turns every failure into an error state (never endless
 * loading). Keeps the pages' existing useEffect/useState structure.
 */
export function useAdminLoad() {
  const { api, onUnauthorized } = useAdminApi();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;

  const runner = useRef<ReturnType<typeof createLoadRunner> | null>(null);
  if (!runner.current) {
    runner.current = createLoadRunner({
      onState: setState,
      onUnauthorized: () => unauthorized.current(),
    });
  }
  useEffect(() => () => runner.current?.cancel(), []);

  const run = useCallback(
    <T>(load: (signal: AbortSignal) => Promise<T>, apply: (data: T) => void) =>
      runner.current!.run(load, apply),
    [],
  );

  return { api, state, run };
}
