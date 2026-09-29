# Auth0 Migration (Phase 5)

This document describes the migration of **admin** authentication and authorization from Supabase Auth to Auth0. Customers never log in: all public pages and the booking flow stay anonymous.

## 1. Current implementation (Supabase Auth), before phase 5

| Concern          | File                                                           | Current behaviour                                                                                                                                                            |
| ---------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login            | `src/routes/admin-login.tsx:26`                                | E-mail and password form → `supabase.auth.signInWithPassword()`, then `navigate({ to: "/admin" })`. An error shows `error.message` in a toast.                               |
| Session storage  | `src/integrations/supabase/client.ts`, `previewAuthStorage.ts` | `supabase-js` keeps the access and refresh token in `localStorage` (brokered to the editor in the Lovable preview), with `autoRefreshToken: true`                            |
| Session loading  | `src/hooks/useAdminAuth.ts:28-45`                              | `onAuthStateChange` listener plus `getSession()` produce `{ user, isAdmin, loading }`                                                                                        |
| Role check       | `src/hooks/useAdminAuth.ts:17-24`                              | `from("user_roles").select("role").eq("user_id", uid).eq("role", "admin")`. It is only a UX check; the database's RLS (`has_role(auth.uid(), 'admin')`) is the real boundary |
| Admin guard      | `src/routes/admin.tsx`                                         | `loading` → "Laden..."; no user → `window.location.href = "/admin-login"`; user without admin role → "Geen toegang"; admin → `AdminLayout` + `Outlet`                        |
| Logout           | `src/components/admin/AdminLayout.tsx:28`                      | `supabase.auth.signOut()`, then `navigate({ to: "/admin-login" })`                                                                                                           |
| Admin data       | `src/routes/admin/*.tsx`                                       | `supabase.from(...)` with the admin's Supabase session; RLS allows it because of `user_roles`                                                                                |
| Server-side auth | `src/integrations/supabase/auth-middleware.ts`                 | Lovable template, **unused**                                                                                                                                                 |

## 2. Mapping: current → Auth0

| Concern                   | Current (Supabase)                                 | Auth0 (phase 5)                                                                                                                                                       |
| ------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity provider         | Supabase Auth (`auth.users`, password in Supabase) | **Auth0**, an external IdP. There is no password in our application or database.                                                                                      |
| Login UI                  | Own e-mail/password form                           | **Auth0 Universal Login** via `loginWithRedirect()` (Authorization Code Flow + PKCE)                                                                                  |
| Callback                  | —                                                  | Auth0 redirects to `/admin-login?code=…&state=…`; `Auth0Provider` exchanges the code, then `onRedirectCallback` navigates to `appState.returnTo` (default `/admin`)   |
| Session and token storage | `supabase-js` in `localStorage`                    | Managed by the **Auth0 SDK only**. Tokens are cached in memory, with refresh-token rotation. No custom token storage.                                                 |
| Session loading           | `onAuthStateChange` + `getSession()`               | `useAuth0()` → `isLoading`, `isAuthenticated`, `user`                                                                                                                 |
| Admin check (UX)          | `user_roles` query in the browser                  | `GET /api/admin/me` with the **access token**: 200 = admin, 403 = no permission, 401 = log in again. The frontend never decides authorization itself.                 |
| Real authorization        | RLS `has_role(auth.uid(), 'admin')` in Supabase    | **Backend**: JWT validated against the Auth0 JWKS (RS256, issuer, audience, expiry), then `requirePermission("admin:access")`                                         |
| Role model                | `user_roles` table + `app_role` enum               | **Auth0 RBAC**: permission `admin:access` on the API, role `admin` that holds it, and the role assigned to admin users. There is no user or role table in PostgreSQL. |
| User identifier           | `auth.users.id` (UUID)                             | Auth0 `sub` claim (**string**, e.g. `auth0\|…`). It is not stored.                                                                                                    |
| Logout                    | `supabase.auth.signOut()`                          | `logout({ logoutParams: { returnTo: <origin> } })`: clears the SDK cache and the Auth0 session, then returns to the public home page                                  |
| Guard redirect            | `window.location.href = "/admin-login"`            | Router navigation to `/admin-login` (with `returnTo`)                                                                                                                 |

## 3. Known intermediate state (phase 5 → phase 6)

> **The admin data pages do not work between phase 5 and phase 6.**

- The admin pages (`src/routes/admin/*.tsx`) still read and write through `supabase.from(...)`.
- Without a Supabase session they run as the **anon** role, and RLS then:
  - returns **no bookings** (agenda, reservations, dashboard);
  - rejects every admin write (services, vehicle types, blocked periods, gallery, settings).
- This follows directly from the phase plan: phase 5 replaces only authentication, and phase 6 moves admin CRUD to the own API.
- **This branch must not be deployed or merged to the Lovable `main` between phase 5 and phase 6.**
- The public website and the public booking flow are not affected.

