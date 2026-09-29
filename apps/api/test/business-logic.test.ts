// Pure business rules: time zone, slot algorithm (ported from src/lib/slots.ts) and money.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays, fromLocal, nowLocal, toLocal } from "../src/lib/business-time.ts";
import {
  calculatePricing,
  toCents,
  toPricingContract,
  vatCents,
  type PricedLine,
} from "../src/services/pricing.service.ts";
import {
  candidateStarts,
  overlapsBlockedPeriod,
  planJob,
  toScheduleSettings,
  workSegments,
} from "../src/services/schedule.ts";

const settings = toScheduleSettings("10:00:00", "18:00:00", 30); // 480 min/day

describe("business time (Europe/Brussels)", () => {
  test("converts local wall-clock time with the correct CET/CEST offset", () => {
    assert.equal(fromLocal("2026-07-01", 600)!.toISOString(), "2026-07-01T08:00:00.000Z"); // CEST
    assert.equal(fromLocal("2026-12-01", 600)!.toISOString(), "2026-12-01T09:00:00.000Z"); // CET
  });

  test("handles both DST transition days", () => {
    // 2026-03-29: clocks go 02:00 → 03:00. 10:00 local is already CEST.
    assert.equal(fromLocal("2026-03-29", 600)!.toISOString(), "2026-03-29T08:00:00.000Z");
    // 2026-10-25: clocks go 03:00 → 02:00. 10:00 local is CET again.
    assert.equal(fromLocal("2026-10-25", 600)!.toISOString(), "2026-10-25T09:00:00.000Z");
  });

  test("rejects local times that do not exist or exist twice", () => {
    assert.equal(fromLocal("2026-03-29", 150), null); // 02:30 skipped
    assert.equal(fromLocal("2026-10-25", 150), null); // 02:30 happens twice
  });

  test("derives 'today' in Brussels, not in UTC", () => {
    // 23:30 UTC on 30 Sep is already 1 Oct 01:30 in Brussels.
    assert.deepEqual(nowLocal(new Date("2026-09-30T23:30:00Z")), {
      date: "2026-10-01",
      minutes: 90,
    });
    assert.deepEqual(toLocal(new Date("2026-12-31T23:00:00Z")), { date: "2027-01-01", minutes: 0 });
  });

  test("adds calendar days across months and years", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  });
});

describe("slot algorithm", () => {
  test("a job that fits in a day must end the same day", () => {
    const starts = candidateStarts(120, settings);
    assert.equal(starts[0], 600); // 10:00
    assert.equal(starts.at(-1), 960); // 16:00 (+2h = 18:00)
    assert.equal(starts.length, 13);
  });

  test("a job longer than a day can only start at opening time", () => {
    assert.deepEqual(candidateStarts(900, settings), [600]);
    assert.deepEqual(candidateStarts(480, settings), [600]); // exactly one day
  });

  test("enforces a minimum 5-minute interval and an empty window", () => {
    assert.equal(toScheduleSettings("10:00", "11:00", 1).intervalMinutes, 5);
    assert.deepEqual(candidateStarts(60, toScheduleSettings("10:00", "10:00", 30)), []);
  });

  test("multi-day work continues at opening time on the next calendar day", () => {
    // 900 min with a 480-min day: 10:00-18:00 on day 1, then 10:00-17:00 on day 2.
    assert.deepEqual(workSegments("2026-10-05", 600, 900, settings), [
      { date: "2026-10-05", start: 600, end: 1080 },
      { date: "2026-10-06", start: 600, end: 1020 },
    ]);
    // Continues on Sunday too: the current application has no weekday model.
    assert.deepEqual(
      workSegments("2026-10-10", 600, 600, settings).map((s) => s.date),
      ["2026-10-10", "2026-10-11"],
    );
  });

  test("plans absolute start/end and pickup without '25:00' clock strings", () => {
    const job = planJob("2026-10-05", 600, 900, settings)!;
    assert.equal(job.startAt.toISOString(), "2026-10-05T08:00:00.000Z");
    assert.equal(job.endAt.toISOString(), "2026-10-06T15:00:00.000Z"); // 17:00 next day
    assert.equal(job.pickupDate, "2026-10-06");
    assert.equal(job.pickupTime, "17:00");
  });

  test("a job across the autumn DST change keeps local times", () => {
    // Starts Sat 24 Oct (CEST), continues Sun 25 Oct (CET).
    const job = planJob("2026-10-24", 600, 540, settings)!;
    assert.equal(job.startAt.toISOString(), "2026-10-24T08:00:00.000Z");
    assert.equal(job.endAt.toISOString(), "2026-10-25T10:00:00.000Z"); // 11:00 CET
  });

  test("blocked periods: whole day, time range, one-sided and multi-day", () => {
    const seg = workSegments("2026-10-05", 600, 60, settings); // 10:00-11:00
    const block = (s: string, e: string, st: string | null, et: string | null) => [
      { startDate: s, endDate: e, startTime: st, endTime: et },
    ];
    assert.equal(overlapsBlockedPeriod(seg, block("2026-10-05", "2026-10-05", null, null)), true);
    assert.equal(
      overlapsBlockedPeriod(seg, block("2026-10-05", "2026-10-05", "10:30", "12:00")),
      true,
    );
    assert.equal(
      overlapsBlockedPeriod(seg, block("2026-10-05", "2026-10-05", "11:00", null)),
      false,
    );
    assert.equal(
      overlapsBlockedPeriod(seg, block("2026-10-01", "2026-10-09", null, "10:00")),
      false,
    );
    assert.equal(overlapsBlockedPeriod(seg, block("2026-10-06", "2026-10-06", null, null)), false);
    // A two-day job hits a block on its second day.
    const twoDays = workSegments("2026-10-05", 600, 600, settings);
    assert.equal(
      overlapsBlockedPeriod(twoDays, block("2026-10-06", "2026-10-06", "10:00", "11:00")),
      true,
    );
  });
});

describe("money", () => {
  test("parses numeric(10,2) strings exactly into cents", () => {
    assert.equal(toCents("74.75"), 7475);
    assert.equal(toCents("30"), 3000);
    assert.equal(toCents("0.1"), 10);
    assert.equal(toCents("850.00"), 85000);
  });

  test("VAT is 21 % rounded half-up to whole cents", () => {
    assert.equal(vatCents(10000), 2100);
    assert.equal(vatCents(250), 53); // 52.5 → 53
    assert.equal(vatCents(7475), 1570); // 1569.75 → 1570
  });

  test("totals: services + location fee excl. VAT, then VAT and incl. VAT", () => {
    const lines: PricedLine[] = [
      { serviceId: "a", title: "A", kind: "dienst", priceCents: 7475, durationMinutes: 60 },
      { serviceId: "b", title: "B", kind: "extra", priceCents: 7500, durationMinutes: 60 },
    ];
    assert.deepEqual(toPricingContract(calculatePricing(lines, 0)), {
      services_subtotal: 149.75,
      location_fee: 0,
      total_excl_vat: 149.75,
      vat_rate: 0.21,
      vat: 31.45, // 31.4475 → 31.45
      total_incl_vat: 181.2,
      currency: "EUR",
    });
  });
});
