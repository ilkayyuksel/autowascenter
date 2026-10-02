// One admin mutation, framework-free (tested without a DOM): run → success, or a fixed
// error view. A 401 notifies the admin guard; stale-data errors ask the page to refresh.
// No optimistic updates: the caller applies the API's response or reloads.

import { ApiError } from "./client.ts";
import { describeWriteError, type WriteErrorView } from "./errors.ts";

export type MutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: unknown; view: WriteErrorView };

export async function runMutation<T>(
  mutation: () => Promise<T>,
  { onUnauthorized }: { onUnauthorized: () => void },
): Promise<MutationResult<T>> {
  try {
    return { ok: true, data: await mutation() };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) onUnauthorized();
    return { ok: false, error, view: describeWriteError(error) };
  }
}