## 4. ID token versus access token

|                      | ID token                                                     | Access token                                                                               |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Purpose              | Tells the **frontend** who logged in (profile: name, e-mail) | Lets the **frontend call the API** on the user's behalf                                    |
| Audience (`aud`)     | The SPA's client ID                                          | The API identifier (`AUTH0_AUDIENCE` = `VITE_AUTH0_AUDIENCE`)                              |
| Contains permissions | No                                                           | Yes (`permissions` claim, once RBAC with "Add Permissions in the Access Token" is enabled) |
| Sent to our API      | **Never**                                                    | Always, as `Authorization: Bearer <access token>`                                          |
| How the SPA gets it  | `useAuth0().user` (decoded by the SDK)                       | `getAccessTokenSilently()` (the audience is set in `Auth0Provider`)                        |

The backend rejects an ID token: its audience is the client ID, not the API identifier.

## 5. End-to-end flow

```
Browser (/admin)
  → AdminGuard: SDK says "not authenticated" → /admin-login?returnTo=/admin
  → "Inloggen" → loginWithRedirect({ appState: { returnTo } })
  → Auth0 Universal Login (authorization code + PKCE; the password is only typed at Auth0)
  → Auth0 → redirect to /admin-login?code=…&state=…
  → Auth0Provider exchanges the code at Auth0's /oauth/token (from the browser, no secret)
      ← ID token (profile, for the UI), access token (aud = API), refresh token (rotating)
  → onRedirectCallback → /admin (returnTo, only /admin paths allowed)
  → useAdminAuth: getAccessTokenSilently() → access token (from the SDK memory cache,
      or renewed with the refresh token)
  → GET {VITE_API_BASE_URL}/api/admin/me   Authorization: Bearer <access token>
  → API: extract the Bearer token → verify the JWT with the Auth0 JWKS (RS256, iss, aud, exp, nbf)
       → request.principal = { sub, permissions } → requirePermission("admin:access")
  ← 200 { data: { sub, permissions } }  → admin UI
  ← 403 AUTHORIZATION_REQUIRED          → "Geen toegang" (with a logout option)
  ← 401 AUTHENTICATION_*                → "Opnieuw inloggen" (explicit button, no redirect loop)
```

**Logout**: `logout({ logoutParams: { returnTo: <origin> } })`. The SDK clears its memory cache, Auth0 ends the session, and the browser returns to `/`.

**Where Auth0 runs**: only in the admin area. `Auth0Provider` is mounted in the root component **only** while the path is `/admin`, `/admin/*` or `/admin-login`, and **only in the browser**. Public pages never load or contact Auth0. During server rendering, admin pages render their loading state; the SDK starts after hydration.

| Component                                | Status after phase 5                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase Auth                            | **Removed from the admin flow**: no `signInWithPassword`, `getSession`, `onAuthStateChange`, `signOut` or `user_roles` query in the frontend |
| Supabase database                        | **Still present**: the public frontend (catalogue, gallery, reviews, booking wizard) and, until phase 6, the admin data pages use it         |
| `user_roles`, `has_role()`, `auth.users` | Unchanged in Supabase (not migrated, not deleted); **not used** by the new API                                                               |
| Auth0                                    | External identity provider (SaaS, not a container) and the source of admin identity and permissions                                          |
| Own API                                  | Authoritative for authorization: it checks every admin request                                                                               |

## 6. Tokens, storage and refresh

- **Storage**: only the official SDK (`@auth0/auth0-react` 2.27.0, on `@auth0/auth0-spa-js`) holds tokens, in **memory** (`cacheLocation: "memory"`, the default). Our code never writes a token, refresh token or password to `localStorage`, `sessionStorage` or a cookie.
- **Refresh tokens**: `useRefreshTokens: true` with **Refresh Token Rotation** enabled in Auth0 (see `docs/AUTH0-SETUP.md`).
  - Auth0 recommends rotation for SPAs: every use returns a new refresh token, and reuse of an old one revokes the whole chain.
  - This avoids depending on third-party cookies for silent renewal, which modern browsers increasingly block.
  - The refresh token lives only in memory.
- **After a page reload**:
  - The memory cache is empty. `useRefreshTokensFallback: true` then tries a silent renewal via the Auth0 session.
  - If the browser blocks that, the SDK reports "not authenticated", and the admin is sent to `/admin-login`. Clicking **Inloggen** with a still-active Auth0 session logs in without typing the password again.
  - This is a deliberate trade-off (memory over `localStorage`) for better XSS resistance.
- **Token expiry**: `getAccessTokenSilently()` renews the token automatically. If renewal is impossible (`login_required`, `missing_refresh_token`, `invalid_grant`, …), the UI shows "Opnieuw inloggen".
- **No client secret**: the SPA uses Authorization Code Flow with PKCE; there is no secret in the frontend.
- **No Management API**: the browser never calls it.

## 7. Backend validation (`apps/api/src/auth/`)

