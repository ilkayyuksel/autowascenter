# Database Migration Map

Compacte mapping van de huidige Supabase-database naar de toekomstige self-hosted PostgreSQL-database. De onderbouwing staat in `docs/DATABASE-INVENTORY.md`. Dit is een **voorstel**: nog niets is geïmplementeerd, en de live verificatie is nog niet gebeurd.

**Acties**

- **PRESERVE**: 1-op-1 overnemen (schema + data).
- **CHANGE**: overnemen met een schema- of dataconversie.
- **REPLACE**: de functie blijft, via een ander mechanisme.
- **REMOVE**: niet in de applicatiedatabase.
- **NEW**: toevoegen.
- **DECIDE**: bedrijfs- of productbeslissing nodig.

## Schema's en platform

| CURRENT SUPABASE                                 | FUTURE SELF-HOSTED POSTGRESQL                                       | ACTION                                |
| ------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------- |
| `auth.users`, `auth.identities`                  | Auth0 (identity store)                                              | REMOVE FROM APPLICATION DB            |
| `auth.uid()`                                     | `sub` uit de Auth0-JWT, gevalideerd door de backend                 | REPLACE                               |
| `storage.buckets` (`gallery`, public)            | Bestandsvolume `uploads/gallery/`, geserveerd door de reverse proxy | REPLACE                               |
| `storage.objects` (bucket `gallery`)             | Bestanden op het volume (+ optioneel een metadata-tabel)            | REPLACE (bestanden kopiëren)          |
| `supabase_migrations.schema_migrations`          | Migratietool van de nieuwe backend (bv. Drizzle)                    | REMOVE (alleen exporteren als bewijs) |
| PostgREST (`/rest/v1`) + anon-key                | Eigen REST API                                                      | REPLACE                               |
| RLS aan op 11 tabellen, 31 policies              | Autorisatie in de backend; de app-DB-rol heeft minimale rechten     | REPLACE                               |
| GRANTs aan `anon`/`authenticated`/`service_role` | Eén applicatierol (+ een aparte migratie- of eigenaarsrol)          | REPLACE                               |
| Extensie pgcrypto (`crypt`, `gen_salt`)          | niet nodig                                                          | REMOVE                                |
| `gen_random_uuid()`                              | `gen_random_uuid()` (core PG ≥ 13)                                  | PRESERVE                              |
| —                                                | Extensie `btree_gist` (voor de overlap-constraint)                  | NEW                                   |

## Tabellen

