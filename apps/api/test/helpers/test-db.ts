// PGlite test database: the real PostgreSQL engine compiled to WASM, running in-process.
// All Drizzle migrations (drizzle/*.sql) are applied, so tests run against the same schema,
// constraints and triggers as production. No external database or Docker is needed.

import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { schema, type Database } from "../../src/db/index.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function createTestDb() {
  const pg = new PGlite({ extensions: { btree_gist } });
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder });

  return {
    pg,
    db: db as unknown as Database,
    /** Empties every application table. */
    reset: () =>
      pg.exec(`TRUNCATE bookings, booking_services, package_services, vehicle_type_services,
        services, vehicle_types, blocked_periods, site_settings, gallery_items, reviews CASCADE`),
  };
}
