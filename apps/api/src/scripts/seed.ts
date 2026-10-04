// Production data seed: data/autowascenter-production.json -> PostgreSQL.
//
//   npm run db:seed -- --dry-run     validate and roll back, change nothing
//   npm run db:seed                  apply
//
// Properties, in order of importance:
//
//   * ONE TRANSACTION. Any failure rolls everything back; the database is never left
//     half-seeded.
//   * IDEMPOTENT. Rows are upserted on their natural key (`id` for the catalogue,
//     (vehicle_type_id, service_id) for the pricing matrix), so a second run ends in the
//     same state without duplicate-key errors.
//   * NEVER DESTRUCTIVE. No TRUNCATE, no DELETE. Bookings, gallery files, existing package
//     contents and blocked periods are left untouched, and the booking count is checked
//     before and after to prove it.
//   * THE EXPORT IS THE TRUTH. Values are written exactly as supplied; nothing is
//     normalised, corrected or invented. Fields the export does not carry (the legacy
//     services.price / duration_minutes / image_url) are left as they are.
//   * NO SCHEMA CHANGE. This script only writes rows.
//
// The export's `bedrijf` block is informational: the name, domain and mobile number have
// no database columns and belong in the frontend's static configuration (src/lib/site.ts).
// Only the address/city are stored, through site_settings (the pricing engine measures the
// travel surcharge from there).
//
// The logic is exported so it can be driven against any Drizzle database (the test suite
// runs it on PGlite); the CLI at the bottom only runs when this file is the entry point.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { loadConfig } from "../config/env.ts";
import { createDb, schema, type Database } from "../db/index.ts";

export const DEFAULT_SOURCE_FILE = fileURLToPath(
  new URL("../../../../data/autowascenter-production.json", import.meta.url),
);

// ---------------------------------------------------------------------------------------
// Source contract
// ---------------------------------------------------------------------------------------

/** Euro amount with at most 2 decimals, so it maps exactly onto numeric(10,2). */
const money = z
  .number()
  .nonnegative()
  .max(99_999_999.99)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "at most 2 decimals");

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm");

/**
 * PostgreSQL's `uuid` acceptance: 8-4-4-4-12 hex, nothing more. Deliberately NOT uuidLike,
 * which additionally enforces the RFC 4122 version/variant bits. The delivered export uses
 * readable placeholder ids (11111111-1111-1111-1111-111111111101) that PostgreSQL stores
 * happily but that are not RFC-valid, and the ids must be preserved exactly as supplied.
 * See docs/PRODUCTION-DATA-IMPORT.md: the API contracts do use uuidLike, which is a real
 * conflict that has to be decided, not silently worked around here.
 */
const uuidLike = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "expected a uuid (8-4-4-4-12 hex)",
  );
const text = z.string().min(1);
const nullableText = z.string().nullable();
const sortOrder = z.number().int().min(0).max(1_000_000);

/**
 * Sections the export has always been empty for. They are accepted ONLY while empty: the
 * mapping for their rows has never been seen, so silently importing a guessed shape would
 * be worse than refusing. Gallery rows additionally need their image files, which is a
 * separate migration step.
 */
const emptyOnly = (name: string, hint: string) =>
  z.array(z.unknown()).max(0, `${name} is not supported by this seed yet: ${hint}`);

