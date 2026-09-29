// Integration tests for the PostgreSQL schema and migrations.
//
// Runs the real Drizzle migrations (drizzle/*.sql) against PGlite: the PostgreSQL
// engine compiled to WASM, in-process. No external database or Docker is needed.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

let pg: PGlite;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const res = await pg.query<T>(sql, params);
  assert.equal(res.rows.length, 1, `expected one row for: ${sql}`);
  return res.rows[0] as T;
}

async function expectPgError(promise: Promise<unknown>, code: string, constraint?: string) {
  await assert.rejects(promise, (err: { code?: string; constraint?: string }) => {
    assert.equal(err.code, code, `expected SQLSTATE ${code}, got ${err.code}`);
    if (constraint) assert.equal(err.constraint, constraint);
    return true;
  });
}

async function insertVehicleType(slug = "sedan") {
  return (
    await one<{ id: string }>(
      `INSERT INTO vehicle_types (slug, title) VALUES ($1, $2) RETURNING id`,
      [slug, slug],
    )
  ).id;
}

async function insertService(title = "Wax", kind = "dienst") {
  return (
    await one<{ id: string }>(`INSERT INTO services (title, kind) VALUES ($1, $2) RETURNING id`, [
      title,
      kind,
    ])
  ).id;
}

/** Inserts a booking; start/end are local Europe/Brussels wall-clock times. */
async function insertBooking(opts: {
  date: string;
  time: string;
  end: string;
  minutes?: number;
  status?: string;
  vehicleTypeId?: string | null;
  serviceId?: string | null;
}) {
  return (
    await one<{ id: string }>(
      `INSERT INTO bookings (
         customer_name, customer_email, customer_phone,
         preferred_date, preferred_time, start_at, end_at,
         total_duration_minutes, status, vehicle_type_id, service_id)
       VALUES ('Klant', 'klant@example.com', '0470000000',
         $1::date, $2::time,
         ($1::date + $2::time) AT TIME ZONE 'Europe/Brussels',
         $3::timestamp AT TIME ZONE 'Europe/Brussels',
         $4, $5::booking_status, $6, $7)
       RETURNING id`,
      [
        opts.date,
        opts.time,
        opts.end,
        opts.minutes ?? 60,
        opts.status ?? "nieuw",
        opts.vehicleTypeId ?? null,
        opts.serviceId ?? null,
      ],
    )
  ).id;
}

before(async () => {
  pg = new PGlite({ extensions: { btree_gist } });
  await migrate(drizzle(pg), { migrationsFolder });
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(`TRUNCATE bookings, booking_services, package_services, vehicle_type_services,
    services, vehicle_types, blocked_periods, site_settings, gallery_items, reviews CASCADE`);
});

describe("migrations", () => {
  test("create exactly the expected application tables", async () => {
    const res = await pg.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    assert.deepEqual(
      res.rows.map((r) => r.table_name),
      [
        "blocked_periods",
        "booking_services",
        "bookings",
        "gallery_items",
        "package_services",
        "reviews",
        "services",
        "site_settings",
        "vehicle_type_services",
        "vehicle_types",
      ],
    );
  });

  test("contain no Supabase auth/role objects", async () => {
    const leftovers = await pg.query(
      `SELECT 1 FROM pg_proc WHERE proname = 'has_role'
       UNION ALL SELECT 1 FROM pg_type WHERE typname = 'app_role'
       UNION ALL SELECT 1 FROM information_schema.tables WHERE table_name = 'user_roles'
       UNION ALL SELECT 1 FROM pg_namespace WHERE nspname IN ('auth', 'storage')`,
    );
    assert.equal(leftovers.rows.length, 0);
  });

  test("keep booking_status values unchanged", async () => {
    const res = await pg.query<{ v: string }>(
      `SELECT unnest(enum_range(NULL::booking_status))::text AS v`,
    );
    assert.deepEqual(
      res.rows.map((r) => r.v),
      ["nieuw", "bevestigd", "voltooid", "geannuleerd"],
    );
  });

  test("install btree_gist and all 8 updated_at triggers", async () => {
    await one(`SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'`);
    const triggers = await pg.query(
      `SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = 'public'`,
    );
    assert.equal(triggers.rows.length, 8);
  });
});

