import { createContext, useContext } from "react";

export interface AdminAuthSettings {
  /** false when VITE_AUTH0_* is incomplete: the admin UI shows a notice. */
  configured: boolean;
  /** Base URL of the self-hosted API (VITE_API_BASE_URL). */
  apiBaseUrl: string;
}

export const AdminAuthSettingsContext = createContext<AdminAuthSettings>({
  configured: false,
  apiBaseUrl: "http://localhost:3001",
});

export const useAdminAuthSettings = () => useContext(AdminAuthSettingsContext);