export const productionSeedSchema = z.strictObject({
  bedrijf: z.strictObject({
    naam: text,
    domein: text,
    adres: text,
    gsm: text,
  }),
  site_settings: z.strictObject({
    opening_hour: localTime,
    closing_hour: localTime,
    slot_interval_minutes: z.number().int().min(1).max(1440),
    km_fee_eur_per_km: money,
    free_km: money,
    base_address: text,
    base_city: text,
    notification_email: z.string().trim().pipe(z.email()).nullable(),
  }),
  vehicle_types: z
    .array(
      z.strictObject({
        id: uuidLike,
        slug: z
          .string()
          .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, digits and single hyphens"),
        title: text,
        description: nullableText,
        icon: nullableText,
        sort_order: sortOrder,
        active: z.boolean(),
      }),
    )
    .min(1),
  services: z
    .array(
      z.strictObject({
        id: uuidLike,
        title: text,
        description: nullableText,
        category: nullableText,
        kind: z.enum(["dienst", "pakket", "extra"]),
        bookable: z.boolean(),
        active: z.boolean(),
        sort_order: sortOrder,
        icon: nullableText,
        badge: nullableText,
      }),
    )
    .min(1),
  prijzen_per_voertuigtype: z.array(
    z.strictObject({
      /** Denormalised names; used only to cross-check the ids. */
      vehicle_type: text,
      vehicle_type_id: uuidLike,
      service: text,
      service_id: uuidLike,
      available: z.boolean(),
      price_eur_excl_btw: money,
      duration_minutes: z
        .number()
        .int()
        .min(1)
        .max(7 * 24 * 60),
    }),
  ),
  package_services: emptyOnly(
    "package_services",
    "no package content has ever been exported, so do not seed invented contents",
  ),
  blocked_periods: emptyOnly("blocked_periods", "add them through the admin UI"),
  gallery_items: emptyOnly(
    "gallery_items",
    "the image files must be migrated in a separate step first",
  ),
});

export type ProductionSeed = z.output<typeof productionSeedSchema>;

