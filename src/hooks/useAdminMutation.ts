import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useAdminApi } from "@/components/admin/admin-api-context";
import type { ApiClient } from "@/lib/api/client";
import type { WriteErrorView } from "@/lib/api/errors";
import { runMutation } from "@/lib/api/mutation";

export interface MutateOptions<T> {
  /** Toast after success; may use the API response (e.g. server-computed price). */
  success?: string | ((data: T) => string);
  /** Called when the error means the shown data is stale (404, 409, timeout, ...). */
  onStale?: (view: WriteErrorView) => void;
  /** Called for every failure, after the toast. */
  onError?: (view: WriteErrorView, error: unknown) => void;
}

/**
 * Admin writes: `mutate(api => createX(api, ...), options)` → the API response, or undefined
 * after showing a fixed Dutch error toast. No optimistic updates: callers apply the response
 * or reload the authoritative data.
 */
export function useAdminMutation() {
  const { api, onUnauthorized } = useAdminApi();
  const [pending, setPending] = useState(0);

  const mutate = useCallback(
    async <T>(
      mutation: (api: ApiClient) => Promise<T>,
      options: MutateOptions<T> = {},
    ): Promise<T | undefined> => {
      setPending((n) => n + 1);
      try {
        const result = await runMutation(() => mutation(api), { onUnauthorized });
        if (result.ok) {
          const message =
            typeof options.success === "function" ? options.success(result.data) : options.success;
          if (message) toast.success(message);
          return result.data;
        }
        if (result.view.kind !== "aborted") toast.error(result.view.message);
        if (result.view.refresh) options.onStale?.(result.view);
        options.onError?.(result.view, result.error);
        return undefined;
      } finally {
        setPending((n) => n - 1);
      }
    },
    [api, onUnauthorized],
  );

  return { api, mutate, pending: pending > 0 };
}
