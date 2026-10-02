// Source-level guarantees for the public pages after phase 7A: their data comes from the
// own public API (public-reads.ts / public-writes.ts), not from Supabase. Since phase 7B
// no public page reads from or writes to Supabase.

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

  test("/reservatie: reads AND the submit via the API; no Supabase at all (7B)", () => {
    const source = read("src/routes/reservatie.tsx");
    for (const call of [
      "getPublicVehicleTypes",
      "getPublicVehicleTypeServices",
      "getPublicAvailability",
      "getPublicSiteSettings",
      "createPublicBooking",
      "toPublicBookingRequest",
    ]) {
      assert.match(source, new RegExp(`\\b${call}\\(`));
    }
    assert.doesNotMatch(source, /integrations\/supabase|supabase\./);
    assert.deepEqual(supabaseCalls(source), []);
    // Exactly one booking request; no separate booking_services write.
    assert.equal(source.match(/\bcreatePublicBooking\(/g)?.length, 1);
    assert.doesNotMatch(source, /booking_services|\.insert\(/);
    // No local slot computation and no direct reads of blocked periods or settings.
    assert.doesNotMatch(source, /lib\/slots|computeAvailableSlots|fetchSlotData|computePickup/);
    // The submit is guarded against double submission.
    assert.match(source, /submitGuard\.current\.start\(\)/);
  });
});