describe("booking overlap exclusion constraint", () => {
  test("rejects two active bookings that overlap", async () => {
    await insertBooking({ date: "2026-10-05", time: "10:00", end: "2026-10-05 12:00" });
    await expectPgError(
      insertBooking({ date: "2026-10-05", time: "11:00", end: "2026-10-05 13:00" }),
      "23P01",
      "bookings_no_overlap_excl",
    );
  });

  test("allows back-to-back bookings (end is exclusive)", async () => {
    await insertBooking({ date: "2026-10-05", time: "10:00", end: "2026-10-05 12:00" });
    await insertBooking({ date: "2026-10-05", time: "12:00", end: "2026-10-05 13:00" });
  });

  test("ignores cancelled bookings", async () => {
    await insertBooking({
      date: "2026-10-05",
      time: "10:00",
      end: "2026-10-05 12:00",
      status: "geannuleerd",
    });
    await insertBooking({ date: "2026-10-05", time: "10:00", end: "2026-10-05 12:00" });
  });

  test("frees the slot when a booking is cancelled", async () => {
    const first = await insertBooking({
      date: "2026-10-05",
      time: "10:00",
      end: "2026-10-05 12:00",
    });
    await pg.query(`UPDATE bookings SET status = 'geannuleerd' WHERE id = $1`, [first]);
    await insertBooking({ date: "2026-10-05", time: "10:30", end: "2026-10-05 11:30" });
  });

  test("rejects re-activating a cancelled booking whose slot was taken", async () => {
    const cancelled = await insertBooking({
      date: "2026-10-05",
      time: "10:00",
      end: "2026-10-05 12:00",
      status: "geannuleerd",
    });
    await insertBooking({ date: "2026-10-05", time: "10:00", end: "2026-10-05 12:00" });
    await expectPgError(
      pg.query(`UPDATE bookings SET status = 'bevestigd' WHERE id = $1`, [cancelled]),
      "23P01",
    );
  });

  test("completed bookings still block their time", async () => {
    await insertBooking({
      date: "2026-10-05",
      time: "10:00",
      end: "2026-10-05 12:00",
      status: "voltooid",
    });
    await expectPgError(
      insertBooking({ date: "2026-10-05", time: "11:00", end: "2026-10-05 11:30" }),
      "23P01",
    );
  });

  test("covers multi-day bookings that continue the next day", async () => {
    // Starts 20:00, continues next morning until 11:00 (pickup).
    await insertBooking({
      date: "2026-10-05",
      time: "20:00",
      end: "2026-10-06 11:00",
      minutes: 180,
    });
    await expectPgError(
      insertBooking({ date: "2026-10-06", time: "10:00", end: "2026-10-06 12:00" }),
      "23P01",
    );
    await insertBooking({ date: "2026-10-06", time: "11:00", end: "2026-10-06 12:00" });
  });
});

