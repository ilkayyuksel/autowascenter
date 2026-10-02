# ARCHIVED — NOT USED BY APPLICATION

Historical Supabase project files (`config.toml`, `migrations/`), moved here from `supabase/` in phase 7C.

- They are the original schema the self-hosted PostgreSQL schema was derived from (see `docs/DATABASE-INVENTORY.md` and `docs/DATABASE-MIGRATION-MAP.md`).
- The application does **not** use them. There is no Supabase tooling, runtime or deployment.
- The authoritative database schema is `apps/api/src/db/schema/` with the migrations in `apps/api/drizzle/`.
- They are not meant to be executed. One of them (`20260418155052_…`) once contained an admin password, which was replaced in phase 0; see `docs/MIGRATION-STATUS.md`, _Known security issues_.
- Historical **data** (bookings, gallery files) still lives in the existing Supabase project and is **NOT MIGRATED**. That is a separate, later phase.
