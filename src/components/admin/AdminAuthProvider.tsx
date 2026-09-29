import { Auth0Provider, type AppState } from "@auth0/auth0-react";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { readApiBaseUrl, readAuth0Config, sanitizeReturnTo } from "@/lib/auth/auth-config";
import { AdminAuthSettingsContext, type AdminAuthSettings } from "./admin-auth-settings";

// Public build-time values (VITE_*); see docs/AUTH0-SETUP.md. Never a client secret.
const auth0Config = readAuth0Config(import.meta.env);
const apiBaseUrl = readApiBaseUrl(import.meta.env);

/**
 * Auth0 for the admin area only (/admin, /admin/*, /admin-login); public pages never load it.
 *
 * - Mounted once in the root component while an admin path is shown, so the same session
 *   survives navigation between /admin-login and /admin.
 * - Not created during server rendering (the Auth0 SPA SDK needs a browser). On the server,
 *   children see the SDK's default context (isLoading: true), which matches the client's
 *   first render, so hydration is consistent.
 * - Tokens are held by the SDK in memory, with refresh-token rotation (useRefreshTokens).
 *   No token is ever written to storage by our code.
 */
export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const settings: AdminAuthSettings = { configured: auth0Config !== null, apiBaseUrl };

  if (!auth0Config || typeof window === "undefined") {
    return (
      <AdminAuthSettingsContext.Provider value={settings}>
        {children}
      </AdminAuthSettingsContext.Provider>
    );
  }

  const onRedirectCallback = (appState?: AppState) => {
    // Replaces /admin-login?code=…&state=… so the one-time code is removed from the URL.
    navigate({ to: sanitizeReturnTo(appState?.returnTo) as "/admin", replace: true });
  };

  return (
    <AdminAuthSettingsContext.Provider value={settings}>
      <Auth0Provider
        domain={auth0Config.domain}
        clientId={auth0Config.clientId}
        authorizationParams={{
          redirect_uri: `${window.location.origin}/admin-login`,
          audience: auth0Config.audience,
        }}
        cacheLocation="memory"
        useRefreshTokens
        useRefreshTokensFallback
        onRedirectCallback={onRedirectCallback}
      >
        {children}
      </Auth0Provider>
    </AdminAuthSettingsContext.Provider>
  );
}
