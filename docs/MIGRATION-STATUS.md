# Migration Status

Migratie van het Lovable/Supabase-project naar een self-hosted platform met Docker Compose.

| Fase                                    | Status                           |
| --------------------------------------- | -------------------------------- |
| Fase 0: beveiligen + baseline           | **Afgerond** (zie _Completed_)   |
| Fase 0.5: reproduceerbare baseline      | **Afgerond** (zie _Baseline v1_) |
| Fase 1: data-access-laag in de frontend | Niet gestart                     |
| Fase 2–11                               | Niet gestart                     |

## Current architecture

- **Frontend**: TanStack Start (React 19, SSR-framework op Vite 7), TypeScript strict, file-based routing via `@tanstack/react-router` (`src/routes/`, gegenereerde `src/routeTree.gen.ts`). UI: Tailwind v4, shadcn/ui (Radix), lucide-react, sonner. Formulieren: react-hook-form + zod (alleen reservatie en contact). State: lokale `useState`/`useEffect`; react-query is geïnstalleerd maar ongebruikt.
- **Data**: alle databasetoegang loopt **rechtstreeks van de browser naar Supabase PostgREST** via `src/integrations/supabase/client.ts` (16 bestanden). Er is geen eigen API. Autorisatie gebeurt volledig via Postgres Row Level Security en `public.has_role()`.
- **Backend**: geen. `src/integrations/supabase/auth-middleware.ts` en `client.server.ts` zijn Lovable-sjablonen die nergens gebruikt worden.
- **Auth**: Supabase Auth (e-mail + wachtwoord), sessie in `localStorage`, rolcheck in de client via de tabel `user_roles`.
- **Opslag**: Supabase Storage, publieke bucket `gallery`.
- **Build/hosting**: `@lovable.dev/vite-tanstack-config`, Cloudflare Workers (`wrangler.jsonc`, `@cloudflare/vite-plugin`).
- **Database**: Supabase Postgres, schema in `supabase/migrations/` (5 migraties): 11 tabellen, 2 enums, 2 functies, 8 `updated_at`-triggers, RLS-policies en storage-policies.

## Target architecture

```
Internet ──HTTPS──► Caddy (reverse proxy, automatische Let's Encrypt-certificaten)
                     ├── /            ► web  (React/TanStack Start, Node-server of statische SPA)
                     ├── /api/*       ► api  (Node + TypeScript REST API)
                     └── /uploads/*   ► volume met gallery-afbeeldingen
                    api ──► PostgreSQL (container, persistent volume, dagelijkse pg_dump-back-up)
                    web/api ──► Auth0 (OIDC/JWT; alleen admins loggen in)
```

- **Frontend**: bestaande React/Vite-code; alle `supabase.*`-calls vervangen door een getypte REST-client (`src/api/*`). Auth0 SPA SDK (PKCE) voor de admin.
- **Backend API**: Node + TypeScript (Fastify of Hono), zod-validatie, Drizzle ORM. Voert de logica voor beschikbaarheid, prijs en boekingen server-side uit, in transacties. Valideert het Auth0-JWT via JWKS en dwingt de admin-rol af.
- **PostgreSQL**: eigen container; schema afgeleid van de Supabase-migraties, zonder `auth.*`, `storage.*` en RLS.
- **Auth0**: tenant met SPA-applicatie + API (audience), signups uitgeschakeld, RBAC-rol/permissie `admin`.
- **Caddy**: TLS-terminatie, routing, security-headers, statische uploads.
- **Docker Compose**: services `web`, `api`, `db`, `caddy`, plus een back-upjob; secrets in een `.env` op de server die niet in git staat.
- **DNS**: domein bij Hostinger, A/AAAA-record naar de eigen Linux-server.

## Completed

Fase 0 (alleen beveiliging en documentatie, geen functionele wijzigingen):

