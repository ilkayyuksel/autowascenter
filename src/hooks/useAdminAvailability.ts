import { useCallback, useEffect, useState } from "react";
import { useAdminLoad } from "@/hooks/useAdminLoad";
import { loadAdminAvailability } from "@/lib/api/admin-writes";
import type { AdminAvailabilityQueryInput } from "../../packages/shared/src/admin-write.ts";

type Availability = Awaited<ReturnType<typeof loadAdminAvailability>>;

/**
 * Free slots from GET /api/admin/availability (server-side, authoritative). `query` null =
 * not enough input yet (no request). The browser never computes slots for the admin.
 */
export function useAdminAvailability(query: AdminAvailabilityQueryInput | null) {
  const { api, state, run } = useAdminLoad();
  const [data, setData] = useState<Availability | null>(null);
  const key = query ? JSON.stringify(query) : null;

  const reload = useCallback(() => {
    if (!key) return;
    const q = JSON.parse(key) as AdminAvailabilityQueryInput;
    return run((signal) => loadAdminAvailability(api, q, { signal }), setData);
  }, [api, run, key]);

  useEffect(() => {
    setData(null);
    reload();
  }, [reload]);

  return { data: key ? data : null, state: key ? state : null, reload };
}
