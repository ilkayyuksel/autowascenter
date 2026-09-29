import { useAuth0, type User } from "@auth0/auth0-react";
import { useCallback, useEffect, useState } from "react";
import { useAdminAuthSettings } from "@/components/admin/admin-auth-settings";
import { fetchAdminAccess, type AdminAccess, type AdminMe } from "@/lib/auth/admin-access";

/**
 * Admin session state for the UI. This is UX only: the real authorization happens in the
 * backend, which checks the access token and the `admin:access` permission on every call.
 */
export type AdminAuthState =
  | { status: "misconfigured" }
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "reauth" }
  | { status: "forbidden"; user: User | undefined }
  | { status: "error" }
  | { status: "authorized"; user: User | undefined; me: AdminMe };

export function useAdminAuth() {
  const { configured, apiBaseUrl } = useAdminAuthSettings();
  const { isLoading, isAuthenticated, user, getAccessTokenSilently, loginWithRedirect, logout } =
    useAuth0();
  const [access, setAccess] = useState<AdminAccess | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!configured || isLoading || !isAuthenticated) return;
    let cancelled = false;
    setAccess(null);
    fetchAdminAccess(
      // Access token for VITE_AUTH0_AUDIENCE (set on Auth0Provider); never the ID token.
      () => getAccessTokenSilently({ timeoutInSeconds: 10 }),
      { baseUrl: apiBaseUrl },
    ).then((result) => {
      if (!cancelled) setAccess(result);
    });
    return () => {
      cancelled = true;
    };
  }, [configured, isLoading, isAuthenticated, getAccessTokenSilently, apiBaseUrl, attempt]);

  const login = useCallback(
    (returnTo = "/admin") => loginWithRedirect({ appState: { returnTo } }),
    [loginWithRedirect],
  );
  const signOut = useCallback(
    () => logout({ logoutParams: { returnTo: window.location.origin } }),
    [logout],
  );
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  let state: AdminAuthState;
  if (!configured) state = { status: "misconfigured" };
  else if (isLoading) state = { status: "loading" };
  else if (!isAuthenticated) state = { status: "unauthenticated" };
  else if (!access) state = { status: "loading" };
  else if (access.status === "authorized") state = { status: "authorized", user, me: access.me };
  else if (access.status === "forbidden") state = { status: "forbidden", user };
  else state = { status: access.status };

  return { state, login, logout: signOut, retry };
}
