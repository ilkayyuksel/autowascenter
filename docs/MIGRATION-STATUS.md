# Migration Status

Migratie van het Lovable/Supabase-project naar een self-hosted platform met Docker Compose.

| Fase                                               | Status                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Fase 0: beveiligen + baseline                      | **Afgerond** (zie _Completed_)                                                 |
| Fase 0.5: reproduceerbare baseline                 | **Afgerond** (zie _Baseline v1_)                                               |
| Fase 1: Supabase database-inventaris               | **Afgerond** (`docs/DATABASE-INVENTORY.md`, `docs/DATABASE-MIGRATION-MAP.md`)  |
| Fase 2: PostgreSQL-databaselaag (Drizzle)          | **Afgerond** (zie _Phase 2: database layer_)                                   |
| Fase 3: API-skelet + publieke reads (Fastify)      | **Afgerond** (zie _Phase 3: public read API_)                                  |
| Fase 4: booking, pricing, availability server-side | **Afgerond** (zie _Phase 4_)                                                   |
| Fase 5: Auth0 authentication + authorization       | **Afgerond** (zie _Phase 5_); ⚠ admin-datapagina's werken pas weer na Fase 6   |
| Fase 6A: admin-API read-side                       | **Afgerond** (zie _Phase 6A_); frontend nog niet aangesloten                   |
| Fase 6B: admin-API write-side                      | **Afgerond** (zie _Phase 6B_); frontend nog niet aangesloten                   |
| Fase 6C: gallery storage (self-hosted)             | **Afgerond** (zie _Phase 6C_); frontend en bestaande bestanden niet gemigreerd |
| Fase 6D-1: admin-frontend READ-migratie            | **Afgerond** (zie _Phase 6D-1_); admin-writes nog via Supabase                 |
| Fase 6D-2: admin-frontend WRITE-migratie           | **Afgerond** (zie _Phase 6D-2_); admin volledig via de eigen API               |
| Fase 7A: publieke frontend READ-migratie           | **Afgerond** (zie _Phase 7A_); booking-submit nog via Supabase                 |
| Volgende fase                                      | **Public reservation write migration** (7B)                                    |
| Latere fases                                       | Niet gestart (publieke frontendmigratie, data, Docker, productie)              |

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

## Phase 6C — Gallery Storage

**Status: COMPLETE**

Specificatie: `docs/GALLERY-STORAGE-MIGRATION.md`; endpoints: `docs/ADMIN-API.md` (_Gallery upload_).