| File           | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verifier.ts`  | `jose` `jwtVerify` checks the **RS256** signature (other algorithms, including `HS256` and `none`, are rejected), `iss` = `https://<AUTH0_DOMAIN>/` (or `AUTH0_ISSUER`), `aud` = `AUTH0_AUDIENCE`, and `exp`/`nbf` with a 5 s clock tolerance; `sub` and `exp` are required. Keys come from a **remote, cached JWKS** at `https://<AUTH0_DOMAIN>/.well-known/jwks.json` (5 s timeout, 30 s refetch cooldown, 10 min maximum cache age). There are no hardcoded keys. |
| `principal.ts` | `Principal = { sub: string, permissions: string[], issuer, audience }`. `sub` is an opaque Auth0 string, not a UUID and not stored. `ADMIN_ACCESS = "admin:access"`.                                                                                                                                                                                                                                                                                                 |
| `plugin.ts`    | `authenticate` preHandler: extracts the Bearer token, verifies it and sets `request.principal`. `requirePermission(p)` checks the RBAC `permissions` claim. There are no e-mail, `sub` or role-name checks.                                                                                                                                                                                                                                                          |

**Error semantics.** Responses never reveal why a token was rejected; the server logs only a short reason code (e.g. `ERR_JWT_EXPIRED`), never the token.

| Situation                                                                                             | Status | Code                         |
| ----------------------------------------------------------------------------------------------------- | ------ | ---------------------------- |
| No `Authorization` header                                                                             | 401    | `AUTHENTICATION_REQUIRED`    |
| Malformed header or token; bad signature, issuer, audience, `exp` or `nbf`; wrong algorithm; no `sub` | 401    | `AUTHENTICATION_INVALID`     |
| Valid token without `admin:access`                                                                    | 403    | `AUTHORIZATION_REQUIRED`     |
| JWKS unreachable, or Auth0 not configured on the API                                                  | 503    | `AUTHENTICATION_UNAVAILABLE` |

401 responses include `WWW-Authenticate: Bearer` (with `error="invalid_token"` for rejected tokens).

**Configuration**:

- `AUTH0_DOMAIN` and `AUTH0_AUDIENCE` are **required in production**.
- `AUTH0_ISSUER` is optional (custom domains).
- Without Auth0 configuration (local development only), protected routes answer 503. They are never open.

**Public endpoints are unaffected**: catalogue, availability and `POST /api/bookings` do not look at the `Authorization` header at all.

## 8. Tests

**Backend** (`apps/api/test/auth.test.ts`, 16 tests):

- There is no real Auth0 tenant. RSA keys are generated per test run and served as a local JWKS; one test serves them over a local HTTP server to exercise the remote JWKS path.
- Covered:
  - no header, malformed headers, a bad or tampered signature, the wrong issuer, the wrong audience (ID-token style), expired and not-yet-valid tokens, `HS256` and `alg: none`, no `sub` → all 401;
  - no permission → 403; `admin:access` → 200 with only `sub` and `permissions`, and an opaque non-UUID `sub`;
  - public endpoints without a token and with an invalid one;
  - no Auth0 configuration → 503; JWKS unreachable → 503;
  - a CORS preflight with `Authorization`;
  - **tokens and the Authorization header never appear in the logs**.
- The config tests cover the Auth0 variables.

**Frontend** (root `npm test`, `node --test`, 11 tests):

- `src/lib/auth/auth-config.test.ts`: reading the public configuration, the API base URL, and `returnTo` sanitising (no open redirects).
- `src/lib/auth/admin-access.test.ts`:
  - the **access-token request** and the `Authorization: Bearer` header on `/api/admin/me`;
  - the mapping 200 → authorized, 401 → reauth, 403 → forbidden, 5xx → error;
  - a 200 without the permission and a malformed body are not treated as authorized;
  - token errors (`login_required`, `missing_refresh_token`, …) → reauth;
  - other token errors → error, without an API call;
  - network errors and a hanging request → error. **The UI can never keep loading forever.**

**Server rendering**: a smoke test was run against the Vite dev server with Auth0 configured. `/`, `/diensten`, `/reservatie`, `/admin-login`, `/admin` and `/admin/agenda` all rendered with **200** and no server errors. The admin pages rendered their loading state, and no password field was left.

**Not automated.** The repository has no browser or E2E runner (Playwright, Testing Library + DOM); adding one was out of scope. These parts must be **tested by hand**, following `docs/AUTH0-SETUP.md` §10:

- Auth0 Provider initialisation in the browser.
- The redirect to Universal Login and back (callback handling on `/admin-login`).
- Authenticated state, and the admin UI shown with `admin:access`.
- "Geen toegang" without the permission.
- Logout returning to `/`.
- Silent renewal after token expiry, and the behaviour after a page reload.
- The UI when Auth0 is unreachable during login: the button becomes clickable again; if the Auth0 page itself is down, the browser stays on Auth0's error page.
