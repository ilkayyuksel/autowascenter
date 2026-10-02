// Production migrations: applies the SQL files in drizzle/ (in the order of
// drizzle/meta/_journal.json) and records them in `drizzle.__drizzle_migrations`, exactly
// like `drizzle-kit migrate` does in development.
//
// Why a script instead of `drizzle-kit migrate`: drizzle-kit is a devDependency and is not
// installed in the production image. `drizzle-orm/node-postgres/migrator` is part of the
// runtime dependency, so the production image can migrate without any dev tooling. It uses
// its own single-connection pool, so no schema typing is involved.
//
// It is an EXPLICIT, one-off step (`npm run db:migrate:prod`, or
// `docker compose run --rm api npm run db:migrate:prod`): starting the API never migrates.
// Already applied migrations are skipped, so running it twice is harmless.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { loadConfig } from "../config/env.ts";

const MIGRATIONS_FOLDER = resolve(fileURLToPath(import.meta.url), "../../../drizzle");

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });

try {
  process.stdout.write(`Applying migrations from ${MIGRATIONS_FOLDER}\n`);
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  process.stdout.write("Migrations up to date.\n");
} catch (err) {
  // Never print the connection string: it contains the database password.
  process.stderr.write(`Migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
