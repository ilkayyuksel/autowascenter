// Forced mid-transaction failures for rollback tests: a temporary trigger that raises an
// exception when a row matching `when` is written to `table`. Test databases only.

import type { PGlite } from "@electric-sql/pglite";

export async function failWhen(pg: PGlite, table: string, when: string) {
  await pg.exec(`
    CREATE OR REPLACE FUNCTION test_forced_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'forced test failure';
    END $$;
    DROP TRIGGER IF EXISTS test_forced_failure ON ${table};
    CREATE TRIGGER test_forced_failure BEFORE INSERT OR UPDATE ON ${table}
      FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION test_forced_failure();
  `);
  return () => pg.exec(`DROP TRIGGER IF EXISTS test_forced_failure ON ${table};`);
}
