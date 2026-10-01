# Migration Status

Migratie van het Lovable/Supabase-project naar een self-hosted platform met Docker Compose.

| Fase                                               | Status                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Fase 0: beveiligen + baseline                      | **Afgerond** (zie _Completed_)                                                |
| Fase 0.5: reproduceerbare baseline                 | **Afgerond** (zie _Baseline v1_)                                              |
| Fase 1: Supabase database-inventaris               | **Afgerond** (`docs/DATABASE-INVENTORY.md`, `docs/DATABASE-MIGRATION-MAP.md`) |
| Fase 2: PostgreSQL-databaselaag (Drizzle)          | **Afgerond** (zie _Phase 2: database layer_)                                  |
| Fase 3: API-skelet + publieke reads (Fastify)      | **Afgerond** (zie _Phase 3: public read API_)                                 |
| Fase 4: booking, pricing, availability server-side | **Afgerond** (zie _Phase 4_)                                                  |
| Fase 5: Auth0 authentication + authorization       | **Afgerond** (zie _Phase 5_); ⚠ admin-datapagina's werken pas weer na Fase 6  |
| Fase 6A: admin-API read-side                       | **Afgerond** (zie _Phase 6A_); frontend nog niet aangesloten                  |
| Fase 6B: admin-API write-side                      | **Afgerond** (zie _Phase 6B_); frontend nog niet aangesloten                  |
| Volgende fase                                      | **Gallery storage/uploads and remaining admin data integrations** (6C)        |
| Latere fases                                       | Niet gestart (publieke frontendmigratie, data, Docker, productie)             |

## Phase 2: database layer

