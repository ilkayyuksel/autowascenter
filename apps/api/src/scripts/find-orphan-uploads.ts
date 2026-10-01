// npm run storage:orphans: prints a READ-ONLY report of gallery files without database row
// and database rows whose managed file is missing. Deletes nothing.

import { loadConfig } from "../config/env.ts";
import { createDb } from "../db/index.ts";
import { LocalStorageProvider } from "../storage/local-storage-provider.ts";
import { findOrphanUploads } from "../storage/orphans.ts";

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl, { max: 1 });
try {
  const storage = await LocalStorageProvider.create({
    rootDir: config.uploads.dir,
    publicBaseUrl: config.uploads.publicBaseUrl,
  });
  const report = await findOrphanUploads(db, storage);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `orphan files: ${report.orphanFiles.length}, missing files: ${report.missingFiles.length}, ` +
      `external references (not managed, untouched): ${report.externalReferences}\n` +
      "Nothing was deleted.\n",
  );
} catch (err) {
  process.stderr.write(
    `Orphan report failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
