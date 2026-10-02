// Source-level guarantees for the public pages after phase 7A: their data comes from the
// own public API (public-reads.ts), not from Supabase. The only Supabase use left on the
// public side is the booking submit of /reservatie (phase 7B).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/** Every `.from("<table>")` in a file, with the call chain that follows it. */
function supabaseCalls(source: string) {
  return [...source.matchAll(/\.from\("([a-z_]+)"\)([\s\S]{0,80})/g)].map((m) => ({
    table: m[1]!,
    chain: m[2]!,
  }));
}

const API_ONLY = {
  "src/routes/index.tsx": [],
  "src/components/ServicesPreview.tsx": ["getPublicServices"],
  "src/components/RealisationsPreview.tsx": ["getPublicGallery"],
  "src/components/Testimonials.tsx": ["getPublicReviews"],
  "src/routes/diensten.tsx": ["getPublicServices"],
  "src/routes/galerij.tsx": ["getPublicGallery"],
} as const;

describe("public pages read from the own API only", () => {
  for (const [file, loaders] of Object.entries(API_ONLY)) {
    test(`${file}: no Supabase import or query`, () => {
      const source = read(file);
      assert.doesNotMatch(source, /integrations\/supabase/);
      assert.deepEqual(supabaseCalls(source), []);
      for (const loader of loaders) assert.match(source, new RegExp(`\\b${loader}\\(`));
    });
  }

  test("/ (home) renders the three API-backed sections", () => {
    const source = read("src/routes/index.tsx");
    for (const component of ["ServicesPreview", "RealisationsPreview", "Testimonials"]) {
      assert.match(source, new RegExp(`<${component}\\b`));
    }
  });

  test("/reservatie: all reads via the API; Supabase only for the booking insert (7B)", () => {
    const source = read("src/routes/reservatie.tsx");
    for (const loader of [
      "getPublicVehicleTypes",
      "getPublicVehicleTypeServices",
      "getPublicAvailability",
      "getPublicSiteSettings",
    ]) {
      assert.match(source, new RegExp(`\\b${loader}\\(`));
    }
    const calls = supabaseCalls(source);
    assert.deepEqual(
      calls.map((c) => c.table).sort(),
      ["booking_services", "bookings"],
      "only the two write tables",
    );
    for (const call of calls) {
      assert.match(call.chain, /^\s*\.insert\(|^\.insert\(/, `${call.table} must be an insert`);
    }
    // No local slot computation and no direct reads of blocked periods or settings.
    assert.doesNotMatch(source, /lib\/slots|computeAvailableSlots|fetchSlotData|computePickup/);
    assert.doesNotMatch(source, /"blocked_periods"|"site_settings"|"vehicle_type_services"/);
  });
});
