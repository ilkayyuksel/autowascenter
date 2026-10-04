// The production data seed (src/scripts/seed.ts) against a real PostgreSQL engine (PGlite,
// with every migration applied) and through the real public API.
//
// It proves what the seed promises: the shipped export validates, a dry run changes
// nothing, the first run writes exactly the export, a second run ends in the same state,
// any broken reference rolls the whole thing back, and existing bookings, gallery items,
// package contents and blocked periods survive untouched.
//
// It also checks the BUSINESS BEHAVIOUR afterwards: the catalogue endpoints, the slot list
// and a real public booking whose price and duration equal the supplied pricing exactly.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { isUuid, uuid } from "@autowascenter/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/app.ts";
import { schema, type Database } from "../src/db/index.ts";
import {
  checkSource,
  DEFAULT_SOURCE_FILE,
  parseSource,
  readSource,
  seedDatabase,
  type ProductionSeed,
} from "../src/scripts/seed.ts";
import { createTestAuth } from "./helpers/auth.ts";
import { NOW } from "./helpers/fixtures.ts";
import { createTestDb } from "./helpers/test-db.ts";

/** Counts pinned to the delivered export; update deliberately when new data arrives. */
const EXPECTED = {
  vehicleTypes: 5,
  services: 16,
  pricing: 66,
  packageServices: 0,
  blockedPeriods: 0,
  galleryItems: 0,
} as const;

/** Known ids from the export, used for the business-behaviour checks. */
const STADSWAGEN = "11111111-1111-1111-1111-111111111101";
const DIEP_CLEAN_EXTERIEUR = "22222222-2222-2222-2222-222222222201";
/** The one record whose category says "Pakketten" while its kind says "dienst". */
const DIEP_CLEAN_INT_EXT = "22222222-2222-2222-2222-222222222214";

let pg: PGlite;
let db: Database;
let reset: () => Promise<unknown>;
let source: ProductionSeed;
/** A deep copy, so a test can modify the source without affecting the others. */
const clone = (): ProductionSeed => structuredClone(source);

/** Number of rows a select returns. */
const rows = async <T>(select: Promise<T[]>) => (await select).length;

before(async () => {
  const t = await createTestDb();
  pg = t.pg;
  db = t.db;
  reset = t.reset;
  source = await readSource();
});
after(async () => {
  await pg.close();
});
beforeEach(async () => {
  await reset();
});

describe("production seed: the delivered export", () => {
  test("the shipped file is valid JSON matching the contract", async () => {
    const raw = JSON.parse(await readFile(DEFAULT_SOURCE_FILE, "utf8")) as unknown;
    const parsed = parseSource(raw); // throws on any unknown or malformed field
    assert.doesNotThrow(() => checkSource(parsed));
  });

  test("it holds exactly the delivered counts, with unique ids", () => {
    assert.equal(source.vehicle_types.length, EXPECTED.vehicleTypes);
    assert.equal(source.services.length, EXPECTED.services);
    assert.equal(source.prijzen_per_voertuigtype.length, EXPECTED.pricing);
    assert.equal(source.package_services.length, EXPECTED.packageServices);
    assert.equal(source.blocked_periods.length, EXPECTED.blockedPeriods);
    assert.equal(source.gallery_items.length, EXPECTED.galleryItems);

    const unique = (values: string[]) => new Set(values).size === values.length;
    assert.ok(unique(source.vehicle_types.map((v) => v.id)), "vehicle type ids");
    assert.ok(unique(source.vehicle_types.map((v) => v.slug)), "vehicle type slugs");
    assert.ok(unique(source.services.map((s) => s.id)), "service ids");
    assert.ok(
      unique(source.prijzen_per_voertuigtype.map((r) => `${r.vehicle_type_id}:${r.service_id}`)),
      "no duplicate vehicle type + service combination",
    );

    // Every pricing row resolves to a vehicle type and a service in the same export.
    const vehicleTypeIds = new Set(source.vehicle_types.map((v) => v.id));
    const serviceIds = new Set(source.services.map((s) => s.id));
    for (const row of source.prijzen_per_voertuigtype) {
      assert.ok(vehicleTypeIds.has(row.vehicle_type_id), row.vehicle_type_id);
      assert.ok(serviceIds.has(row.service_id), row.service_id);
    }
  });

  test("an inconsistent export is refused before anything is written", () => {
    const unknownService = clone();
    unknownService.prijzen_per_voertuigtype[0]!.service_id = "99999999-9999-4999-8999-999999999999";
    assert.throws(() => checkSource(unknownService), /unknown service_id/);

    const renamed = clone();
    renamed.prijzen_per_voertuigtype[0]!.service = "Something else";
    assert.throws(() => checkSource(renamed), /does not match id/);

    const duplicated = clone();
    duplicated.prijzen_per_voertuigtype.push({ ...duplicated.prijzen_per_voertuigtype[0]! });
    assert.throws(() => checkSource(duplicated), /duplicate vehicle_type \+ service/);
  });

  test("sections that have never been exported are refused when filled in", () => {
    for (const key of ["package_services", "blocked_periods", "gallery_items"] as const) {
      const filled = { ...structuredClone(source), [key]: [{ anything: true }] };
      assert.throws(() => parseSource(filled), /is not supported by this seed yet/, key);
    }
  });
});