describe("bookings constraints", () => {
  test("start_at must match preferred_date + preferred_time in Europe/Brussels", async () => {
    // Summer time (UTC+2): 10:00 local = 08:00 UTC.
    const { utcHour } = await one<{ utcHour: number }>(
      `SELECT extract(hour FROM start_at AT TIME ZONE 'UTC')::int AS "utcHour" FROM bookings WHERE id = $1`,
      [await insertBooking({ date: "2026-07-01", time: "10:00", end: "2026-07-01 11:00" })],
    );
    assert.equal(utcHour, 8);

    await expectPgError(
      pg.query(
        `INSERT INTO bookings (customer_name, customer_email, customer_phone, preferred_date,
           preferred_time, start_at, end_at, total_duration_minutes)
         VALUES ('K', 'k@example.com', '1', '2026-10-05', '10:00',
           '2026-10-05 10:00+00', '2026-10-05 12:00+00', 60)`,
      ),
      "23514",
      "bookings_start_matches_local_check",
    );
  });

  test("rejects an end before the start and a non-positive duration", async () => {
    await expectPgError(
      insertBooking({ date: "2026-10-05", time: "10:00", end: "2026-10-05 09:00" }),
      "23514",
      "bookings_interval_check",
    );
    await expectPgError(
      insertBooking({ date: "2026-10-05", time: "10:00", end: "2026-10-05 11:00", minutes: 0 }),
      "23514",
      "bookings_total_duration_check",
    );
  });

  test("rejects a negative total price", async () => {
    const id = await insertBooking({ date: "2026-10-05", time: "10:00", end: "2026-10-05 11:00" });
    await expectPgError(
      pg.query(`UPDATE bookings SET total_price = -1 WHERE id = $1`, [id]),
      "23514",
      "bookings_total_price_check",
    );
  });

  test("cancel_token is generated and unique", async () => {
    const a = await insertBooking({ date: "2026-10-05", time: "10:00", end: "2026-10-05 11:00" });
    const b = await insertBooking({ date: "2026-10-05", time: "11:00", end: "2026-10-05 12:00" });
    const { cancel_token } = await one<{ cancel_token: string }>(
      `SELECT cancel_token FROM bookings WHERE id = $1`,
      [a],
    );
    assert.match(cancel_token, /^[0-9a-f-]{36}$/);
    await expectPgError(
      pg.query(`UPDATE bookings SET cancel_token = $1 WHERE id = $2`, [cancel_token, b]),
      "23505",
      "bookings_cancel_token_key",
    );
  });
});

describe("foreign keys", () => {
  test("a vehicle type with bookings cannot be deleted (RESTRICT)", async () => {
    const vt = await insertVehicleType();
    await insertBooking({
      date: "2026-10-05",
      time: "10:00",
      end: "2026-10-05 11:00",
      vehicleTypeId: vt,
    });
    await expectPgError(pg.query(`DELETE FROM vehicle_types WHERE id = $1`, [vt]), "23001");
  });

  test("deleting a vehicle type without bookings cascades its prices", async () => {
    const vt = await insertVehicleType();
    const svc = await insertService();
    await pg.query(
      `INSERT INTO vehicle_type_services (vehicle_type_id, service_id, price, duration_minutes)
       VALUES ($1, $2, 40, 60)`,
      [vt, svc],
    );
    await pg.query(`DELETE FROM vehicle_types WHERE id = $1`, [vt]);
    const { n } = await one<{ n: number }>(`SELECT count(*)::int AS n FROM vehicle_type_services`);
    assert.equal(n, 0);
  });

  test("deleting a service keeps booking snapshots (SET NULL) and cascades catalogue rows", async () => {
    const svc = await insertService("Wax");
    const pkg = await insertService("Full detail", "pakket");
    await pg.query(`INSERT INTO package_services (package_id, service_id) VALUES ($1, $2)`, [
      pkg,
      svc,
    ]);
    const booking = await insertBooking({
      date: "2026-10-05",
      time: "10:00",
      end: "2026-10-05 11:00",
      serviceId: svc,
    });
    await pg.query(
      `INSERT INTO booking_services (booking_id, service_id, service_title, price, duration_minutes)
       VALUES ($1, $2, 'Wax', 65, 60)`,
      [booking, svc],
    );

    await pg.query(`DELETE FROM services WHERE id = $1`, [svc]);

    const b = await one<{ service_id: string | null }>(
      `SELECT service_id FROM bookings WHERE id = $1`,
      [booking],
    );
    assert.equal(b.service_id, null);
    const line = await one<{ service_id: string | null; service_title: string; price: string }>(
      `SELECT service_id, service_title, price FROM booking_services WHERE booking_id = $1`,
      [booking],
    );
    assert.deepEqual(line, { service_id: null, service_title: "Wax", price: "65.00" });
    const { n } = await one<{ n: number }>(`SELECT count(*)::int AS n FROM package_services`);
    assert.equal(n, 0);
  });

  test("deleting a booking cascades its booking_services", async () => {
    const booking = await insertBooking({
      date: "2026-10-05",
      time: "10:00",
      end: "2026-10-05 11:00",
    });
    await pg.query(`INSERT INTO booking_services (booking_id, service_title) VALUES ($1, 'Wax')`, [
      booking,
    ]);
    await pg.query(`DELETE FROM bookings WHERE id = $1`, [booking]);
    const { n } = await one<{ n: number }>(`SELECT count(*)::int AS n FROM booking_services`);
    assert.equal(n, 0);
  });
});

