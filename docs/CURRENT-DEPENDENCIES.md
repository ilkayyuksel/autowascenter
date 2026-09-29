# Current Dependencies (snapshot Fase 0)

Snapshot van 2026-09-28, commit `05ac806`.

- **VERSION** = het bereik uit `package.json`, met tussen haakjes de versie die geïnstalleerd werd met `npm install --no-package-lock` op de Fase-0-baseline.
- **Let op**: `package-lock.json` loopt **niet** gelijk met `package.json` (`npm ci` faalt). Lovable gebruikt `bun.lockb`; de exact vastgepinde productieversies zitten in dat binaire bestand.

**Statuswaarden**

- `TO BE REMOVED`: verdwijnt tijdens de migratie
- `TO BE REPLACED`: de functie blijft, de implementatie verandert
- `KEEP`: blijft
- `REVIEW`: beslissing nodig

## Lovable

| NAME                                | VERSION              | BESTAND(EN)                                                        | DOEL                                                                                                                                                                         | TARGET REPLACEMENT                                                                                                                                                         | STATUS         |
| ----------------------------------- | -------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `@lovable.dev/vite-tanstack-config` | `2.23.1` (2.23.1)    | `vite.config.ts`, `package.json` (dev)                             | Complete Vite-config: tanstackStart, React, Tailwind, tsconfig-paths, Cloudflare-build, componentTagger (dev), VITE\_-env-injectie, `@`-alias, error-logger, sandboxdetectie | Eigen `vite.config.ts` met expliciete plugins (`@tanstack/react-start/plugin/vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `vite-tsconfig-paths`) en een Node-target | TO BE REPLACED |
| Lovable preview-auth broker         | n.v.t. (gegenereerd) | `src/integrations/supabase/previewAuthStorage.ts`, `client.ts`     | Deelt de Supabase-sessie met de Lovable-editor via `postMessage` (preview-domeinen `lovable.app`, `lovableproject.com`, …)                                                   | Geen; vervalt met Supabase Auth                                                                                                                                            | TO BE REMOVED  |
| Lovable-gegenereerde sjablonen      | n.v.t.               | `src/integrations/supabase/auth-middleware.ts`, `client.server.ts` | Server-middleware en service-role-client (**ongebruikt**)                                                                                                                    | Geen                                                                                                                                                                       | TO BE REMOVED  |
| og:image op Lovable-R2              | n.v.t.               | `src/routes/__root.tsx:44-45`                                      | Afbeelding voor social sharing (preview-screenshot op `pub-…r2.dev`)                                                                                                         | Eigen afbeelding in `public/`                                                                                                                                              | TO BE REPLACED |
| gpt-engineer-app[bot] commits       | n.v.t.               | git-history                                                        | Lovable synchroniseert met GitHub `ilkayyuksel/autowascenter`                                                                                                                | Eigen workflow; Lovable-sync loskoppelen na de migratie                                                                                                                    | REVIEW         |

## Supabase

| NAME                         | VERSION              | BESTAND(EN)                                                                       | DOEL                                              | TARGET REPLACEMENT                                | STATUS         |
| ---------------------------- | -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- | -------------- |
| `@supabase/supabase-js`      | `^2.103.3` (2.117.2) | `src/integrations/supabase/client.ts` + 16 importerende bestanden (zie hieronder) | Database (PostgREST), auth, storage               | Eigen REST API + getypte client `src/api/*`       | TO BE REMOVED  |
| Supabase-types (gegenereerd) | PostgREST 14.5       | `src/integrations/supabase/types.ts`                                              | TypeScript-types van het DB-schema                | Types uit Drizzle-schema / gedeelde zod-schema's  | TO BE REPLACED |
| Supabase-project config      | n.v.t.               | `supabase/config.toml`                                                            | Project-ref                                       | Geen                                              | TO BE REMOVED  |
| Supabase-migraties           | 5 bestanden          | `supabase/migrations/*.sql`                                                       | Schema, RLS, storage-bucket, seeds, admin-account | Drizzle-migraties voor PostgreSQL (bronmateriaal) | TO BE REPLACED |
| Supabase env-variabelen      | n.v.t.               | `.env` (untracked), `.env.example`                                                | URL, anon-key, project-ref                        | `VITE_API_BASE_URL`, `DATABASE_URL`, …            | TO BE REPLACED |

Bestanden die `@/integrations/supabase/client` importeren: `src/hooks/useAdminAuth.ts`, `src/lib/slots.ts`, `src/components/{RealisationsPreview,ServicesPreview,Testimonials}.tsx`, `src/components/admin/AdminLayout.tsx`, `src/routes/{admin-login,diensten,galerij,reservatie}.tsx`, `src/routes/admin/{index,agenda,reservaties,diensten,voertuigen,blokkades,galerij,instellingen}.tsx`.

## Cloudflare

| NAME                      | VERSION            | BESTAND(EN)                                                     | DOEL                                                       | TARGET REPLACEMENT                                                    | STATUS        |
| ------------------------- | ------------------ | --------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- | ------------- |
| `@cloudflare/vite-plugin` | `^1.25.5` (1.62.0) | `package.json`, gebruikt via de Lovable-config                  | Build-target Cloudflare Workers                            | Node-server (nitro node-preset) in Docker                             | TO BE REMOVED |
| `wrangler` (transitief)   | (4.143.0)          | `wrangler.jsonc`, gegenereerd in `.output/server/wrangler.json` | Workers-config/deploy                                      | Docker Compose                                                        | TO BE REMOVED |
| `wrangler.jsonc`          | n.v.t.             | root                                                            | Workers-entry, `nodejs_compat`                             | Geen                                                                  | TO BE REMOVED |
| `nitro`                   | `3.0.260603-beta`  | `package.json`                                                  | Server-build van TanStack Start (nu met Cloudflare-preset) | Blijft, met `node-server`-preset. **Let op: beta-versie**, vastpinnen | REVIEW        |

## Authentication

| NAME                              | VERSION         | BESTAND(EN)                                                                                       | DOEL                                    | TARGET REPLACEMENT                                  | STATUS         |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- | -------------- |
| Supabase Auth (`supabase.auth.*`) | via supabase-js | `src/routes/admin-login.tsx`, `src/hooks/useAdminAuth.ts`, `src/components/admin/AdminLayout.tsx` | Login e-mail/wachtwoord, sessie, logout | `@auth0/auth0-react` (SPA, PKCE)                    | TO BE REPLACED |
| Tabel `user_roles` + `has_role()` | SQL             | migratie `20260418141959_…`, `useAdminAuth.ts`                                                    | Admin-rol                               | Auth0 RBAC-permissie + API-middleware (`jose`/JWKS) | TO BE REPLACED |
| Admin-account via SQL             | SQL             | migratie `20260418155052_…`                                                                       | Eerste admin                            | Handmatig in Auth0 (signups uit, MFA aan)           | TO BE REPLACED |

## Database

| NAME                                           | VERSION        | BESTAND(EN)             | DOEL                   | TARGET REPLACEMENT                 | STATUS              |
| ---------------------------------------------- | -------------- | ----------------------- | ---------------------- | ---------------------------------- | ------------------- |
| Supabase Postgres (beheerd door Lovable Cloud) | PostgREST 14.5 | alle data-calls         | Opslag van alle data   | PostgreSQL-container (bijv. 16/17) | TO BE REPLACED      |
| Row Level Security-policies                    | SQL            | `supabase/migrations/*` | Autorisatie            | Autorisatie in de backend          | TO BE REMOVED       |
| Triggers `update_updated_at_column`            | SQL            | migraties               | `updated_at` bijhouden | Trigger meenemen of ORM-default    | KEEP (herschrijven) |
| ORM                                            | ontbreekt      | —                       | —                      | Drizzle ORM + `pg` (voorstel)      | TO BE ADDED         |

## Storage

| NAME                               | VERSION         | BESTAND(EN)                                                          | DOEL                                                  | TARGET REPLACEMENT                                                         | STATUS         |
| ---------------------------------- | --------------- | -------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- | -------------- |
| Supabase Storage, bucket `gallery` | via supabase-js | `src/routes/admin/galerij.tsx:39,44,72`, migratie `20260418141959_…` | Upload, publieke URL en verwijderen van galerijfoto's | Upload-endpoint in de API + Docker-volume geserveerd door Caddy (of MinIO) | TO BE REPLACED |
| Lokale assets                      | n.v.t.          | `src/assets/*.jpg/png`, `public/favicon.ico`                         | Hero, logo, terugvalfoto's                            | Ongewijzigd                                                                | KEEP           |

## Externe services

| NAME                                  | VERSION   | BESTAND(EN)                                                                                                      | DOEL             | TARGET REPLACEMENT                              | STATUS        |
| ------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------- | ------------- |
| Google Fonts (Inter)                  | n.v.t.    | `src/routes/__root.tsx`                                                                                          | Lettertype       | Eventueel zelf hosten (GDPR/performance)        | REVIEW        |
| Google Maps embed                     | n.v.t.    | `src/routes/contact.tsx:190`, `src/routes/over-ons.tsx:138`                                                      | Kaart            | Ongewijzigd                                     | KEEP          |
| WhatsApp (`wa.me`), `tel:`, `mailto:` | n.v.t.    | `src/lib/site.ts`, `FloatingContactBar.tsx`, `CtaBanner.tsx`, `Footer.tsx`, `MobileStickyCTA.tsx`, `contact.tsx` | Contactlinks     | Ongewijzigd                                     | KEEP          |
| Instagram / Facebook-links            | n.v.t.    | `src/lib/site.ts`                                                                                                | Sociale links    | Ongewijzigd                                     | KEEP          |
| E-mail (SMTP)                         | ontbreekt | — (contactformulier en bevestigingsmail zijn niet geïmplementeerd)                                               | Notificaties     | SMTP-provider (bijv. Hostinger-mail) via de API | TO BE ADDED   |
| Cloudflare R2 (Lovable)               | n.v.t.    | `src/routes/__root.tsx`                                                                                          | og:image-hosting | Lokaal bestand                                  | TO BE REMOVED |

## Overige frontend-dependencies (blijven)

| NAME                                                                                                                                                                                                         | VERSION                                   | DOEL                                                                  | STATUS                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------- | ---------------------- |
| `@tanstack/react-start`                                                                                                                                                                                      | `^1.167.14` (1.168.59)                    | SSR-framework                                                         | KEEP                   |
| `@tanstack/react-router` / `@tanstack/router-plugin`                                                                                                                                                         | `^1.168.0` / `^1.167.10`                  | Routing                                                               | KEEP                   |
| `@tanstack/react-query`                                                                                                                                                                                      | `^5.83.0` (5.104.0)                       | Geïnstalleerd, **ongebruikt**. Kandidaat voor de API-laag in Fase 1/3 | REVIEW                 |
| `react` / `react-dom`                                                                                                                                                                                        | `^19.2.0` (19.3.0)                        | UI                                                                    | KEEP                   |
| `vite`                                                                                                                                                                                                       | `^7.3.1` (7.3.6)                          | Bundler                                                               | KEEP                   |
| `tailwindcss`, `@tailwindcss/vite`, `tw-animate-css`                                                                                                                                                         | `^4.2.1`                                  | Styling                                                               | KEEP                   |
| `@radix-ui/*`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner`, `cmdk`, `vaul`, `embla-carousel-react`, `input-otp`, `react-day-picker`, `react-resizable-panels`, `recharts` | zie `package.json`                        | shadcn/ui-componenten (veel ongebruikt)                               | KEEP (later opschonen) |
| `react-hook-form`, `@hookform/resolvers`, `zod`                                                                                                                                                              | `^7.72.1`, `^5.2.2`, `^4.3.6` (zod 4.6.5) | Formulieren/validatie; zod is herbruikbaar in de backend              | KEEP                   |
| `date-fns`                                                                                                                                                                                                   | `^4.1.0`                                  | Datums                                                                | KEEP                   |