describe("production seed: the id contract the delivered data needs", () => {
  test("the shared id schema accepts every delivered id and still rejects junk", () => {
    // Guard against re-tightening this to zod's z.uuid(): the delivered catalogue uses
    // readable ids whose RFC variant nibble is not 8/9/a/b. That rejection turned the whole
    // public booking flow into HTTP 400. See packages/shared/src/ids.ts.
    const schema = uuid();
    for (const id of [
      ...source.vehicle_types.map((v) => v.id),
      ...source.services.map((s) => s.id),
    ]) {
      assert.ok(schema.safeParse(id).success, `id must be accepted: ${id}`);
    }
    assert.ok(isUuid(STADSWAGEN), "the readable placeholder ids are valid ids");
    assert.ok(isUuid("4529cf53-489f-43dc-87b2-695d2743f67b"), "and so are real UUIDv4 ids");

    for (const invalid of [
      "",
      "not-a-uuid",
      "11111111-1111-1111-1111-11111111110",
      "11111111-1111-1111-1111-1111111111011",
      "11111111_1111_1111_1111_111111111101",
      "zzzzzzzz-1111-1111-1111-111111111101",
      "11111111-1111-1111-1111-111111111101 OR 1=1",
    ]) {
      assert.equal(schema.safeParse(invalid).success, false, `must be rejected: "${invalid}"`);
    }
  });
});

describe("production seed: dry run", () => {
  test("validates against the database and changes nothing", async () => {
    const report = await seedDatabase(db, source, { dryRun: true });

    assert.equal(report.dryRun, true);
    assert.equal(report.vehicleTypes.inserted, EXPECTED.vehicleTypes);
    assert.equal(report.services.inserted, EXPECTED.services);
    assert.equal(report.vehicleTypeServices.inserted, EXPECTED.pricing);
    assert.equal(report.siteSettings.created, true);

    // The transaction was rolled back: the database is still empty.
    assert.equal(
      await rows(db.select({ id: schema.vehicleTypes.id }).from(schema.vehicleTypes)),
      0,
    );
    assert.equal(await rows(db.select({ id: schema.services.id }).from(schema.services)), 0);
    assert.equal(
      await rows(db.select({ id: schema.vehicleTypeServices.id }).from(schema.vehicleTypeServices)),
      0,
    );
    assert.equal(
      await rows(db.select({ id: schema.siteSettings.id }).from(schema.siteSettings)),
      0,
    );
  });
});

