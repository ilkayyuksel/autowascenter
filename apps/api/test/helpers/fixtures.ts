// Test catalogue shared by the pricing, availability and booking tests.
// Opening window 10:00–18:00 (480 min/day), 30-minute slot grid, like the frontend's defaults.

import { schema, type Database } from "../../src/db/index.ts";
import { fromLocal } from "../../src/lib/business-time.ts";

/** "Now" for tests: Thursday 2026-10-01 10:00 in Brussels (CEST, UTC+2). */
export const NOW = new Date("2026-10-01T08:00:00Z");
/** A future Monday. */
export const DAY = "2026-10-05";

export const localIso = (date: string, time: string) => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return fromLocal(date, h * 60 + m)!.toISOString();
};

export async function seedCatalog(db: Database) {
  await db.insert(schema.siteSettings).values({
    openingHour: "10:00",
    closingHour: "18:00",
    slotIntervalMinutes: 30,
  });

  const [sedan, suv, inactiveType] = await db
    .insert(schema.vehicleTypes)
    .values([
      { slug: "sedan", title: "Sedan", sortOrder: 10 },
      { slug: "suv", title: "SUV", sortOrder: 20 },
      { slug: "oud", title: "Oud", active: false },
    ])
    .returning();

  const svc = async (values: typeof schema.services.$inferInsert) =>
    (await db.insert(schema.services).values(values).returning())[0]!;

  const wax = await svc({ title: "Wax", price: "65.00", durationMinutes: 60 });
  const interior = await svc({ title: "Interieur" });
  const fullDetail = await svc({ title: "Full detail", kind: "pakket" });
  const ozone = await svc({ title: "Ozon", kind: "extra" });
  const walkIn = await svc({ title: "Express", bookable: false });
  const inactive = await svc({ title: "Weg", active: false });
  const notForSedan = await svc({ title: "Motorruimte" });
  const coating = await svc({ title: "Coating 3 jaar" });

  const row = (
    vehicleTypeId: string,
    serviceId: string,
    price: string,
    durationMinutes: number,
    available = true,
  ) => ({ vehicleTypeId, serviceId, price, durationMinutes, available });

  await db.insert(schema.vehicleTypeServices).values([
    row(sedan!.id, wax.id, "74.75", 60),
    row(sedan!.id, interior.id, "55.00", 90),
    row(sedan!.id, fullDetail.id, "250.00", 240),
    row(sedan!.id, ozone.id, "75.00", 60),
    row(sedan!.id, walkIn.id, "25.00", 30),
    row(sedan!.id, inactive.id, "10.00", 30),
    row(sedan!.id, notForSedan.id, "60.00", 45, false),
    row(sedan!.id, coating.id, "850.00", 900), // 15 h: spans two more days
    row(suv!.id, wax.id, "91.00", 75),
    row(suv!.id, fullDetail.id, "350.00", 300),
  ]);

  await db.insert(schema.packageServices).values([
    { packageId: fullDetail.id, serviceId: wax.id },
    { packageId: fullDetail.id, serviceId: interior.id },
  ]);

  return {
    vehicleTypes: { sedan: sedan!, suv: suv!, inactive: inactiveType! },
    services: { wax, interior, fullDetail, ozone, walkIn, inactive, notForSedan, coating },
  };
}

export type Catalog = Awaited<ReturnType<typeof seedCatalog>>;

/** Inserts a booking directly (bypassing the API) occupying [start, end) local times. */
export async function insertBookingAt(
  db: Database,
  opts: { date: string; time: string; endDate?: string; endTime: string; status?: string },
) {
  const startAt = new Date(localIso(opts.date, opts.time));
  const endAt = new Date(localIso(opts.endDate ?? opts.date, opts.endTime));
  const [row] = await db
    .insert(schema.bookings)
    .values({
      customerName: "Bestaand",
      customerEmail: "bestaand@example.com",
      customerPhone: "0470000000",
      preferredDate: opts.date,
      preferredTime: opts.time,
      startAt,
      endAt,
      totalDurationMinutes: Math.round((endAt.getTime() - startAt.getTime()) / 60_000),
      status: (opts.status ?? "bevestigd") as "bevestigd",
    })
    .returning({ id: schema.bookings.id });
  return row!.id;
}
