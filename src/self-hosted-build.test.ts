// Phase 7C guarantees: the web app is a self-hosted Node/TanStack Start app without any
// Supabase, Lovable or Cloudflare Workers runtime or build dependency. These checks read the
// repository itself, so a reintroduced dependency fails the test suite.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { describe, test } from "node:test";

const ROOT = new URL("..", import.meta.url);
const path = (p: string) => new URL(p, ROOT);
const read = (p: string) => readFileSync(path(p), "utf8");

/** All non-test source files under src/. */
function sourceFiles(dir = "src"): string[] {
  return readdirSync(path(dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(path(rel)).isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [rel] : [];
  });
}

describe("no Supabase / Lovable / Cloudflare in the web app", () => {
  test("package.json: legacy dependencies removed, Node start script", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of [
      "@supabase/supabase-js",
      "@lovable.dev/vite-tanstack-config",
      "@cloudflare/vite-plugin",
      "wrangler",
    ]) {
      assert.equal(name in all, false, name);
    }
    assert.equal(pkg.scripts.build, "vite build");
    assert.equal(pkg.scripts.start, "node .output/server/index.mjs");
  });

  test("vite.config.ts: explicit plugins, Nitro node-server preset, no Lovable/Cloudflare", () => {
    const config = read("vite.config.ts");
    assert.match(config, /nitro\(\{ preset: "node-server" \}\)/);
    for (const plugin of ["tanstackStart(", "viteReact(", "tailwindcss(", "tsConfigPaths("]) {
      assert.ok(config.includes(plugin), plugin);
    }
    assert.doesNotMatch(config, /from "@lovable\.dev|@cloudflare|cloudflare-module|LOVABLE_/);
  });

  test("legacy files are gone; the Supabase schema history is archived", () => {
    for (const gone of [
      "wrangler.jsonc",
      "bun.lockb",
      "bunfig.toml",
      "supabase",
      "src/integrations/supabase",
      "src/lib/slots.ts",
    ]) {
      assert.equal(existsSync(path(gone)), false, gone);
    }
    assert.ok(existsSync(path("docs/legacy/supabase/migrations")));
    assert.match(read("docs/legacy/supabase/README.md"), /ARCHIVED — NOT USED BY APPLICATION/);
  });

  test("no source file imports or calls Supabase, or references Lovable/R2 hosting", () => {
    const files = sourceFiles();
    assert.ok(files.length > 50);
    for (const file of files) {
      const source = read(file);
      assert.doesNotMatch(
        source,
        /@supabase\/|integrations\/supabase|supabase\.(from|auth|storage|rpc)\(/,
        file,
      );
      assert.doesNotMatch(source, /lovable\.(app|dev)|lovableproject|r2\.dev|@lovable\.dev/, file);
    }
  });

  test("social preview image is self-hosted", () => {
    const rootRoute = read("src/routes/__root.tsx");
    assert.match(rootRoute, /og-image\.jpg/);
    assert.ok(existsSync(path("public/og-image.jpg")));
  });

  test(".env.example: only public VITE_ values, no Supabase and no server secrets", () => {
    const env = read(".env.example");
    const names = [...env.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]!);
    assert.deepEqual(names.sort(), [
      "VITE_API_BASE_URL",
      "VITE_AUTH0_AUDIENCE",
      "VITE_AUTH0_CLIENT_ID",
      "VITE_AUTH0_DOMAIN",
    ]);
    assert.doesNotMatch(env, /^[^#]*SUPABASE/m);
  });

  test("build output (when present) targets Node, not Cloudflare Workers", (t) => {
    const nitroJson = path(".output/nitro.json");
    if (!existsSync(nitroJson)) {
      t.skip("no .output yet (run npm run build)");
      return;
    }
    const meta = JSON.parse(readFileSync(nitroJson, "utf8")) as {
      preset: string;
      serverEntry: string;
    };
    assert.equal(meta.preset, "node-server");
    assert.equal(meta.serverEntry, "server/index.mjs");
    assert.equal(existsSync(path(".output/server/wrangler.json")), false);
  });
});