describe("production seed: applying it", () => {
  test("writes exactly the export, with the values unchanged", async () => {
    const report = await seedDatabase(db, source);

    assert.equal(report.dryRun, false);
    assert.equal(report.vehicleTypes.total, EXPECTED.vehicleTypes);
    assert.equal(report.services.total, EXPECTED.services);
    assert.equal(report.vehicleTypeServices.total, EXPECTED.pricing);
    assert.equal(report.siteSettings.total, 1);
    assert.deepEqual(report.untouched, {
      packageServices: 0,
      blockedPeriods: 0,
      galleryItems: 0,
      bookings: 0,
      bookingServices: 0,
    });

    // site_settings: money as exact numeric(10,2) text, no floating-point artefacts.
    const settings = (await db.select().from(schema.siteSettings))[0]!;
    assert.equal(settings.kmFee, "1.00");
    assert.equal(settings.freeKm, "20.00");
    assert.equal(settings.openingHour, "10:00:00");
    assert.equal(settings.closingHour, "21:00:00");
    assert.equal(settings.slotIntervalMinutes, 30);
    assert.equal(settings.baseAddress, "Raapstraat 34, 9100 Sint-Niklaas");
    assert.equal(settings.baseCity, "Sint-Niklaas");
    assert.equal(settings.notificationEmail, "info@autowascenter.be");

    // A vehicle type keeps its supplied id, slug, icon and order.
    const stadswagen = (
      await db.select().from(schema.vehicleTypes).where(eq(schema.vehicleTypes.id, STADSWAGEN))
    )[0]!;
    assert.equal(stadswagen.slug, "stadswagen");
    assert.equal(stadswagen.title, "Stadswagen");
    assert.equal(stadswagen.icon, "car-side");
    assert.equal(stadswagen.sortOrder, 1);
    assert.equal(stadswagen.active, true);
    assert.equal(stadswagen.imageUrl, null, "the export carries no image");

    // Every service row matches the export field by field.
    const stored = new Map(
      (await db.select().from(schema.services)).map((s) => [s.id, s] as const),
    );
    assert.equal(stored.size, EXPECTED.services);
    for (const s of source.services) {
      const row = stored.get(s.id);
      assert.ok(row, `service ${s.title} missing`);
      assert.equal(row.title, s.title);
      assert.equal(row.description, s.description);
      assert.equal(row.category, s.category);
      assert.equal(row.kind, s.kind);
      assert.equal(row.bookable, s.bookable);
      assert.equal(row.active, s.active);
      assert.equal(row.sortOrder, s.sort_order);
      assert.equal(row.icon, s.icon);
      assert.equal(row.badge, s.badge);
      // The export carries no legacy price/duration, so they stay empty.
      assert.equal(row.price, null);
      assert.equal(row.durationMinutes, null);
    }

    // Records with a null description/badge are seeded, not skipped.
    const walkIn = stored.get("4529cf53-489f-43dc-87b2-695d2743f67b")!;
    assert.equal(walkIn.title, "Basiswasbeurt exterieur");
    assert.equal(walkIn.description, null);
    assert.equal(walkIn.bookable, false);
    assert.equal(walkIn.badge, "geen afspraak nodig");

    // Every pricing row matches, with the price stored exactly.
    const matrix = new Map(
      (await db.select().from(schema.vehicleTypeServices)).map(
        (r) => [`${r.vehicleTypeId}:${r.serviceId}`, r] as const,
      ),
    );
    assert.equal(matrix.size, EXPECTED.pricing);
    for (const r of source.prijzen_per_voertuigtype) {
      const row = matrix.get(`${r.vehicle_type_id}:${r.service_id}`);
      assert.ok(row, `${r.vehicle_type} / ${r.service} missing`);
      assert.equal(row.price, r.price_eur_excl_btw.toFixed(2));
      assert.equal(row.durationMinutes, r.duration_minutes);
      assert.equal(row.available, r.available);
    }
    assert.equal(matrix.get(`${STADSWAGEN}:${DIEP_CLEAN_EXTERIEUR}`)!.price, "49.95");
    assert.equal(matrix.get(`${STADSWAGEN}:${DIEP_CLEAN_EXTERIEUR}`)!.durationMinutes, 120);
  });

  test("a second run ends in the same state, without duplicates", async () => {
    await seedDatabase(db, source);
    const snapshot = async () => ({
      settings: await db.select().from(schema.siteSettings),
      vehicleTypes: await db.select().from(schema.vehicleTypes).orderBy(schema.vehicleTypes.id),
      services: await db.select().from(schema.services).orderBy(schema.services.id),
      pricing: await db
        .select()
        .from(schema.vehicleTypeServices)
        .orderBy(schema.vehicleTypeServices.vehicleTypeId, schema.vehicleTypeServices.serviceId),
    });
    const before = await snapshot();

    const second = await seedDatabase(db, source);

    assert.equal(second.vehicleTypes.inserted, 0);
    assert.equal(second.vehicleTypes.updated, EXPECTED.vehicleTypes);
    assert.equal(second.services.inserted, 0);
    assert.equal(second.services.updated, EXPECTED.services);
    assert.equal(second.vehicleTypeServices.inserted, 0);
    assert.equal(second.vehicleTypeServices.updated, EXPECTED.pricing);
    assert.equal(second.siteSettings.created, false, "the singleton row is updated, not added");

    const afterRun = await snapshot();
    assert.equal(afterRun.vehicleTypes.length, EXPECTED.vehicleTypes);
    assert.equal(afterRun.services.length, EXPECTED.services);
    assert.equal(afterRun.pricing.length, EXPECTED.pricing);
    assert.equal(afterRun.settings.length, 1);
    // Identical rows, ids included (nothing was recreated).
    assert.deepEqual(
      afterRun.vehicleTypes.map((v) => [v.id, v.slug, v.title, v.icon, v.sortOrder, v.active]),
      before.vehicleTypes.map((v) => [v.id, v.slug, v.title, v.icon, v.sortOrder, v.active]),
    );
    assert.deepEqual(
      afterRun.pricing.map((r) => [r.vehicleTypeId, r.serviceId, r.price, r.durationMinutes]),
      before.pricing.map((r) => [r.vehicleTypeId, r.serviceId, r.price, r.durationMinutes]),
    );
  });

  test("a changed export updates the existing rows instead of adding new ones", async () => {
    await seedDatabase(db, source);

    const changed = clone();
    changed.prijzen_per_voertuigtype[0]!.price_eur_excl_btw = 59.95;
    changed.prijzen_per_voertuigtype[0]!.duration_minutes = 150;
    changed.services[0]!.title = "Diep Clean Exterieur (nieuw)";
    // The export repeats the title in the pricing block, so a rename appears in both;
    // checkSource refuses a half-renamed export (covered above).
    for (const row of changed.prijzen_per_voertuigtype) {
      if (row.service_id === changed.services[0]!.id) row.service = changed.services[0]!.title;
    }
    changed.site_settings.closing_hour = "20:00";

    const report = await seedDatabase(db, changed);
    assert.equal(report.vehicleTypeServices.total, EXPECTED.pricing, "no extra rows");
    assert.equal(report.services.total, EXPECTED.services);

    const row = (
      await db.select().from(schema.vehicleTypeServices).orderBy(schema.vehicleTypeServices.price)
    ).find((r) => r.vehicleTypeId === STADSWAGEN && r.serviceId === DIEP_CLEAN_EXTERIEUR)!;
    assert.equal(row.price, "59.95");
    assert.equal(row.durationMinutes, 150);
    assert.equal(
      (
        await db.select().from(schema.services).where(eq(schema.services.id, DIEP_CLEAN_EXTERIEUR))
      )[0]!.title,
      "Diep Clean Exterieur (nieuw)",
    );
    assert.equal((await db.select().from(schema.siteSettings))[0]!.closingHour, "20:00:00");
  });
});