describe("catalogue and settings constraints", () => {
  test("services.kind only accepts dienst, pakket or extra", async () => {
    for (const kind of ["dienst", "pakket", "extra"]) await insertService(kind, kind);
    await expectPgError(insertService("x", "anders"), "23514", "services_kind_check");
  });

  test("a package cannot contain itself or the same service twice", async () => {
    const pkg = await insertService("Pakket", "pakket");
    const svc = await insertService();
    await expectPgError(
      pg.query(`INSERT INTO package_services (package_id, service_id) VALUES ($1, $1)`, [pkg]),
      "23514",
      "package_services_not_self_check",
    );
    await pg.query(`INSERT INTO package_services (package_id, service_id) VALUES ($1, $2)`, [
      pkg,
      svc,
    ]);
    await expectPgError(
      pg.query(`INSERT INTO package_services (package_id, service_id) VALUES ($1, $2)`, [pkg, svc]),
      "23505",
    );
  });

  test("vehicle_type_services rejects negative prices and duplicate combinations", async () => {
    const vt = await insertVehicleType();
    const svc = await insertService();
    await expectPgError(
      pg.query(
        `INSERT INTO vehicle_type_services (vehicle_type_id, service_id, price) VALUES ($1, $2, -5)`,
        [vt, svc],
      ),
      "23514",
      "vehicle_type_services_price_check",
    );
    await pg.query(
      `INSERT INTO vehicle_type_services (vehicle_type_id, service_id) VALUES ($1, $2)`,
      [vt, svc],
    );
    await expectPgError(
      pg.query(`INSERT INTO vehicle_type_services (vehicle_type_id, service_id) VALUES ($1, $2)`, [
        vt,
        svc,
      ]),
      "23505",
    );
  });

  test("site_settings allows exactly one row with a valid opening window", async () => {
    await pg.query(`INSERT INTO site_settings DEFAULT VALUES`);
    await expectPgError(pg.query(`INSERT INTO site_settings DEFAULT VALUES`), "23505");
    await expectPgError(
      pg.query(`UPDATE site_settings SET opening_hour = '22:00', closing_hour = '08:00'`),
      "23514",
      "site_settings_hours_check",
    );
  });

  test("blocked_periods keeps one-sided times but rejects inverted ranges", async () => {
    await pg.query(
      `INSERT INTO blocked_periods (start_date, end_date, start_time) VALUES ('2026-10-05', '2026-10-05', '14:00')`,
    );
    await expectPgError(
      pg.query(
        `INSERT INTO blocked_periods (start_date, end_date) VALUES ('2026-10-06', '2026-10-05')`,
      ),
      "23514",
      "blocked_periods_dates_check",
    );
    await expectPgError(
      pg.query(
        `INSERT INTO blocked_periods (start_date, end_date, start_time, end_time)
         VALUES ('2026-10-05', '2026-10-05', '12:00', '10:00')`,
      ),
      "23514",
      "blocked_periods_times_check",
    );
  });

  test("reviews.rating must be between 1 and 5", async () => {
    await expectPgError(
      pg.query(`INSERT INTO reviews (customer_name, rating, content) VALUES ('A', 6, 'x')`),
      "23514",
      "reviews_rating_check",
    );
  });
});

describe("updated_at trigger", () => {
  test("bumps updated_at on update", async () => {
    const svc = await insertService();
    await pg.query(`UPDATE services SET updated_at = '2000-01-01' WHERE id = $1`, [svc]);
    const { fresh } = await one<{ fresh: boolean }>(
      `SELECT updated_at > '2020-01-01' AS fresh FROM services WHERE id = $1`,
      [svc],
    );
    assert.equal(fresh, true);
  });
});
