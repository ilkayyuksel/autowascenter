import { createContext, useContext } from "react";
import type { ApiClient } from "@/lib/api/client";

export interface AdminApiContextValue {
  /** API client whose getAdmin() adds the Auth0 access token. */
  api: ApiClient;
  /** A 401 from the API: let the admin guard re-check the session (it shows the login). */
  onUnauthorized: () => void;
  /** Start a new Auth0 login that returns to the current admin page. */
  login: () => void;
}

export const AdminApiContext = createContext<AdminApiContextValue | null>(null);

/** Only available inside the authorized admin area (provided by the /admin guard). */
export function useAdminApi(): AdminApiContextValue {
  const value = useContext(AdminApiContext);
  if (!value) throw new Error("useAdminApi must be used inside the admin area");
  return value;
}