describe("production seed: failure rolls everything back", () => {
  test("a pricing row with an unknown service leaves an empty database empty", async () => {
    const broken = clone();
    // Bypass checkSource's name comparison by pointing at a non-existent id consistently.
    broken.prijzen_per_voertuigtype[0]!.service_id = "99999999-9999-4999-8999-999999999999";

    await assert.rejects(() => seedDatabase(db, broken), /unknown service_id/);

    assert.equal(
      await rows(db.select({ id: schema.vehicleTypes.id }).from(schema.vehicleTypes)),
      0,
    );
    assert.equal(await rows(db.select({ id: schema.services.id }).from(schema.services)), 0);
    assert.equal(
      await rows(db.select({ id: schema.siteSettings.id }).from(schema.siteSettings)),
      0,
    );
  });

  test("a failure halfway leaves an already seeded database exactly as it was", async () => {
    await seedDatabase(db, source);
    const before = {
      services: await db.select().from(schema.services).orderBy(schema.services.id),
      pricing: await db
        .select()
        .from(schema.vehicleTypeServices)
        .orderBy(schema.vehicleTypeServices.id),
      settings: (await db.select().from(schema.siteSettings))[0]!,
    };

    // Valid source shape, but one duration violates the table's CHECK (> 0), so the
    // database itself rejects the batch after the catalogue was already written.
    const broken = clone();
    broken.services[0]!.title = "Should not survive";
    broken.site_settings.base_city = "Should not survive";
    broken.prijzen_per_voertuigtype[0]!.duration_minutes = 0;

    await assert.rejects(() => seedDatabase(db, broken));

    const afterRun = {
      services: await db.select().from(schema.services).orderBy(schema.services.id),
      pricing: await db
        .select()
        .from(schema.vehicleTypeServices)
        .orderBy(schema.vehicleTypeServices.id),
      settings: (await db.select().from(schema.siteSettings))[0]!,
    };
    assert.deepEqual(
      afterRun.services.map((s) => s.title),
      before.services.map((s) => s.title),
      "no service title was changed",
    );
    assert.equal(afterRun.settings.baseCity, before.settings.baseCity);
    assert.deepEqual(
      afterRun.pricing.map((r) => [r.price, r.durationMinutes]),
      before.pricing.map((r) => [r.price, r.durationMinutes]),
    );
  });
});