- **Waar**: `apps/api` (standalone npm-package) en `packages/shared` (standalone, minimaal). Geen root-workspaces; root `package.json`/`package-lock.json` zijn ongewijzigd.
- **Stack**: PostgreSQL, `drizzle-orm` 0.45.3, `pg` 8.23.0, `drizzle-kit` 0.31.11, TypeScript 5.9.3 (Node ≥ 22.18, ingebouwde type stripping). Tests: `@electric-sql/pglite` 0.5.8 (PostgreSQL in WASM, alleen dev).
- **Migraties**: `apps/api/drizzle/0000_initial_schema.sql` (gegenereerd) en `0001_booking_integrity.sql` (handgeschreven: `btree_gist`, exclusion constraint `bookings_no_overlap_excl`, `updated_at`-triggers).
- **Getest**: 26 integratietests op PGlite (migraties, overlap, FK-gedrag, CHECK's, singleton, trigger). **Niet** uitgevoerd tegen een echte PostgreSQL-server of tegen Supabase.
- **Beslissingen**: `vehicle_type_id` ON DELETE RESTRICT; geen `user_roles`/`admin_users`; `services.price`/`duration_minutes` behouden als **LEGACY**; **DEFERRED BUSINESS DECISION**: openingsuren per weekdag (voorlopig één venster via `site_settings`).
- **Details**: `apps/api/README.md`.

## Phase 3: public read API

- **Stack**: Fastify 5.12.5, `@fastify/cors` 11.3.0, zod 4.6.5 (exact vastgepind in `apps/api/package-lock.json`). Draait direct op Node ≥ 22.18 (`npm run dev` / `npm start`), typecheck via `tsc --noEmit`.
- **Endpoints**: `GET /health` (liveness), `GET /health/db` (readiness, 503 bij DB-uitval), `GET /api/services`, `/api/gallery`, `/api/reviews`, `/api/vehicle-types`, `/api/vehicle-types/:vehicleTypeId/services`. Responses `{ data }` / `{ error: { code, message } }`, velden in snake_case zoals de huidige frontend.
- **Structuur**: route → Zod-validatie → service (Drizzle, expliciete kolommen) → `{ data }`; `createApp()` (zonder poort) los van `startServer()` (één pool per proces, graceful shutdown).
- **Getest**: 50 tests (26 schema, 19 API via `app.inject()` op PGlite, 5 config), plus een handmatige rooktest van `npm start` (health, 503 bij onbereikbare DB, CORS, geen secrets in logs).
- **Bewust niet**: Auth0/admin, schrijfendpoints, boekingen, pricing- en availability-engine, aparte packages-endpoint (pakketinhoud zit als `includes` in de vehicle-type-services-response), frontendkoppeling. De frontend gebruikt nog steeds uitsluitend Supabase.

## Phase 4 — Server-side booking, pricing and availability

**Status: COMPLETE**

Specificatie: `docs/API-V1.md`. Regels en de mapping van oude naar nieuwe logica: `docs/BOOKING-BUSINESS-LOGIC.md`.

- **Pricing moved server-side**:
  - Prijs en duur komen uitsluitend uit `vehicle_type_services` in PostgreSQL. Een pakket is een gewone dienst met een eigen prijs, zoals nu.
  - Bedragen worden in centen berekend; btw is 21 % (half-up) en wordt alleen in de response teruggegeven.
  - `bookings.total_price` blijft excl. btw. De locatievergoeding blijft 0 (dat is het huidige gedrag), maar zit wel in één functie die later een echte berekening kan krijgen.
  - De client stuurt geen prijs, totaal, duur, status of token; stuurt hij die toch, dan volgt een 400.
- **Availability moved server-side** (`GET /api/availability`): hetzelfde slotalgoritme als `src/lib/slots.ts`, met drie bewuste correcties:
  - alle boekingen zijn zichtbaar (de frontend zag er door RLS geen);
  - boekingen en blokkades op de volgende dagen van een meerdaagse job tellen mee;
  - "vandaag" wordt in Europe/Brussels bepaald in plaats van in UTC.
- **Booking creation** (`POST /api/bookings`): een Zod-contract in `packages/shared`, status altijd `nieuw`, `cancel_token` via de DB-default, en snapshots in `booking_services`. De legacy-kolommen worden gevuld zoals de frontend dat doet.
- **Transaction behavior**: selectie, prijs, slotvalidatie, controle op blokkades en overlap, en beide inserts zitten in één transactie. Elke fout rolt alles terug; dat is getest.
- **Overlap protection**: een pre-check in de transactie plus de exclusion constraint `bookings_no_overlap_excl`. SQLSTATE `23P01` wordt `409 BOOKING_SLOT_UNAVAILABLE`, zonder PostgreSQL-details in de response.
- **Tests**: 107 tests in `apps/api`, allemaal geslaagd: schema 26, catalogus-API 19, config 6, pure logica 15, engine 28, booking-API 13. Er is geen parallelle race-test tegen een echte PostgreSQL, omdat PGlite maar één verbinding heeft; zie `apps/api/README.md`.
- **Rate limiting**: `@fastify/rate-limit` op `POST /api/bookings` (standaard 10 per 60 s per IP), instelbaar via `BOOKING_RATE_LIMIT_MAX` en `BOOKING_RATE_LIMIT_WINDOW_MS`. De tellers staan in het procesgeheugen; bij meerdere replicas is een gedeelde store nodig, en achter de proxy moet `trustProxy` aan.
- **Idempotency**: niet toegevoegd, en er is geen nieuwe kolom. Een dubbele submit van de huidige frontend (snelle dubbelklik) mikt op hetzelfde slot, zodat de tweede request een 409 krijgt van de overlapbescherming.
- **Frontend status**: **NOT MIGRATED**. De frontend gebruikt nog steeds Supabase. `src/routes/reservatie.tsx` en `src/lib/slots.ts` zijn ongewijzigd, en Supabase is niet verwijderd.
- **Open business-beslissingen** (gedocumenteerd, niet stilzwijgend opgelost):
  - Moet een pakket plus een dienst die het pakket al bevat geweigerd of ontdubbeld worden? Nu worden beide aangerekend.
  - Moet zondag gesloten zijn? `src/lib/site.ts` zegt ja, maar de database kent geen weekdagmodel.

**Next phase: "Auth0 authentication and backend authorization"**

## Phase 5 — Auth0 Authentication

**Status: COMPLETE** (code en tests). Het Auth0-dashboard moet nog handmatig ingericht worden; zie `docs/AUTH0-SETUP.md`.

Details: `docs/AUTH0-MIGRATION.md`.

- **Frontend authentication**:
  - `@auth0/auth0-react` 2.27.0, met één `Auth0Provider` die alleen op `/admin*`-paden en alleen in de browser gemount wordt. Publieke pagina's laden of contacteren Auth0 niet.
  - Login gaat via Universal Login vanaf `/admin-login`; `/admin-login` is ook de callback. Uitloggen gebeurt via de Auth0-logout en keert terug naar `/`.
  - Tokens staan in het geheugen van de SDK, met refresh-token-rotation. Er is geen eigen tokenopslag en geen client secret.
  - De guard (`/admin`) is **alleen UX**. Hij vraagt `GET /api/admin/me` met het access token en toont een aparte status voor laden, niet geconfigureerd, opnieuw inloggen, geen toegang, fout en toegestaan. Daardoor kan de UI niet eindeloos blijven laden of in een redirect-lus terechtkomen.
- **Backend JWT verification** (`apps/api/src/auth/`, `jose` 6.2.12):
  - RS256 via de gecachte remote JWKS (`https://<AUTH0_DOMAIN>/.well-known/jwks.json`), met controle van issuer, audience, `exp`/`nbf` en `sub`.
  - `AUTH0_DOMAIN` en `AUTH0_AUDIENCE` zijn verplicht in productie; `AUTH0_ISSUER` is optioneel.
- **RBAC/permission**: alleen de permission `admin:access`, uit de `permissions`-claim, via de Auth0-rol `admin`. Er zijn geen checks op e-mail, `sub` of rolnaam.
- **Protected endpoint**: `GET /api/admin/me` geeft `{ sub, permissions }` terug. De foutcodes zijn 401 `AUTHENTICATION_REQUIRED`/`AUTHENTICATION_INVALID`, 403 `AUTHORIZATION_REQUIRED` en 503 `AUTHENTICATION_UNAVAILABLE`.
- **Publieke endpoints** (catalogus, availability, `POST /api/bookings`) blijven publiek. Aan de booking-logica is niets gewijzigd.
- **Supabase auth status**:
  - `signInWithPassword`, `getSession`, `onAuthStateChange`, `signOut` en de `user_roles`-query zijn uit de frontend verwijderd.
  - `@supabase/supabase-js`, `src/integrations/supabase/` en de Supabase-database (inclusief `user_roles`) blijven bestaan, omdat de publieke frontend ze nog gebruikt.
- **⚠ Bekende tussentoestand**:
  - De admin-datapagina's (`src/routes/admin/*`) doen nog `supabase.from(...)`. Zonder Supabase-sessie draaien die als anon, waardoor RLS geen boekingen teruggeeft en schrijfacties weigert.
  - Fase 6 verplaatst de admin-CRUD naar de eigen API.
  - **Deze branch mag niet gedeployed of naar Lovable-`main` gemerged worden vóór Fase 6.**
- **Manual Auth0 setup** (`docs/AUTH0-SETUP.md`):
  - een SPA-applicatie en een API (RS256, RBAC aan, "Add Permissions in the Access Token" aan);
  - de URL's voor `http://localhost:8080`, refresh-token-rotation, de permission `admin:access` en de rol `admin`;
  - admin-gebruikers aanmaken en de rol toekennen; signups uitschakelen.
- **Tests**:
  - API: 124 tests, allemaal geslaagd. Daarvan zijn 16 nieuwe auth-tests; config ging van 6 naar 7.
  - Frontend: `npm test` in de root, 11 tests, allemaal geslaagd.
  - SSR-rooktest van publieke en admin-pagina's.
  - Browserflows (redirect, callback, logout, refresh) zijn handmatig te testen; er is geen E2E-runner.

**Next phase: "Admin API and admin data migration"**

## Phase 6A — Admin API read-side

**Status: COMPLETE**

Specificatie: `docs/ADMIN-API.md`. Mapping per bestaande admin-query: `docs/ADMIN-MIGRATION-MAP.md`.

- **Endpoints**: `GET /api/admin/dashboard`, `/bookings`, `/bookings/:id`, `/agenda?start=&end=`, `/services`, `/vehicle-types`, `/blocked-periods`, `/settings`, `/gallery` (plus `/me` uit Fase 5).
  - Er is **geen** `/api/admin/reviews`: de huidige UI heeft geen reviewbeheer (`admin/reviews.tsx` is alleen een redirect).
- **Authorization**:
  - Twee `preHandler`-hooks op het admin-parent-plugin gelden voor elke route: een geldig Auth0-access-token (anders 401) en de permission `admin:access` (anders 403).
  - Er zijn geen checks op e-mail, `sub`, rolnaam of `user_roles`.
  - Onbekende queryparameters geven een 400.
- **Pagination**: alleen voor boekingen (`page`, `limit` met standaard 50 en maximum 100), in SQL via `LIMIT`/`OFFSET` met een stabiele sortering. `meta` bevat `{ page, limit, total, total_pages }`. De andere collecties zijn klein en krijgen `meta.total`.
- **Contracten**: strikte Zod-schema's, dus er lekken geen onverwachte velden. `cancel_token` wordt nooit teruggegeven; dat is getest.
- **Dashboard**: `COUNT`, `SUM` en `GROUP BY` in PostgreSQL. De omzet is exclusief btw. "Vandaag" en "deze week" worden in Europe/Brussels bepaald.
- **Agenda**: toont boekingen van alle statussen waarvan het bereik `[start_at, end_at)` overlapt met de gevraagde periode, dus ook de latere dagen van meerdaagse boekingen, plus de blokkades. Het bereik is maximaal 62 dagen.
- **Tests**:
  - `apps/api`: 143 tests, allemaal geslaagd. Daarvan zijn 19 nieuwe admin-read-tests: de auth-matrix (401/401/403/200) voor alle 9 endpoints, 400/404, strikte contracten, en de data (aggregaten, paginering, detail, meerdaagse agenda, catalogus, settings, galerij).
  - Frontend: 11 tests, allemaal geslaagd.
- **Frontend status**: **NOT MIGRATED**. De admin-frontend gebruikt nog Supabase en werkt sinds Fase 5 zonder Supabase-sessie niet voor data; zie de waarschuwing bij Phase 5.

**Next phase: "Admin API write-side and transactions"**

## Phase 6B — Admin API write-side

**Status: COMPLETE**

Specificatie: `docs/ADMIN-API.md` (sectie _Writes_). Mapping en atomiciteitsmatrix: `docs/ADMIN-WRITE-MIGRATION-MAP.md`.

- **Endpoints** (allemaal Auth0 `admin:access`):
  - **Boekingen**: `POST /api/admin/bookings`, `PATCH`/`DELETE /api/admin/bookings/:id`, `GET /api/admin/availability` (met `exclude_booking_id`).
  - **Diensten**: `POST /api/admin/services`, `PATCH`/`DELETE /api/admin/services/:id`, `PUT /api/admin/services/:id/package-content`.
  - **Voertuigtypes**: `POST /api/admin/vehicle-types`, `PATCH`/`DELETE /api/admin/vehicle-types/:id`, `PUT /api/admin/vehicle-types/:id/pricing`.
  - **Blokkades**: `POST /api/admin/blocked-periods`, `DELETE /api/admin/blocked-periods/:id`.
  - **Instellingen**: `PATCH /api/admin/settings`.
  - **Galerij**: `POST /api/admin/gallery`, `PATCH`/`DELETE /api/admin/gallery/:id`.
- **Pricing**:
  - Admin-boekingen gebruiken **dezelfde engine** als `POST /api/bookings` (`planNewBooking`, `validateSchedule`, `insertBooking` in `booking.service.ts`).
  - De client stuurt nooit prijs, duur, locatievergoeding, token of tijdstempels; doet hij dat toch, dan volgt een 400.
  - Bij het verplaatsen blijven prijs en duur behouden. Bij een andere dienstkeuze wordt opnieuw geprijsd en worden de snapshots vervangen.
- **`exclude_booking_id`**: elke overlapcontrole bij een update sluit de boeking zelf uit. De exclusion constraint blijft de laatste beveiliging.
- **Transacties** (elk één `db.transaction`):
  - boeking aanmaken en bijwerken (met `FOR UPDATE`);
  - dienst aanmaken met prijsrijen;
  - pakketinhoud;
  - voertuigtype aanmaken met prijsrijen;
  - prijsmatrix (all-or-nothing);
  - settings (met een lock).
- **FK-semantiek**:
  - Een voertuigtype dat nog in boekingen gebruikt wordt, kan niet verwijderd worden: 409 `RESOURCE_IN_USE` (SQLSTATE 23001/23503).
  - Bij het verwijderen van een dienst blijven de boekingssnapshots bestaan (SET NULL).
  - Een dubbele slug geeft 409 `RESOURCE_CONFLICT`.
- **Bewuste wijzigingen tegenover de oude UI** (zie de map):
  - Er kan geen vrije prijs, duur of `service_title` meer ingegeven worden.
  - `customer_email` is verplicht. De oude placeholder `geen@autowascenter.be` wordt niet nagebootst; dat is een **DECIDE** voor de frontendmigratie.
  - Er is geen PATCH voor blokkades, omdat de UI die niet heeft.
  - Bij de galerij wordt alleen metadata verwijderd; het bestand zelf volgt in Fase 6C.
- **Tests**: `apps/api` heeft nu 187 tests, allemaal geslaagd. Het verloop: Fase 5 → 124, Fase 6A → 143, Fase 6B → +44, waarvan:
  - 17 booking-writes: aanmaken, verplaatsen met en zonder botsing, eigen slot, datum en tijd, verleden, buiten het grid, dienstwijziging, statusovergangen inclusief annuleren en heractiveren, notities, verwijderen, admin-availability en integriteit;
  - 20 catalogus- en content-writes, inclusief de auth-matrix voor alle 18 write-endpoints;
  - **7 rollbacktests** met geforceerde fouten halverwege de transactie: dienst met prijsrijen, voertuigtype met prijsrijen, pakketinhoud, boeking met regels (admin en publiek), dienstwijziging van een boeking, prijsmatrix met A en B geldig en C fout, en integriteit.
- **Frontend status**: **NOT MIGRATED**. De admin-UI gebruikt nog Supabase.
- **Storage**: **NOT MIGRATED**, gepland voor Fase 6C.

**Next phase: "Gallery storage/uploads and remaining admin data integrations"**

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
