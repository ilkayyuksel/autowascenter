import { useAuth0 } from "@auth0/auth0-react";
import { useMemo, type ReactNode } from "react";
import { createApiClient } from "@/lib/api/client";
import { useAdminAuthSettings } from "./admin-auth-settings";
import { AdminApiContext } from "./admin-api-context";

/**
 * Provides the admin API client to the admin pages. Uses the existing Auth0 provider (no
 * second provider): access tokens come from getAccessTokenSilently for VITE_AUTH0_AUDIENCE,
 * held in memory by the SDK. Nothing is stored by this code.
 */
export function AdminApiProvider({
  onUnauthorized,
  login,
  children,
}: {
  onUnauthorized: () => void;
  login: () => void;
  children: ReactNode;
}) {
  const { apiBaseUrl } = useAdminAuthSettings();
  const { getAccessTokenSilently } = useAuth0();

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl,
        // Access token (never the ID token), same call as the session check in useAdminAuth.
        getAccessToken: () => getAccessTokenSilently({ timeoutInSeconds: 10 }),
      }),
    [apiBaseUrl, getAccessTokenSilently],
  );
  const value = useMemo(() => ({ api, onUnauthorized, login }), [api, onUnauthorized, login]);

  return <AdminApiContext.Provider value={value}>{children}</AdminApiContext.Provider>;
}