describe("production seed: nothing existing is destroyed", () => {
  test("bookings, gallery, package contents and blocked periods survive", async () => {
    await seedDatabase(db, source);

    // Data that the export does not contain, created afterwards as in production.
    const [pkg] = await db
      .insert(schema.packageServices)
      .values({ packageId: DIEP_CLEAN_INT_EXT, serviceId: DIEP_CLEAN_EXTERIEUR })
      .returning();
    const [gallery] = await db
      .insert(schema.galleryItems)
      .values({ title: "Bestaande foto", imageUrl: "/uploads/gallery/keep-me.jpg" })
      .returning();
    const [blocked] = await db
      .insert(schema.blockedPeriods)
      .values({ startDate: "2026-12-24", endDate: "2026-12-26", reason: "Kerst" })
      .returning();
    const [booking] = await db
      .insert(schema.bookings)
      .values({
        customerName: "Bestaande klant",
        customerEmail: "klant@example.test",
        customerPhone: "0470000000",
        vehicleTypeId: STADSWAGEN,
        preferredDate: "2026-11-02",
        preferredTime: "10:00",
        startAt: new Date("2026-11-02T09:00:00Z"),
        endAt: new Date("2026-11-02T11:00:00Z"),
        totalDurationMinutes: 120,
        totalPrice: "49.95",
        status: "bevestigd",
      })
      .returning();

    const report = await seedDatabase(db, source);

    assert.equal(report.untouched.packageServices, 1);
    assert.equal(report.untouched.galleryItems, 1);
    assert.equal(report.untouched.blockedPeriods, 1);
    assert.equal(report.untouched.bookings, 1);

    assert.equal(
      await rows(
        db
          .select({ id: schema.packageServices.id })
          .from(schema.packageServices)
          .where(eq(schema.packageServices.id, pkg!.id)),
      ),
      1,
    );
    assert.equal(
      (
        await db.select().from(schema.galleryItems).where(eq(schema.galleryItems.id, gallery!.id))
      )[0]!.imageUrl,
      "/uploads/gallery/keep-me.jpg",
      "the gallery row and therefore its file reference are untouched",
    );
    assert.equal(
      (
        await db
          .select()
          .from(schema.blockedPeriods)
          .where(eq(schema.blockedPeriods.id, blocked!.id))
      ).length,
      1,
    );
    const keptBooking = (
      await db.select().from(schema.bookings).where(eq(schema.bookings.id, booking!.id))
    )[0]!;
    assert.equal(keptBooking.customerName, "Bestaande klant");
    assert.equal(keptBooking.totalPrice, "49.95");
  });
});

