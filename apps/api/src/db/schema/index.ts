// Self-hosted PostgreSQL schema for Autowascenter.
//
// Derived from the Supabase schema (supabase/migrations, docs/DATABASE-INVENTORY.md).
// Deliberately NOT included: user_roles, app_role, has_role(), auth.* and storage.*
// (authentication/authorization move to Auth0 RBAC, files to a self-hosted volume).
//
// Objects Drizzle cannot express are in the custom migration
// drizzle/0001_booking_integrity.sql: btree_gist, the booking overlap exclusion
// constraint and the updated_at triggers.

export * from "./catalog.ts";
export * from "./bookings.ts";
export * from "./content.ts";