/** Parses and validates the export; throws with the failing field paths. */
export function parseSource(raw: unknown): ProductionSeed {
  const result = productionSeedSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid source data: ${problems}`);
  }
  return result.data;
}

export async function readSource(file = DEFAULT_SOURCE_FILE): Promise<ProductionSeed> {
  return parseSource(JSON.parse(await readFile(file, "utf8")));
}

// ---------------------------------------------------------------------------------------
// Referential checks on the source itself, before any write
// ---------------------------------------------------------------------------------------

/** Throws on anything that would make the import ambiguous or wrong. */
export function checkSource(data: ProductionSeed): void {
  const problems: string[] = [];
  const duplicates = (values: string[]) => [
    ...new Set(values.filter((v, i) => values.indexOf(v) !== i)),
  ];

  for (const [label, values] of [
    ["vehicle_types.id", data.vehicle_types.map((v) => v.id)],
    ["vehicle_types.slug", data.vehicle_types.map((v) => v.slug)],
    ["services.id", data.services.map((s) => s.id)],
  ] as const) {
    const dupes = duplicates([...values]);
    if (dupes.length) problems.push(`duplicate ${label}: ${dupes.join(", ")}`);
  }

  const vehicleTypes = new Map(data.vehicle_types.map((v) => [v.id, v]));
  const services = new Map(data.services.map((s) => [s.id, s]));
  const pairs = new Set<string>();

  for (const [i, row] of data.prijzen_per_voertuigtype.entries()) {
    const where = `prijzen_per_voertuigtype[${i}]`;
    const vehicleType = vehicleTypes.get(row.vehicle_type_id);
    const service = services.get(row.service_id);
    if (!vehicleType) problems.push(`${where}: unknown vehicle_type_id ${row.vehicle_type_id}`);
    if (!service) problems.push(`${where}: unknown service_id ${row.service_id}`);
    // The export repeats the titles next to the ids; disagreement means the export itself
    // is inconsistent, which must not be imported silently.
    if (vehicleType && vehicleType.title !== row.vehicle_type) {
      problems.push(
        `${where}: vehicle_type "${row.vehicle_type}" does not match id (${vehicleType.title})`,
      );
    }
    if (service && service.title !== row.service) {
      problems.push(`${where}: service "${row.service}" does not match id (${service.title})`);
    }
    const key = `${row.vehicle_type_id}:${row.service_id}`;
    if (pairs.has(key)) problems.push(`${where}: duplicate vehicle_type + service combination`);
    pairs.add(key);
  }

  if (data.site_settings.closing_hour <= data.site_settings.opening_hour) {
    problems.push("site_settings: closing_hour must be after opening_hour");
  }

  if (problems.length) throw new Error(`Source data is inconsistent: ${problems.join("; ")}`);
}

// ---------------------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------------------

/** Exact numeric(10,2) text for an amount already validated to 2 decimals. */
const amount = (value: number) => value.toFixed(2);

export interface TableReport {
  /** Rows in the export. */
  source: number;
  /** Of those, how many did not exist yet. */
  inserted: number;
  /** Of those, how many already existed and were updated. */
  updated: number;
  /** Total rows in the table after seeding (may include rows this export does not own). */
  total: number;
}

export interface SeedReport {
  dryRun: boolean;
  siteSettings: { created: boolean; total: number };
  vehicleTypes: TableReport;
  services: TableReport;
  vehicleTypeServices: TableReport;
  /** Untouched by this seed; reported to show nothing was removed. */
  untouched: {
    packageServices: number;
    blockedPeriods: number;
    galleryItems: number;
    bookings: number;
    bookingServices: number;
  };
}

/** Thrown at the end of a dry run so the transaction rolls back; carries the result. */
class DryRunRollback extends Error {
  readonly report: SeedReport;

  constructor(report: SeedReport) {
    super("dry run: rolled back");
    this.report = report;
  }
}

/**
 * Upserts the export into `db` inside ONE transaction.
 *
 * With `dryRun` everything runs against the real database -- including the foreign-key and
 * count checks -- and the transaction is then rolled back, so the result is trustworthy
 * without changing anything.
 */
export async function seedDatabase(
  db: Database,
  data: ProductionSeed,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<SeedReport> {
  checkSource(data);

  const run = async (tx: Database): Promise<SeedReport> => {
    /** Row count of a table, through the typed query builder (driver-agnostic). */
    const rowCount = async (table: PgTable) =>
      (await tx.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n;

    const bookingsBefore = await rowCount(schema.bookings);

    // ---- site_settings: exactly one row (unique index on a constant), so update in place.
    const existingSettings = await tx
      .select({ id: schema.siteSettings.id })
      .from(schema.siteSettings)
      .limit(1);
    const settingsValues = {
      kmFee: amount(data.site_settings.km_fee_eur_per_km),
      freeKm: amount(data.site_settings.free_km),
      baseAddress: data.site_settings.base_address,
      baseCity: data.site_settings.base_city,
      openingHour: data.site_settings.opening_hour,
      closingHour: data.site_settings.closing_hour,
      slotIntervalMinutes: data.site_settings.slot_interval_minutes,
      notificationEmail: data.site_settings.notification_email,
    };
    if (existingSettings[0]) {
      await tx
        .update(schema.siteSettings)
        .set(settingsValues)
        .where(eq(schema.siteSettings.id, existingSettings[0].id));
    } else {
      await tx.insert(schema.siteSettings).values(settingsValues);
    }

    // ---- vehicle_types, then services: the pricing matrix references both.
    const vehicleTypeIds = data.vehicle_types.map((v) => v.id);
    const existingVehicleTypeIds = new Set(
      (
        await tx
          .select({ id: schema.vehicleTypes.id })
          .from(schema.vehicleTypes)
          .where(inArray(schema.vehicleTypes.id, vehicleTypeIds))
      ).map((r) => r.id),
    );
    await tx
      .insert(schema.vehicleTypes)
      .values(
        data.vehicle_types.map((v) => ({
          id: v.id,
          slug: v.slug,
          title: v.title,
          description: v.description,
          icon: v.icon,
          sortOrder: v.sort_order,
          active: v.active,
        })),
      )
      .onConflictDoUpdate({
        target: schema.vehicleTypes.id,
        set: {
          slug: sql`excluded.slug`,
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          icon: sql`excluded.icon`,
          sortOrder: sql`excluded.sort_order`,
          active: sql`excluded.active`,
        },
      });

    const serviceIds = data.services.map((s) => s.id);
    const existingServiceIds = new Set(
      (
        await tx
          .select({ id: schema.services.id })
          .from(schema.services)
          .where(inArray(schema.services.id, serviceIds))
      ).map((r) => r.id),
    );
    // price, duration_minutes and image_url are deliberately absent: the export does not
    // carry them, so an existing value must not be wiped.
    await tx
      .insert(schema.services)
      .values(
        data.services.map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          category: s.category,
          kind: s.kind,
          bookable: s.bookable,
          active: s.active,
          sortOrder: s.sort_order,
          icon: s.icon,
          badge: s.badge,
        })),
      )
      .onConflictDoUpdate({
        target: schema.services.id,
        set: {
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          category: sql`excluded.category`,
          kind: sql`excluded.kind`,
          bookable: sql`excluded.bookable`,
          active: sql`excluded.active`,
          sortOrder: sql`excluded.sort_order`,
          icon: sql`excluded.icon`,
          badge: sql`excluded.badge`,
        },
      });

    // ---- The pricing matrix. Both parents must now really be in the database: the FK
    // would catch it, but an explicit check names the offending row.
    const presentVehicleTypes = new Set(
      (await tx.select({ id: schema.vehicleTypes.id }).from(schema.vehicleTypes)).map((r) => r.id),
    );
    const presentServices = new Set(
      (await tx.select({ id: schema.services.id }).from(schema.services)).map((r) => r.id),
    );
    const missing = data.prijzen_per_voertuigtype.flatMap((row, i) => {
      const problems: string[] = [];
      if (!presentVehicleTypes.has(row.vehicle_type_id)) {
        problems.push(`prijzen_per_voertuigtype[${i}]: vehicle_type ${row.vehicle_type_id}`);
      }
      if (!presentServices.has(row.service_id)) {
        problems.push(`prijzen_per_voertuigtype[${i}]: service ${row.service_id}`);
      }
      return problems;
    });
    if (missing.length) {
      throw new Error(`Missing foreign keys, rolling back: ${missing.join("; ")}`);
    }

    const existingPairs = new Set(
      (
        await tx
          .select({
            vehicleTypeId: schema.vehicleTypeServices.vehicleTypeId,
            serviceId: schema.vehicleTypeServices.serviceId,
          })
          .from(schema.vehicleTypeServices)
      ).map((r) => `${r.vehicleTypeId}:${r.serviceId}`),
    );
    if (data.prijzen_per_voertuigtype.length > 0) {
      await tx
        .insert(schema.vehicleTypeServices)
        .values(
          data.prijzen_per_voertuigtype.map((r) => ({
            vehicleTypeId: r.vehicle_type_id,
            serviceId: r.service_id,
            available: r.available,
            price: amount(r.price_eur_excl_btw),
            durationMinutes: r.duration_minutes,
          })),
        )
        .onConflictDoUpdate({
          target: [schema.vehicleTypeServices.vehicleTypeId, schema.vehicleTypeServices.serviceId],
          set: {
            available: sql`excluded.available`,
            price: sql`excluded.price`,
            durationMinutes: sql`excluded.duration_minutes`,
          },
        });
    }

    // ---- Verify the result against the export, still inside the transaction.
    const settingsTotal = await rowCount(schema.siteSettings);
    const vehicleTypesTotal = await rowCount(schema.vehicleTypes);
    const servicesTotal = await rowCount(schema.services);
    const pricingTotal = await rowCount(schema.vehicleTypeServices);

    const seededVehicleTypes = (
      await tx
        .select({ id: schema.vehicleTypes.id })
        .from(schema.vehicleTypes)
        .where(inArray(schema.vehicleTypes.id, vehicleTypeIds))
    ).length;
    const seededServices = (
      await tx
        .select({ id: schema.services.id })
        .from(schema.services)
        .where(inArray(schema.services.id, serviceIds))
    ).length;
    const seededPricing = (
      await tx
        .select({ id: schema.vehicleTypeServices.id })
        .from(schema.vehicleTypeServices)
        .where(
          and(
            inArray(schema.vehicleTypeServices.vehicleTypeId, vehicleTypeIds),
            inArray(schema.vehicleTypeServices.serviceId, serviceIds),
          ),
        )
    ).length;

    const mismatches: string[] = [];
    if (settingsTotal !== 1) mismatches.push(`site_settings: ${settingsTotal} rows, expected 1`);
    if (seededVehicleTypes !== data.vehicle_types.length) {
      mismatches.push(`vehicle_types: ${seededVehicleTypes}/${data.vehicle_types.length}`);
    }
    if (seededServices !== data.services.length) {
      mismatches.push(`services: ${seededServices}/${data.services.length}`);
    }
    if (seededPricing !== data.prijzen_per_voertuigtype.length) {
      mismatches.push(
        `vehicle_type_services: ${seededPricing}/${data.prijzen_per_voertuigtype.length}`,
      );
    }
    const bookingsAfter = await rowCount(schema.bookings);
    if (bookingsAfter !== bookingsBefore) {
      mismatches.push(`bookings changed: ${bookingsBefore} -> ${bookingsAfter}`);
    }
    if (mismatches.length) {
      throw new Error(`Verification failed, rolling back: ${mismatches.join("; ")}`);
    }

    const report: SeedReport = {
      dryRun,
      siteSettings: { created: !existingSettings[0], total: settingsTotal },
      vehicleTypes: {
        source: data.vehicle_types.length,
        inserted: data.vehicle_types.length - existingVehicleTypeIds.size,
        updated: existingVehicleTypeIds.size,
        total: vehicleTypesTotal,
      },
      services: {
        source: data.services.length,
        inserted: data.services.length - existingServiceIds.size,
        updated: existingServiceIds.size,
        total: servicesTotal,
      },
      vehicleTypeServices: {
        source: data.prijzen_per_voertuigtype.length,
        inserted: data.prijzen_per_voertuigtype.filter(
          (r) => !existingPairs.has(`${r.vehicle_type_id}:${r.service_id}`),
        ).length,
        updated: data.prijzen_per_voertuigtype.filter((r) =>
          existingPairs.has(`${r.vehicle_type_id}:${r.service_id}`),
        ).length,
        total: pricingTotal,
      },
      untouched: {
        packageServices: await rowCount(schema.packageServices),
        blockedPeriods: await rowCount(schema.blockedPeriods),
        galleryItems: await rowCount(schema.galleryItems),
        bookings: bookingsAfter,
        bookingServices: await rowCount(schema.bookingServices),
      },
    };

    if (dryRun) throw new DryRunRollback(report);
    return report;
  };

  try {
    return await db.transaction((tx) => run(tx as unknown as Database));
  } catch (error) {
    if (error instanceof DryRunRollback) return error.report;
    throw error;
  }
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------

function describeTarget(connectionString: string): string {
  // Never print the connection string itself: it contains the password.
  try {
    const url = new URL(connectionString);
    const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "(default)";
    return `database "${database}" on ${url.hostname}:${url.port || "5432"} as "${decodeURIComponent(url.username)}"`;
  } catch {
    return "database from DATABASE_URL (unparseable, not shown)";
  }
}

const table = (name: string, r: TableReport) =>
  `  ${name.padEnd(22)} source ${String(r.source).padStart(3)} | inserted ${String(r.inserted).padStart(3)} | updated ${String(r.updated).padStart(3)} | table total ${r.total}\n`;

export function formatReport(report: SeedReport): string {
  let out = "";
  out += table("vehicle_types", report.vehicleTypes);
  out += table("services", report.services);
  out += table("vehicle_type_services", report.vehicleTypeServices);
  out += `  ${"site_settings".padEnd(22)} ${report.siteSettings.created ? "created" : "updated"} | table total ${report.siteSettings.total}\n`;
  out += "  untouched by this seed:\n";
  for (const [name, value] of Object.entries(report.untouched)) {
    out += `    ${name.padEnd(20)} ${value}\n`;
  }
  return out;
}

async function main(argv: string[]): Promise<number> {
  const dryRun = argv.includes("--dry-run");
  const fileArg = argv.find((a) => a.startsWith("--file="));
  const file = fileArg ? resolve(fileArg.slice("--file=".length)) : DEFAULT_SOURCE_FILE;

  const config = loadConfig();
  process.stdout.write(`Seeding from ${file}\n`);
  process.stdout.write(`Target: ${describeTarget(config.databaseUrl)}\n`);
  if (dryRun) process.stdout.write("DRY RUN: the transaction will be rolled back.\n");

  const data = await readSource(file);
  process.stdout.write(
    `Source: ${data.vehicle_types.length} vehicle types, ${data.services.length} services, ` +
      `${data.prijzen_per_voertuigtype.length} pricing rows, ` +
      `${data.package_services.length} package services, ${data.blocked_periods.length} blocked periods, ` +
      `${data.gallery_items.length} gallery items\n`,
  );

  const { db, pool } = createDb(config.databaseUrl, { max: 1 });
  try {
    const report = await seedDatabase(db, data, { dryRun });
    process.stdout.write(formatReport(report));
    process.stdout.write(dryRun ? "Dry run complete, nothing changed.\n" : "Seed applied.\n");
    return 0;
  } catch (error) {
    process.stderr.write(
      `Seed failed, nothing was changed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    await pool.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = await main(process.argv.slice(2));