| CURRENT SUPABASE        | FUTURE SELF-HOSTED POSTGRESQL      | ACTION                                                                                                                                                                                                                                                                             |
| ----------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services`              | `services`                         | CHANGE: CHECK op `kind` (`dienst`, `pakket`, `extra`); `price`/`duration_minutes` = legacy → DECIDE (behouden als "vanaf-prijs" of later verwijderen)                                                                                                                              |
| `package_services`      | `package_services`                 | PRESERVE (+ index op `service_id`, CHECK `package_id <> service_id`)                                                                                                                                                                                                               |
| `vehicle_types`         | `vehicle_types`                    | PRESERVE                                                                                                                                                                                                                                                                           |
| `vehicle_type_services` | `vehicle_type_services`            | PRESERVE (+ CHECK `price >= 0`, `duration_minutes > 0`; overbodige `idx_vts_vehicle` weg)                                                                                                                                                                                          |
| `bookings`              | `bookings`                         | CHANGE: `preferred_time` text → `time`; `end_time` text → REPLACE door NEW `start_at`/`end_at timestamptz` (Europe/Brussels); UNIQUE `cancel_token`; CHECK's op bedragen en duur; exclusion constraint tegen overlap; FK `vehicle_type_id` expliciet RESTRICT of SET NULL (DECIDE) |
| `booking_services`      | `booking_services`                 | PRESERVE (+ index op `service_id`, CHECK's ≥ 0)                                                                                                                                                                                                                                    |
| `blocked_periods`       | `blocked_periods`                  | CHANGE: `start_time`/`end_time` text → `time`; CHECK `start_date <= end_date`                                                                                                                                                                                                      |
| `site_settings`         | `site_settings`                    | CHANGE: `opening_hour`/`closing_hour` text → `time`; `free_km` → `numeric(10,2)`; één rij afdwingen                                                                                                                                                                                |
| —                       | `opening_hours` (per weekdag)      | NEW + DECIDE (zondag gesloten versus één venster voor alle dagen)                                                                                                                                                                                                                  |
| `gallery_items`         | `gallery_items`                    | CHANGE (data): `image_url` herschrijven van de Supabase-URL naar een eigen (relatief) pad; `before_image_url` idem, indien gevuld                                                                                                                                                  |
| `reviews`               | `reviews`                          | PRESERVE                                                                                                                                                                                                                                                                           |
| `user_roles`            | Auth0 RBAC (permissie/rol `admin`) | REPLACE (tabel REMOVE; alternatief alleen indien nodig: lokale tabel met `auth0_sub text`, zonder FK)                                                                                                                                                                              |

## Kolommen die speciale aandacht vragen

| CURRENT SUPABASE                                              | FUTURE SELF-HOSTED POSTGRESQL                                                          | ACTION                                                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `bookings.preferred_date` (date) + `preferred_time` (text)    | `start_at timestamptz` (+ `preferred_date`/`preferred_time time` voor compatibiliteit) | CHANGE (conversie met Europe/Brussels)                                                                    |
| `bookings.end_time` (text, kan ≥ `24:00` zijn)                | `end_at timestamptz` (ophaalmoment, over meerdere dagen)                               | REPLACE (opnieuw berekenen uit start + duur + openingsuren)                                               |
| `bookings.total_price`, `total_duration_minutes`              | idem                                                                                   | PRESERVE (waarde); voortaan **server-side** berekend                                                      |
| `bookings.location_fee`                                       | idem                                                                                   | PRESERVE (nu altijd 0; berekening DECIDE)                                                                 |
| `bookings.location_distance_km`                               | idem                                                                                   | PRESERVE (nullable, nu ongebruikt)                                                                        |
| `bookings.service_id`, `service_title`, `vehicle_info`        | idem (legacy snapshot)                                                                 | PRESERVE voor oude boekingen; niet meer schrijven (vervalt zodra de frontend `booking_services` gebruikt) |
| `bookings.status` (`booking_status`)                          | idem                                                                                   | PRESERVE (overgangsregels in de backend: DECIDE)                                                          |
| `bookings.cancel_token`                                       | idem, UNIQUE                                                                           | CHANGE (constraint)                                                                                       |
| `booking_services.price`, `duration_minutes`, `service_title` | idem                                                                                   | PRESERVE (snapshot)                                                                                       |
| `vehicle_types.icon`, `vehicle_types.image_url`               | idem                                                                                   | PRESERVE (ongebruikt in de UI; opschonen later)                                                           |
| `services.image_url`                                          | idem                                                                                   | PRESERVE (inhoud live verifiëren)                                                                         |

## Enums, functies, triggers, indexen

| CURRENT SUPABASE                                                | FUTURE SELF-HOSTED POSTGRESQL                                                                                     | ACTION           |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------- |
| enum `booking_status` (nieuw, bevestigd, voltooid, geannuleerd) | idem                                                                                                              | PRESERVE         |
| enum `app_role` (admin, user)                                   | Auth0-rollen/permissies                                                                                           | REMOVE           |
| function `has_role(uuid, app_role)` SECURITY DEFINER            | Backend-middleware (`requireAdmin`)                                                                               | REPLACE / REMOVE |
| function `update_updated_at_column()`                           | idem (of ORM)                                                                                                     | PRESERVE         |
| 8 triggers `BEFORE UPDATE … updated_at`                         | idem                                                                                                              | PRESERVE         |
| `idx_bookings_date`                                             | idem (+ GiST-index van de exclusion constraint)                                                                   | PRESERVE         |
| `idx_bookings_vehicle_type`                                     | idem                                                                                                              | PRESERVE         |
| `idx_bookings_cancel_token` (niet uniek)                        | UNIQUE-index                                                                                                      | CHANGE           |
| `idx_booking_services_booking`                                  | idem                                                                                                              | PRESERVE         |
| `idx_blocked_periods_dates`                                     | idem                                                                                                              | PRESERVE         |
| `idx_vts_service`                                               | idem                                                                                                              | PRESERVE         |
| `idx_vts_vehicle`                                               | — (gedekt door UNIQUE)                                                                                            | REMOVE           |
| —                                                               | indexen op `bookings.service_id`, `booking_services.service_id`, `package_services.service_id`, `bookings.status` | NEW              |
| CHECK `reviews.rating BETWEEN 1 AND 5`                          | idem                                                                                                              | PRESERVE         |

## RLS-regels → backend-autorisatie

| CURRENT RLS-REGEL                                               | FUTURE BACKEND-REGEL                                                                              | ACTION  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------- |
| anon SELECT `services` WHERE `active`                           | `GET /api/services` → alleen actieve                                                              | REPLACE |
| anon SELECT `vehicle_types` WHERE `active`                      | `GET /api/vehicle-types` → alleen actieve                                                         | REPLACE |
| anon SELECT `vehicle_type_services` (alles)                     | Alleen `available` ∧ dienst `active` ∧ `bookable` ∧ type `active` (strenger dan nu)               | REPLACE |
| anon SELECT `package_services`, `gallery_items`                 | Publieke read-endpoints                                                                           | REPLACE |
| anon SELECT `reviews` WHERE `approved`                          | `GET /api/reviews` → alleen goedgekeurde                                                          | REPLACE |
| anon SELECT `blocked_periods` (incl. `reason`)                  | Alleen bezette intervallen via `/api/availability` (zonder `reason`)                              | REPLACE |
| anon SELECT `site_settings` (incl. `notification_email`)        | Alleen publieke velden (openingsuren, km-info)                                                    | REPLACE |
| anon INSERT `bookings` / `booking_services` `WITH CHECK (true)` | `POST /api/bookings`: server berekent prijs, duur en status, overlapcheck, transactie, rate limit | REPLACE |
| anon INSERT `reviews` WHERE `approved = false`                  | Niet openstellen tot er een UI is (DECIDE)                                                        | REPLACE |
| admin ALL op alle tabellen + storage                            | `/api/admin/*` met Auth0-permissie `admin`                                                        | REPLACE |
| authenticated SELECT eigen `user_roles`                         | Claim in de Auth0-token                                                                           | REPLACE |

## Data (bij de cutover)

| CURRENT SUPABASE                                             | FUTURE SELF-HOSTED POSTGRESQL            | ACTION                                                                        |
| ------------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------- |
| Rijen in de 10 applicatietabellen                            | Zelfde tabellen                          | PRESERVE (export `--data-only`, UUID's behouden zodat de FK's intact blijven) |
| Rijen in `user_roles`                                        | —                                        | REMOVE (admins handmatig aanmaken in Auth0)                                   |
| Seeddata M1–M3 (diensten, types, prijzen, settings, reviews) | Niet opnieuw seeden; live data overnemen | REMOVE seeds                                                                  |
| Admin-bootstrap M4                                           | Auth0-gebruiker                          | REMOVE                                                                        |
| Bestanden in bucket `gallery`                                | `uploads/gallery/<zelfde bestandsnaam>`  | CHANGE (kopiëren + URL's in `gallery_items` herschrijven)                     |
| Overlappende boekingen en `end_time ≥ 24:00`                 | —                                        | Opschonen/herberekenen **vóór** de import (verificatie #14, #16)              |
