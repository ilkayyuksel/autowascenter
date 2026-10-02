# Auth0 Setup (manual, Auth0 Dashboard)

These steps must be done by hand in the Auth0 Dashboard (<https://manage.auth0.com>). The repository contains **no credentials**; fill in your own values in local `.env` files (not committed) or in the server environment.

**Development URLs**:

- **Frontend**: `http://localhost:8080`. `@lovable.dev/vite-tanstack-config` sets `server.port: 8080` for `npm run dev` in the repository root.
- **API**: `http://localhost:3001` (`apps/api`, `PORT` default).

For production, add the real origins next to the development ones (e.g. `https://autowascenter.be`, `https://www.autowascenter.be`).

## 1. Create the application (the frontend)

1. **Applications → Applications → Create Application**.
2. Name: e.g. `Autowascenter Admin`. Type: **Single Page Web Applications**.
3. Under **Settings**, configure the URLs from step 3.
4. Under **Settings → Credentials**, check that the authentication method is **None**. A SPA has no client secret. **Never** put a client secret in the frontend or in any `VITE_*` variable.
5. Note the **Domain** and the **Client ID**. They are public values.

## 2. Create the API (the backend)

1. **Applications → APIs → Create API**.
2. Name: e.g. `Autowascenter API`.
3. **Identifier**: e.g. `https://api.autowascenter.be`. This is the **audience**. It never needs to resolve, and it **cannot be changed later**.
4. **Signing Algorithm**: **RS256**.
5. Under **Settings → RBAC Settings**:
   - **Enable RBAC**: on.
   - **Add Permissions in the Access Token**: on. Without it, the token carries no `permissions` claim and every admin call returns 403.
6. Under **Application Access** (or **Machine to Machine / User Access** in older UIs), allow the SPA from step 1 to request tokens for this API.

The identifier must be **exactly** the same in:

- `AUTH0_AUDIENCE` (API, `apps/api/.env`)
- `VITE_AUTH0_AUDIENCE` (frontend, root `.env`)

A mismatch makes every admin call fail with 401: the token's `aud` is then not the API.

## 3. Configure the SPA URLs (application from step 1 → Settings)

| Field                     | Development value                   | Why                                                                             |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| **Allowed Callback URLs** | `http://localhost:8080/admin-login` | Auth0 redirects here with `?code=…&state=…`; `/admin-login` completes the login |
| **Allowed Logout URLs**   | `http://localhost:8080`             | Logout returns to the public home page                                          |
| **Allowed Web Origins**   | `http://localhost:8080`             | Needed for silent token renewal from the browser                                |

For production, **add** (do not replace) the values for the deployed domain, comma
separated. `<DOMAIN>` is the value of `DOMAIN` in `deploy/.env`; nothing in the source code
hardcodes the production host.

| Field                     | Production value to add        |
| ------------------------- | ------------------------------ |
| **Allowed Callback URLs** | `https://<DOMAIN>/admin-login` |
| **Allowed Logout URLs**   | `https://<DOMAIN>`             |
| **Allowed Web Origins**   | `https://<DOMAIN>`             |

With `DOMAIN=autowascenter.be` that is `https://autowascenter.be/admin-login`,
`https://autowascenter.be` and `https://autowascenter.be`. Add the `www` host too only if
visitors can reach the admin there; the Docker stack redirects `www` to the bare domain, so
it is not needed.

These are **manual Dashboard changes**: the deployment never edits the Auth0 tenant. The
matching environment variables (`AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `VITE_AUTH0_*`) live in
`deploy/.env`; see `deploy/README.md`. The API and the SPA need **no client secret**.

**Refresh Token Rotation** (Settings → Refresh Token Rotation):

- **Rotation**: on. The frontend uses `useRefreshTokens` with an in-memory cache; see `docs/AUTH0-MIGRATION.md`.
- **Reuse interval**: default.
- Set an **absolute lifetime** and an **inactivity lifetime** that match the business policy, e.g. 7 days absolute and 1 day inactivity.

## 4. RBAC permission

1. **Applications → APIs → Autowascenter API → Permissions**.
2. Add the permission `admin:access`, description "Access the admin area and admin API".

This is the only permission in phase 5. Finer permissions (e.g. `bookings:write`) can follow in phase 6.

## 5. Role

1. **User Management → Roles → Create Role**.
2. Name: `admin`. Description: "Autowascenter administrator".
3. **Permissions → Add Permissions**: choose the API from step 2, then `admin:access`.

The backend only checks the **permission**, never the role name, an e-mail address or a user id. The role is just a convenient way to hand out the permission.

## 6. Admin users

1. **User Management → Users → Create User**.
   - Connection: `Username-Password-Authentication`, or a social or enterprise connection if preferred.
   - The old Supabase admin account (`admin@autowascenter.be`) is **not** migrated automatically, and neither are passwords. Create the user again, or invite them.
2. Open the user → **Roles → Assign Roles** → `admin`.

## 7. Disable public signup

The admin area is for staff only. Customers never log in.

- **Authentication → Database → Username-Password-Authentication → Settings**: turn on **Disable Sign Ups**.
- Do the same for other connections that allow self-registration, or disable them for this application (**Applications → … → Connections**).

Even if someone did sign up, they would have no `admin:access` permission and would get **403**.

## 8. Recommended hardening

- **MFA** (Security → Multi-factor Auth): require it for admin users.
- **Attack protection** (Security → Attack Protection): enable brute-force protection and breached-password detection.
- **Custom domain** (e.g. `login.autowascenter.be`), optional. If used:
  - set `VITE_AUTH0_DOMAIN` and `AUTH0_DOMAIN` to the custom domain;
  - set `AUTH0_ISSUER` to `https://login.autowascenter.be/`.

## 9. Environment variables

| Variable               | Where                         | Secret?                    | Value                                                                  |
| ---------------------- | ----------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| `VITE_AUTH0_DOMAIN`    | Frontend (root `.env`, build) | No, ends up in the browser | Tenant domain, e.g. `your-tenant.eu.auth0.com`                         |
| `VITE_AUTH0_CLIENT_ID` | Frontend                      | No                         | SPA Client ID (step 1)                                                 |
| `VITE_AUTH0_AUDIENCE`  | Frontend                      | No                         | API Identifier (step 2)                                                |
| `VITE_API_BASE_URL`    | Frontend                      | No                         | e.g. `http://localhost:3001`                                           |
| `AUTH0_DOMAIN`         | API (`apps/api/.env`)         | No                         | Same domain (no `https://`)                                            |
| `AUTH0_AUDIENCE`       | API                           | No                         | Same API Identifier                                                    |
| `AUTH0_ISSUER`         | API                           | No                         | Optional; only with a custom domain. Default `https://<AUTH0_DOMAIN>/` |

No Auth0 client secret or Management API credentials are needed anywhere in this application. The API only verifies tokens with Auth0's public signing keys (`https://<AUTH0_DOMAIN>/.well-known/jwks.json`).

## 10. End-to-end check (manual)

1. Start the API with `AUTH0_*` set (`cd apps/api && npm run dev`, with `DATABASE_URL` pointing to a PostgreSQL).
2. Start the frontend with `VITE_AUTH0_*` and `VITE_API_BASE_URL` set (`npm run dev` in the root).
3. Open `http://localhost:8080/admin`. You are redirected to `/admin-login`. Click **Inloggen**, which takes you to Auth0 Universal Login.
4. Log in as a user **with** the `admin` role. You return to `/admin` and the admin layout is shown. The browser's network tab shows `GET /api/admin/me` → 200 with `Authorization: Bearer …`.
5. Log in as a user **without** the role. You see "Geen toegang", and `/api/admin/me` returns 403.
6. Click **Uitloggen**. You return to `/`, and opening `/admin` again sends you back to `/admin-login`.