describe("production seed: business behaviour through the public API", () => {
  let app: FastifyInstance;

  before(async () => {
    const auth = await createTestAuth();
    app = await createApp({
      db,
      corsOrigins: ["http://localhost:8080"],
      logLevel: "silent",
      clock: () => NOW,
      tokenVerifier: auth.verifier,
      bookingRateLimit: { max: 1000, timeWindowMs: 60_000 },
    });
  });
  after(async () => {
    await app?.close();
  });

  const json = async (url: string) => {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 200, `${url} -> ${response.statusCode}`);
    return response.json() as { data: unknown };
  };

  test("the catalogue endpoints serve the seeded data", async () => {
    await seedDatabase(db, source);

    // /api/services lists every ACTIVE service and reports `bookable` as a field, so the
    // site can label the walk-in ones. The bookable filter applies to the booking options.
    const services = (await json("/api/services")).data as {
      id: string;
      title: string;
      bookable: boolean;
    }[];
    const publicIds = new Set(services.map((s) => s.id));
    for (const s of source.services) {
      assert.equal(publicIds.has(s.id), s.active, `${s.title} (active=${s.active})`);
    }
    assert.equal(services.length, EXPECTED.services, "all 16 are active in this export");
    const walkIn = services
      .filter((s) => !s.bookable)
      .map((s) => s.title)
      .sort();
    assert.deepEqual(walkIn, ["Basiswasbeurt exterieur", "Basiswasbeurt interieur"]);

    // Only bookable, available services are offered as booking options.
    const bookableIds = new Set(
      source.services.filter((s) => s.active && s.bookable).map((s) => s.id),
    );

    const vehicleTypes = (await json("/api/vehicle-types")).data as { id: string }[];
    assert.equal(vehicleTypes.length, EXPECTED.vehicleTypes);

    // Per vehicle type, exactly the available pricing rows of bookable, active services.
    const options = (await json(`/api/vehicle-types/${STADSWAGEN}/services`)).data as {
      service_id: string;
      price: number;
      duration_minutes: number;
    }[];
    const expected = source.prijzen_per_voertuigtype.filter(
      (r) => r.vehicle_type_id === STADSWAGEN && r.available && bookableIds.has(r.service_id),
    );
    assert.equal(options.length, expected.length);
    const offered = new Map(options.map((o) => [o.service_id, o] as const));
    for (const r of expected) {
      const option = offered.get(r.service_id)!;
      assert.equal(option.price, r.price_eur_excl_btw, r.service);
      assert.equal(option.duration_minutes, r.duration_minutes, r.service);
    }

    // The public settings subset carries the travel surcharge, never the admin e-mail.
    const settings = (await json("/api/site-settings")).data as Record<string, unknown>;
    assert.deepEqual(Object.keys(settings).sort(), ["free_km", "km_fee"]);
    assert.equal(settings.km_fee, 1);
    assert.equal(settings.free_km, 20);
  });

  test("availability follows the seeded opening hours", async () => {
    await seedDatabase(db, source);

    const availability = (
      await json(
        `/api/availability?date=2026-10-05&vehicle_type_id=${STADSWAGEN}&service_ids=${DIEP_CLEAN_EXTERIEUR}`,
      )
    ).data as { total_duration_minutes: number; slots: { time: string }[] };

    assert.equal(availability.total_duration_minutes, 120, "from the seeded pricing");
    const times = availability.slots.map((s) => s.time);
    assert.equal(times[0], "10:00", "opening_hour 10:00 from the export");
    // Closing at 21:00 with a 120-minute job: the last start is 19:00.
    assert.equal(times.at(-1), "19:00");
    assert.ok(times.every((t) => t >= "10:00" && t <= "19:00"));
    // 30-minute grid.
    assert.equal(times[1], "10:30");
  });

  test("a real booking is priced and timed from the seeded data", async () => {
    await seedDatabase(db, source);

    const response = await app.inject({
      method: "POST",
      url: "/api/bookings",
      payload: {
        vehicle_type_id: STADSWAGEN,
        service_ids: [DIEP_CLEAN_EXTERIEUR],
        preferred_date: "2026-10-05",
        preferred_time: "10:00",
        customer_name: "Seed Smoke Test",
        customer_email: "seed-smoke@example.test",
        customer_phone: "0470000001",
        vehicle_brand: "Volvo",
        vehicle_model: "V40",
        on_location: false,
      },
    });
    assert.equal(response.statusCode, 201, response.body);
    const booking = (response.json() as { data: Record<string, unknown> }).data;

    // The export says Stadswagen + Diep Clean Exterieur = 49.95 excl. VAT, 120 minutes.
    const pricing = booking.pricing as { total_excl_vat: number; total_incl_vat: number };
    assert.equal(pricing.total_excl_vat, 49.95);
    assert.equal(pricing.total_incl_vat, Number((49.95 * 1.21).toFixed(2)));
    assert.equal(booking.total_duration_minutes, 120);
    assert.equal(booking.pickup_time, "12:00", "10:00 + 120 minutes");

    const stored = (await db.select().from(schema.bookings))[0]!;
    assert.equal(stored.totalPrice, "49.95");
    assert.equal(stored.totalDurationMinutes, 120);
  });

  test("a service the export does not price for a vehicle type cannot be booked", async () => {
    await seedDatabase(db, source);

    // "Velgen Coating" has pricing rows for four vehicle types, not for Caravan/Mobilehome.
    const caravan = "11111111-1111-1111-1111-111111111105";
    const velgenCoating = source.services.find((s) => s.title === "Velgen Coating")!;
    assert.ok(
      !source.prijzen_per_voertuigtype.some(
        (r) => r.vehicle_type_id === caravan && r.service_id === velgenCoating.id,
      ),
      "precondition: not priced for a caravan",
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/bookings",
      payload: {
        vehicle_type_id: caravan,
        service_ids: [velgenCoating.id],
        preferred_date: "2026-10-06",
        preferred_time: "10:00",
        customer_name: "Seed Smoke Test",
        customer_email: "seed-smoke@example.test",
        customer_phone: "0470000001",
        vehicle_brand: "Hobby",
        vehicle_model: "Prestige",
        on_location: false,
      },
    });
    assert.equal(response.statusCode, 404);
    assert.equal((response.json() as { error: { code: string } }).error.code, "SERVICE_NOT_FOUND");
    assert.equal(await rows(db.select({ id: schema.bookings.id }).from(schema.bookings)), 0);
  });
});
