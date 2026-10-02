// Load state for the admin pages, framework-free so it can be tested without a DOM.
// Guarantees: every load settles (the client has timeouts); a newer load or unmount makes
// older results irrelevant (they are never applied); a 401 notifies the admin guard.

import { ApiError } from "./client.ts";
import { isAborted } from "./errors.ts";

export type LoadState =
  | { status: "loading" }
  | { status: "success" }
  | { status: "error"; error: unknown };

export interface LoadRunnerHandlers {
  onState: (state: LoadState) => void;
  /** Called for 401 responses: lets the existing admin guard re-check the session. */
  onUnauthorized: () => void;
}

export function createLoadRunner({ onState, onUnauthorized }: LoadRunnerHandlers) {
  let sequence = 0;
  let controller: AbortController | null = null;

  return {
    /**
     * Runs `load`; `apply` receives the data only if this is still the latest load.
     * Resolves to true when the data was applied.
     */
    async run<T>(load: (signal: AbortSignal) => Promise<T>, apply: (data: T) => void) {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const id = ++sequence;
      onState({ status: "loading" });
      try {
        const data = await load(current.signal);
        if (id !== sequence) return false;
        apply(data);
        onState({ status: "success" });
        return true;
      } catch (error) {
        if (id !== sequence || isAborted(error)) return false;
        onState({ status: "error", error });
        if (error instanceof ApiError && error.status === 401) onUnauthorized();
        return false;
      }
    },
    /** Unmount: abort the running request and ignore its result. */
    cancel() {
      sequence++;
      controller?.abort();
      controller = null;
    },
  };
}