- **Local storage**: `StorageProvider`-interface met `LocalStorageProvider` (lokaal filesystem, Docker-volume-ready). `UPLOAD_DIR/gallery/<uuid v4>.<jpg|png|webp>` is publiek; `UPLOAD_DIR/.staging/` is privé. Nieuwe env-variabelen: `UPLOAD_DIR`, `PUBLIC_UPLOAD_URL` (verplicht in productie), `MAX_UPLOAD_BYTES` (standaard 10 MiB), `UPLOAD_RATE_LIMIT_MAX` (30), `UPLOAD_RATE_LIMIT_WINDOW_MS` (1 uur).
- **Upload API**: `POST /api/admin/gallery/upload` (`admin:access`, multipart, precies één bestand `file` plus `title`, `description`, `sort_order`). Flow: staging → validatie (MIME-allowlist + magic bytes, grootte tijdens het streamen) → definitieve naam → DB-insert → 201 met de publieke URL. Faalt de insert, dan wordt het bestand weer verwijderd (compensatie).
- **Delete behavior**: `DELETE /api/admin/gallery/:id` verwijdert de rij en daarna alleen bestanden die de provider als eigen herkent (exacte canonieke URL) en die door geen andere rij meer gebruikt worden. Externe en Supabase-URL's worden nooit verwijderd. Bestandsfouten na de delete worden gelogd (204).
- **Public file serving**: `GET /uploads/gallery/*` via `@fastify/static`, met als root precies `UPLOAD_DIR/gallery`; geen listing, geen dotfiles, alleen UUID-namen en reguliere bestanden. Headers: `Cache-Control: public, max-age=31536000, immutable`, `nosniff` en CSP `default-src 'none'; sandbox`.
- **Security**: bestandsnamen komen altijd van de server; geen SVG; strikte key-validatie tegen path traversal; ownership-check in de provider; een aparte rate limit; geen paden, tokens of multipart-inhoud in responses of logs. Een read-only orphan-rapport: `npm run storage:orphans` (geen automatische cleanup).
- **Dependencies**: `@fastify/multipart` 10.1.2 en `@fastify/static` 10.1.5 (exact vastgepind). Geen dependency voor magic bytes; drie signaturen in `storage/image-types.ts`.
- **Tests**: `apps/api` heeft nu **226 tests: 225 geslaagd, 1 overgeslagen** (de symlinktest, omdat symlinks op deze Windows-machine niet zonder extra rechten aangemaakt kunnen worden). Nieuw: 9 provider-tests, 29 upload/serve/delete-tests (de 20 gevraagde scenario's plus rate limit, 503, compensatiefout, logs, gedeelde verwijzingen, `before_image_url`, DB-delete-fout, orphan-rapport) en 1 config-test. Alles draait in tijdelijke directories onder `os.tmpdir()`.
- **Bug gevonden en opgelost tijdens het testen**: bij een afgekapte multipart-body sloot het plugin de bestandsstream terwijl de route nog op het staging-bestand wachtte, waardoor `pipeline()` nooit eindigde en de request bleef hangen (ook via echte HTTP). De route controleert nu de streamstatus en geeft 400 `MALFORMED_MULTIPART`.
- **Supabase status**: ongewijzigd. `@supabase/supabase-js`, `src/integrations/supabase/` en `supabase/` blijven bestaan; de bucket `gallery` wordt nog door de frontend gebruikt.
- **Data migration status**: **NOT MIGRATED**. Bestaande `image_url`-waarden wijzen nog naar Supabase en blijven werken; het stappenplan staat in `docs/GALLERY-STORAGE-MIGRATION.md` (_Future data migration_).
- **Frontend status**: **NOT MIGRATED**. `src/routes/admin/galerij.tsx` uploadt nog naar Supabase.
- **Docker**: **NOT IMPLEMENTED**; de benodigde volume-mount is gedocumenteerd (_Future Docker volume_).

**Next phase: "Admin frontend migration from Supabase to own API"**

## Phase 6D-1 — Admin frontend READ migration

**Status: COMPLETE**

Details: `docs/ADMIN-FRONTEND-MIGRATION.md`.

- **API client**: `src/lib/api/client.ts` is de enige plek waar de frontend de API aanroept.
  - `get()` is publiek en stuurt geen token.
  - `getAdmin()` voegt `Authorization: Bearer <access token>` toe via de bestaande Auth0-`getAccessTokenSilently`. Er is geen tweede provider en de client slaat geen tokens op.
  - Fouten worden een typed `ApiError` (`status`, `code`, `message`).
  - Elke response wordt runtime gevalideerd met dezelfde Zod-contracten als de backend. Die contracten zijn verhuisd naar `packages/shared/src/admin.ts`; de backend re-exporteert ze.
  - Elke request heeft een timeout.
- **Migrated pages** (READ = API, geen Supabase-read of fallback meer):
  - dashboard (`GET /api/admin/dashboard`);
  - agenda (`GET /api/admin/agenda`, plus `GET /api/admin/vehicle-types` voor het aanmaakformulier);
  - reservaties (`GET /api/admin/bookings` met server-side paginering, en `GET /api/admin/bookings/:id` voor het detail);
  - diensten (`GET /api/admin/services`);
  - voertuigen (`GET /api/admin/vehicle-types`);
  - blokkades (`GET /api/admin/blocked-periods`);
  - instellingen (`GET /api/admin/settings`);
  - galerij (`GET /api/admin/gallery`).
  - `reviews.tsx` is ongewijzigd (alleen een redirect).
- **Foutafhandeling**:
  - Een 401 laat de bestaande guard de sessie opnieuw controleren ("Opnieuw inloggen"), maximaal één keer per 30 s.
  - 403 toont "Geen toegang".
  - 503, netwerkfouten en timeouts tonen een tijdelijke fout met "Opnieuw proberen".
  - `SETTINGS_NOT_CONFIGURED` toont een configuratiefout.
  - Geen enkele pagina blijft eindeloos laden.
- **Remaining Supabase writes** (stand na 6D-1, opgelost in 6D-2): alle admin-writes blijven op Supabase. Dat geldt voor agenda, reservaties, diensten, voertuigen, blokkades, instellingen en galerij, inclusief de storage-upload.
  - Ook de slot-controle vóór het opslaan in de agenda-dialogen (`fetchSlotData`) blijft op Supabase. Die hoort bij de write-flow en verhuist in 6D-2 naar `GET /api/admin/availability`.
  - Sinds Fase 5 weigert Supabase-RLS deze writes, omdat er geen Supabase-sessie meer is. Opslaan werkt dus pas na 6D-2. Deze branch mag in deze toestand niet gedeployed worden.
- **Tests**: root `npm test` telt nu **67 tests, allemaal geslaagd**: 11 bestaande en 56 nieuwe.
  - De nieuwe tests dekken de client (12), de foutweergave (8), de load-states (8) en de loaders per pagina (28).
  - De React-componenten zelf worden niet gerenderd in tests, omdat er geen DOM-testomgeving is. Daarvoor is er een handmatige checklist.
  - `apps/api` is ongewijzigd: 226 tests, waarvan 225 geslaagd en 1 overgeslagen.
- **Public frontend status**: **UNCHANGED**; de publieke pagina's gebruiken nog Supabase.
- **Lint**: 0 nieuwe problemen. In de gewijzigde pagina's daalt het aantal bestaande meldingen licht, onder meer doordat de `as any` in `agenda.tsx` verdwenen is.

**Next phase: "Admin frontend WRITE migration"**

## Phase 6D-2 — Admin frontend WRITE migration

**Status: COMPLETE**

Details: `docs/ADMIN-FRONTEND-MIGRATION.md`.

- **Admin reads**: API (sinds 6D-1); geen Supabase-reads meer.
- **Admin writes**: alle admin-mutaties gaan via de typed laag `src/lib/api/admin-writes.ts` en de bestaande client (`postAdmin`, `patchAdmin`, `putAdmin`, `deleteAdmin`, `postAdminForm`). De endpoints per onderdeel:

  | Onderdeel                         | Endpoints                                                                      |
  | --------------------------------- | ------------------------------------------------------------------------------ |
  | Boekingen (agenda en reservaties) | `POST /api/admin/bookings`, `PATCH`/`DELETE /api/admin/bookings/:id`           |
  | Beschikbaarheid                   | `GET /api/admin/availability`                                                  |
  | Diensten                          | `POST /api/admin/services`, `PATCH`/`DELETE /api/admin/services/:id`           |
  | Pakketinhoud                      | `PUT /api/admin/services/:id/package-content`                                  |
  | Voertuigtypes                     | `POST /api/admin/vehicle-types`, `PATCH`/`DELETE /api/admin/vehicle-types/:id` |
  | Prijsmatrix                       | `PUT /api/admin/vehicle-types/:id/pricing`                                     |
  | Blokkades                         | `POST`/`DELETE /api/admin/blocked-periods`                                     |
  | Instellingen                      | `PATCH /api/admin/settings` (partieel)                                         |
  | Galerij                           | `PATCH`/`DELETE /api/admin/gallery/:id`                                        |
  - Elke request wordt vóór verzending gevalideerd met de gedeelde backendcontracten. Die zijn verhuisd naar `packages/shared/src/admin-write.ts`; de backend re-exporteert ze.
  - Prijs, duur, totalen, start/einde, cancel token en `cancelled_at` kunnen niet meegestuurd worden. **Server authoritative**: de UI toont de prijs uit de API-response.
  - Customer e-mail is **verplicht**; er is geen placeholder meer.
  - Er is geen vrije duur, prijs of dienstnaam meer.
  - Admin-beschikbaarheid komt van de server: de admin gebruikt `src/lib/slots.ts` niet meer. Die blijft tijdelijk alleen voor de publieke `/reservatie`.

- **Gallery uploads**:
  - Uploaden gaat via `POST /api/admin/gallery/upload` (multipart) naar de self-hosted storage.
  - Verwijderen gaat via `DELETE /api/admin/gallery/:id`; de server beslist over het bestand.
  - Geen `supabase.storage` meer in de admin.
- **Auth0**: ongewijzigd (bestaande provider, access token via `getAccessTokenSilently`, `admin:access`).
- **Remaining Supabase**:
  - Admin: database-reads, database-writes, storage en auth: alle **NONE**.
  - Publiek: `src/routes/{diensten,galerij,reservatie}.tsx`, `src/components/{ServicesPreview,RealisationsPreview,Testimonials}.tsx`, `src/lib/slots.ts`, `src/integrations/supabase/`.
- **Tests**:
  - Root: **111 tests, allemaal geslaagd** (was 67). Nieuw: 28 write-flow-tests, 6 voor het boekingsformulier/e-mail, 4 mutation-tests en 6 extra clienttests (POST/PATCH/PUT/DELETE/multipart, 422, timeout).
  - `apps/api`: 226 tests, waarvan 225 geslaagd en 1 overgeslagen.
  - Componenten zijn niet gerenderd getest (geen DOM-testomgeving); daarvoor is er een handmatige checklist met 24 stappen. Die is in deze fase **niet** in een browser uitgevoerd, omdat er geen Auth0-credentials of draaiende API met data beschikbaar waren.
- **Lint**: 0 nieuwe problemen. Totaal 949 (baseline 1.003 na 6D-1; oorspronkelijk 1.009). Geen enkel gewijzigd bestand heeft meer meldingen dan op HEAD.

**Next phase: "Remove Supabase from the admin/application path"**

## Phase 7A — Public frontend READ migration

**Status: COMPLETE**

Details: `docs/PUBLIC-MIGRATION-MAP.md`.

- **Public endpoints used**:
  - `GET /api/services` (home `limit=4` en `/diensten`);
  - `GET /api/gallery` (home `limit=4` en `/galerij`);
  - `GET /api/reviews?limit=6`;
  - `GET /api/vehicle-types`;
  - `GET /api/vehicle-types/:id/services`;
  - `GET /api/availability`;
  - **nieuw**: `GET /api/site-settings`, met alleen `km_fee` en `free_km` en een strikt, apart publiek contract. Nooit `notification_email` of andere admin-data.
  - Alles via de bestaande client (`publicApi`, zonder token en zonder Auth0) en de typed laag `src/lib/api/public-reads.ts`. De publieke contracten zijn verhuisd naar `packages/shared/src/public.ts`.
- **Supabase reads removed**:
  - `ServicesPreview`, `RealisationsPreview` en `Testimonials`;
  - `/diensten` en `/galerij`;
  - alle reads van `/reservatie`: `vehicle_types`, `vehicle_type_services`, `services`, `package_services`, `blocked_periods`, `site_settings`, en de boekingen via `fetchSlotData`.
- **Reservation reads migrated**:
  - Voertuigtypes, diensten per type (met pakketinhoud) en vrije slots plus ophaalmoment komen van de server. `src/lib/slots.ts` wordt niet meer gebruikt; het blijft bestaan en wordt in 7B/7C verwijderd.
  - Blokkades worden niet meer naar de browser geladen: de availability-API gebruikt ze intern.
  - De prijstotalen in de wizard blijven een indicatie. De authoritative prijs komt in 7B uit `POST /api/bookings`.
- **Remaining public writes**: alleen de submit van `/reservatie` (insert in `bookings` en `booking_services`), tot Fase 7B.
  - Tussentoestand: die boekingen komen in Supabase terecht, terwijl de beschikbaarheid uit de eigen database komt. **Niet deployen.**
  - Contact: er is geen submit-backend (alleen een toast). Dat is ongewijzigd, niet gemigreerd en niet geïmplementeerd.
- **Unchanged**: `/over-ons` en `/contact` (geen data). Ook UI, teksten, filters, fallbacks en lightbox zijn ongewijzigd. Alleen bij fouten tonen `/diensten` en `/reservatie` nu een korte melding.
- **Tests**:
  - Root: **156 tests, allemaal geslaagd** (was 111). Nieuw: 37 publieke read-tests (per endpoint: succes, leeg, 400/404/500/503, malformed, timeout, geen Authorization-header; plus URL-behandeling en fallback) en 8 paginatests (geen Supabase-import of -query in home, diensten en galerij; in `/reservatie` alleen de twee inserts).
  - `apps/api`: **229 tests**, waarvan 228 geslaagd en 1 overgeslagen (+3 voor `GET /api/site-settings`).
  - De handmatige browsercheck is **niet** uitgevoerd: er was geen draaiende API met data beschikbaar.

**Next phase: "Public reservation write migration"**

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
