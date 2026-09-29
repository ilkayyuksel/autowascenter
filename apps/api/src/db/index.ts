import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema/index.ts";

export { schema };

/**
 * Any Drizzle PostgreSQL database with this schema: node-postgres in the API process,
 * PGlite in tests. Services depend on this type, not on a specific driver.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbOptions {
  /** Max open connections in the pool. */
  max?: number;
  /** How long to wait for a free/new connection before failing (ms). */
  connectionTimeoutMillis?: number;
}

/**
 * Creates the single shared connection pool + Drizzle client for this process.
 * Callers own the lifecycle: `await pool.end()` on shutdown.
 */
export function createDb(connectionString: string, options: DbOptions = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    idleTimeoutMillis: 30_000,
  });
  const db = drizzle(pool, { schema });
  return { db: db as Database, pool };
}

/** Round-trips to the database; rejects when it is unreachable. */
export async function pingDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