- [x] Secret-scan van de working tree en de volledige git-history (alleen Supabase **anon**-JWT's gevonden, geen service-role-key).
- [x] Plaintext admin-wachtwoord verwijderd uit `supabase/migrations/20260418155052_720bb2c2-….sql`: vervangen door een willekeurig, onbekend wachtwoord (`crypt(gen_random_uuid()::text, …)`). Deze migratie is op de live DB al uitgevoerd en wordt niet opnieuw gedraaid.
- [x] `.gitignore` uitgebreid voor productie (`.env`, `.env.*`, `!.env.example`, `node_modules/`, `dist/`, `build/`, `coverage/`, `logs/`, `uploads/`, back-ups, sleutels).
- [x] `.env` uit de git-index gehaald (`git rm --cached`); het lokale bestand blijft bestaan.
- [x] `.env.example` met alleen placeholders.
- [x] `docs/MIGRATION-STATUS.md` en `docs/CURRENT-DEPENDENCIES.md`.
- [x] Git- en build-baseline vastgelegd (zie hieronder).

### Baseline v0 (2026-09-28, commit `05ac806`, Node 22.18.0, npm 10.9.3)

Historisch, vervangen door _Baseline v1_. Deze metingen gebruikten `npm install --no-package-lock` en dus niet-vastgepinde versies. Alle problemen bestonden al vóór Fase 0; Fase 0 wijzigde geen `.ts`/`.tsx`-bestanden.

| Check                           | Resultaat                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                        | **FAALT**: `package-lock.json` loopt niet gelijk met `package.json` (o.a. `@emnapi/runtime`, `@cloudflare/workerd-*` ontbreken; lock bevat zod 3 / lovable-config 1.2.0, terwijl package.json ^4 / 2.23.1 vraagt en `@supabase/supabase-js` en `nitro` ontbreken). Lovable gebruikt `bun.lockb`.                                               |
| `npm install --no-package-lock` | OK (457 packages; lockfile niet gewijzigd)                                                                                                                                                                                                                                                                                                     |
| `npm run build`                 | **OK** (Vite client + SSR + nitro, Cloudflare-preset → `.output/`). Waarschuwingen: "use client"-directives genegeerd, `Unknown input options: platform`, "Wrangler config main is overridden".                                                                                                                                                |
| `npm run lint`                  | **FAALT**: 10 846 problemen, waarvan 10 835 prettier-`␍` (CRLF door `core.autocrlf=true` op Windows; de index is LF). Met `endOfLine: auto`: 995 prettier-formatfouten in 36 bronbestanden, 1 `prefer-const` (`previewAuthStorage.ts:38`), 3 `no-explicit-any` (`agenda.tsx:519`, `reservatie.tsx:233-234`), 7 `react-refresh`-waarschuwingen. |
| `npm run typecheck`             | Script bestaat niet. `npx tsc --noEmit` **FAALT** met 1 fout: `src/router.tsx(63,5) TS2322`, `DefaultErrorComponent` verwacht `error: Error`, maar TanStack Router geeft `error: unknown`.                                                                                                                                                     |

## Baseline v1

Datum: 2026-09-29 · Node v22.18.0 · npm 10.9.3 · Windows 11 (win32-x64)

| Onderdeel       | Status                                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch          | `migration/self-hosted` (afgesplitst van `main` @ `05ac806`, niet gepusht)                                                                                                                                        |
| Package manager | **npm**. `bun.lockb` blijft als historisch Lovable-materiaal, maar is niet nodig voor de build.                                                                                                                   |
| Lockfile        | `package-lock.json` **v3**, gegenereerd met `npm install --package-lock-only`; alle 71 directe dependencies passen binnen de bereiken in `package.json`; bevat de Linux-binaries (gnu + musl) voor Docker-builds. |
| `npm ci`        | **PASS**. Schone installatie nadat `node_modules` verwijderd was, 512 packages. `npm ls` meldt 1 extraneous (`@emnapi/runtime@1.11.3`, optionele WASM-runtime).                                                   |
| Build           | **PASS**: `npm run build` → `BUILD_EXIT=0` (client 25,6 s, SSR 2,7 s, nitro 7,6 s; preset `cloudflare-module` → `.output/`)                                                                                       |
| Lint            | **FAIL** (bestaand): 1011 problemen, 0 door line-endings. 1000 prettier-formatfouten in 36 bestanden, 3 `no-explicit-any` en 1 `prefer-const` als echte codeproblemen, 7 `react-refresh`-waarschuwingen.          |
| TypeScript      | **PASS**: `npx tsc --noEmit` → exit 0 met de vastgepinde versies (zie _Known functional issues_ #18).                                                                                                             |
| Line endings    | `.gitattributes` (`* text=auto eol=lf`). De index was al LF; de working tree is nu ook LF. De 10 835 CRLF-meldingen uit Baseline v0 zijn verdwenen.                                                               |

**Bestaande issues in deze baseline (bewust niet opgelost):**

- **Lint**: `no-explicit-any` op `src/routes/admin/agenda.tsx:519` en `src/routes/reservatie.tsx:233-234`; `prefer-const` op `src/integrations/supabase/previewAuthStorage.ts:38`; `react-refresh/only-export-components` in 6 shadcn-bestanden en in `src/router.tsx`; 1000 prettier-formatfouten (geen automatische herformattering gedaan).
- **Buildwaarschuwingen**: zod-annotaties die Rollup niet kan interpreteren (`zod/v4/core/util.js`, `regexes.js`), genegeerde `"use client"`-directives, `Unknown input options: platform`, "Wrangler config main is overridden", ongebruikte imports in `@tanstack/start-*`.
- **Semver-bereiken**: 69 van de 71 directe dependencies gebruiken `^`. Alleen `@lovable.dev/vite-tanstack-config` (`2.23.1`) en `nitro` (`3.0.260603-beta`) staan exact vast. `package-lock.json` legt de feitelijke versies vast; aanpassen gebeurt later.
- **Build-target**: de build maakt nog een Cloudflare Workers-bundle (`defaultPreset: "cloudflare-module"` via `@lovable.dev/vite-tanstack-config`). `@cloudflare/vite-plugin` wordt buiten de Lovable-sandbox niet geladen.
- **Execution environment**: in de werkomgeving van de assistent gaf de automatische permissiecheck bij meerdere pogingen geen antwoord voor `npm run build`. Het project zelf bouwt probleemloos; zie het rapport van Fase 0.5.

## Next phase

**Supabase database/schema/data inventory and migration preparation.**

Doel: het live Supabase-schema, de policies, de data en de storage-bucket exporteren en vergelijken met `supabase/migrations/`, als basis voor het PostgreSQL-schema. Nog geen backend, Auth0 of Docker.

## Pending

- [ ] **Admin-wachtwoord op de live Supabase-database wijzigen** (handmatig, buiten de repo).
- [ ] Beslissen over het opschonen van de git-history (zie _Known security issues_).
- [ ] Het live schema en de policies exporteren en vergelijken met `supabase/migrations/`.
- [ ] Een export maken van alle data en de bestanden in de storage-bucket `gallery`.
- [x] ~~Lockfile-strategie kiezen~~: npm + `package-lock.json` (zie _Baseline v1_).
- [ ] Fase 1: alle `supabase.*`-calls achter `src/api/*` zetten, zonder gedragswijziging.
- [ ] Fase 2: PostgreSQL-schema (Drizzle) · Fase 3: API-skelet + publieke reads · Fase 4: boekingen server-side · Fase 5: Auth0 · Fase 6: admin-endpoints + uploads · Fase 7: Supabase/Lovable/Cloudflare verwijderen · Fase 8: Docker Compose · Fase 9: datamigratie · Fase 10: productie + DNS · Fase 11: e-mail, contactformulier, annuleerlink.

## Known security issues

1. **Admin-wachtwoord staat in de git-history** (commit `fb5c91f`, bestand `supabase/migrations/20260418155052_…sql`, regel 23 in die versie). Het wachtwoord in de live DB moet gewijzigd worden. Opschonen van de history is optioneel zodra het wachtwoord gewijzigd is (repo op GitHub: `ilkayyuksel/autowascenter`).
2. **`.env` staat nog in de git-history** (Supabase URL, project-ref en anon-key). Dat is laag risico, want de anon-key zit sowieso in de publieke frontendbundel. Wel misbruikbaar in combinatie met punt 3.
3. **Anonieme `INSERT` op `bookings` en `booking_services` met `WITH CHECK (true)`**: de client bepaalt `total_price`, `status`, `location_fee` en `cancel_token`, en kan `booking_services` aan een willekeurige `booking_id` koppelen.
4. **Geen rate limiting of captcha** op het aanmaken van boekingen, dus spam is mogelijk.
5. **Admin-guard werkt alleen in de client** (`src/routes/admin.tsx`); de werkelijke bescherming is RLS. De nieuwe backend moet dit zelf afdwingen.
6. **Geen 2FA of wachtwoordbeleid** voor het admin-account.
7. De `og:image` wijst naar een Lovable preview-URL op R2 (het lekt een project-ID; geen secret).

## Known functional issues

Moeten vóór productie opgelost worden:

1. **Dubbele boekingen**: de publieke wizard leest `bookings` als anon; RLS staat dat alleen toe voor admins. Anon ziet dus 0 boekingen en alle slots lijken vrij (`src/lib/slots.ts` `fetchSlotData`).
2. **Geen server-side overlapcheck**: de conflictcheck gebeurt alleen in de client, waardoor race conditions mogelijk zijn.
3. **Mogelijk falende publieke boeking**: `insert(...).select("id")` vereist SELECT-rechten die anon niet heeft (`src/routes/reservatie.tsx:332`). Nog te verifiëren op de live site.
4. **Schrijfacties in meerdere stappen zijn niet atomair**: booking + booking_services; pakketinhoud (delete-then-insert); dienst + prijsrijen; prijsmatrix (fouten worden genegeerd).
5. `end_time = start + duur` kan boven 24:00 uitkomen (bijv. `"25:00"`) bij diensten die meerdere dagen duren. De agenda toont zo'n boeking alleen op de startdag.
6. Meerdaagse diensten lopen door op zondag; zondag is ook boekbaar, terwijl de site "Gesloten" vermeldt.
7. Openingsuren staan op 4 plekken die elkaar tegenspreken: `src/lib/site.ts` (09–18), DB-default (08–22), terugval in de code (10–21), agendaraster (10–21, hardcoded).
8. Tijdzone: "vandaag" wordt als UTC-datum berekend (`toISOString`), waardoor tussen 00:00 en 02:00 in België de verkeerde dag gekozen wordt.
9. `location_fee` is altijd 0; er wordt geen km-afstand berekend.
10. Btw van 21% is hardcoded in de frontend.
11. Een bevestigingsmail wordt beloofd, maar er is geen e-mailcode; `notification_email` en `cancel_token` worden niet gebruikt.
12. Het contactformulier is gesimuleerd en verstuurt niets.
13. Handmatig aanmaken in `/admin/reservaties` slaat de slotcheck, `booking_services` en `end_time` over.
14. Een voertuigtype verwijderen faalt als er boekingen naar verwijzen (FK zonder `ON DELETE`).
15. Er is geen beheer-UI voor reviews (`/admin/reviews` stuurt door naar `/admin`).
16. `/admin/reservaties` laadt alle boekingen zonder paginatie.
17. ~~**Build-tooling**: `package-lock.json` loopt niet gelijk met `package.json`~~. Opgelost in Fase 0.5 (zie _Baseline v1_).
18. **Versiegevoeligheid**: met nieuwere `@tanstack/router-core` (≥ 1.170) faalt `tsc` op `src/router.tsx:63` (`DefaultErrorComponent` verwacht `error: Error`, nieuwere router geeft `unknown`). Met de vastgepinde 1.168.15 is er geen fout. Bij een upgrade eerst dit oplossen.

## Database migration requirements

Uit Supabase naar PostgreSQL:

- **Tabellen (schema + data)**: `services`, `package_services`, `vehicle_types`, `vehicle_type_services`, `bookings`, `booking_services`, `blocked_periods`, `site_settings`, `gallery_items`, `reviews`, `user_roles` (die laatste wordt vervangen of omgevormd, zie Auth).
- **Enums**: `booking_status` (nieuw, bevestigd, voltooid, geannuleerd), `app_role` (admin, user).
- **Constraints/indexen**: alle PK's, FK's (met CASCADE/SET NULL), UNIQUE (`vehicle_types.slug`, `(vehicle_type_id, service_id)`, `(package_id, service_id)`), CHECK `reviews.rating` 1–5, indexen op `bookings(preferred_date, vehicle_type_id, cancel_token)`, `blocked_periods(start_date, end_date)` en `vehicle_type_services`.
- **Functies/triggers**: `update_updated_at_column()` + 8 triggers (of `updated_at` in de ORM). `has_role()` vervalt.
- **Niet meenemen**: RLS-policies (worden autorisatie in de backend), `auth.users`/`auth.identities`, `storage.buckets`/`storage.objects`, GRANTs aan `anon`/`authenticated`/`service_role`.
- **Voorgestelde verbeteringen** (bewust, gedocumenteerd): `preferred_time`/`end_time`/`start_time` als `time` in plaats van `text`, CHECK op `services.kind` (dienst, pakket, extra), `site_settings` beperkt tot één rij, `ON DELETE` op `bookings.vehicle_type_id`, bescherming tegen overlappende boekingen.
- **Storage**: alle objecten uit de bucket `gallery` downloaden naar een uploads-volume en `gallery_items.image_url` herschrijven naar het nieuwe domein.
- **Seeddata**: diensten, voertuigtypes, prijsmatrix en settings komen uit de live data, niet uit de seeds in de migraties.

## Authentication migration

| Nu (Supabase Auth)                                                                       | Straks (Auth0)                                                                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `supabase.auth.signInWithPassword` in `src/routes/admin-login.tsx`                       | `loginWithRedirect()` via `@auth0/auth0-react` (Universal Login, PKCE)                    |
| Sessie in `localStorage` + automatisch vernieuwen (`client.ts`, `previewAuthStorage.ts`) | Auth0 SDK beheert tokens; access token met `audience` van de API                          |
| `supabase.auth.getSession` / `onAuthStateChange` in `src/hooks/useAdminAuth.ts`          | `useAuth0()` (`isAuthenticated`, `getAccessTokenSilently`)                                |
| Rolcheck via tabel `user_roles` (client)                                                 | Rol/permissie in het Auth0-token (RBAC); de UI leest de claim en de **backend dwingt af** |
| `supabase.auth.signOut` in `src/components/admin/AdminLayout.tsx`                        | `logout({ logoutParams: { returnTo } })`                                                  |
| RLS `has_role(auth.uid(), 'admin')`                                                      | API-middleware: JWT verifiëren (issuer, audience, JWKS) + permissie `admin`               |
| Admin-account via SQL-migratie                                                           | Gebruiker handmatig aanmaken in Auth0, signups uit, MFA aan                               |
| `user_roles.user_id uuid → auth.users`                                                   | Vervalt, of wordt `auth0_sub text` als lokale rollen nodig zijn                           |

Klanten loggen niet in; publieke endpoints blijven anoniem, maar krijgen server-side validatie en rate limiting.
