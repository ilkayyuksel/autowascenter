// Phase 8 guarantees for the production Docker stack (deploy/). These read the
// infrastructure files themselves, so the contract cannot silently drift: only Caddy may
// publish ports, the database stays internal, the web image never receives server secrets,
// images stay pinned, and uploads/backups live in volumes instead of images.
//
// They verify the CONFIGURATION. Running the stack (real PostgreSQL, persistence, restore)
// needs a Docker engine; see docs/PRODUCTION-DEPLOYMENT.md for those steps.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const COMPOSE = read("deploy/docker-compose.yml");
const CADDYFILE = read("deploy/Caddyfile");
const ENV_EXAMPLE = read("deploy/.env.example");
const DOCKERIGNORE = read(".dockerignore");

/** The compose file's service blocks, by name (indentation-based, no YAML dependency). */
function services(): Record<string, string> {
  const lines = COMPOSE.split("\n");
  const start = lines.findIndex((l) => l === "services:");
  assert.ok(start >= 0, "services: block");
  const result: Record<string, string> = {};
  let current: string | null = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && line.trim() !== "") break; // next top-level key
    const header = /^ {2}([a-z][\w-]*):\s*$/.exec(line);
    if (header) {
      current = header[1]!;
      result[current] = "";
    } else if (current) {
      result[current] += `${line}\n`;
    }
  }
  return result;
}

const SERVICES = services();
const SERVER_SECRETS = ["DATABASE_URL", "POSTGRES_PASSWORD", "PGPASSWORD", "CLIENT_SECRET"];

describe("deploy stack: services and networking", () => {
  test("the stack has exactly the five expected services", () => {
    assert.deepEqual(Object.keys(SERVICES).sort(), ["api", "backup", "caddy", "postgres", "web"]);
  });

  test("only Caddy publishes host ports (80/443); everything else is internal", () => {
    for (const [name, block] of Object.entries(SERVICES)) {
      if (name === "caddy") continue;
      assert.doesNotMatch(block, /^\s+ports:/m, `${name} must not publish a port`);
    }
    const caddy = SERVICES.caddy!;
    assert.match(caddy, /ports:/);
    const published = [...caddy.matchAll(/^\s+- "(\d+):/gm)].map((m) => m[1]);
    assert.deepEqual([...new Set(published)].sort(), ["443", "80"]);
  });

  test("every service is on the private network only", () => {
    for (const [name, block] of Object.entries(SERVICES)) {
      assert.match(block, /networks:\s*\n\s+- internal/, name);
    }
    assert.match(COMPOSE, /^networks:\s*\n\s+internal:/m);
  });

  test("the API reaches PostgreSQL by service name, never localhost", () => {
    const databaseUrl = /^\s+DATABASE_URL: (.+)$/m.exec(SERVICES.api!)?.[1];
    assert.ok(databaseUrl, "DATABASE_URL");
    assert.match(databaseUrl, /@postgres:5432\//);
    assert.doesNotMatch(databaseUrl, /localhost|127\.0\.0\.1/);
  });
});

describe("deploy stack: secrets stay out of the web image", () => {
  test("the web service gets no server secret, in neither build args nor environment", () => {
    const web = SERVICES.web!;
    for (const secret of SERVER_SECRETS) {
      assert.ok(!web.includes(secret), `${secret} must not reach the web service`);
    }
    // Only public build-time values.
    const args = [...web.matchAll(/^\s{8}(\w+):/gm)].map((m) => m[1]!);
    assert.ok(args.length > 0);
    for (const arg of args) assert.match(arg, /^VITE_/, arg);
  });

  test("the API base URL is empty: the browser calls /api on the site's own origin", () => {
    assert.match(SERVICES.web!, /VITE_API_BASE_URL: \$\{VITE_API_BASE_URL-\}/);
    // The API serves its routes under /api itself, so "/api" as a base would double it.
    assert.match(ENV_EXAMPLE, /^VITE_API_BASE_URL=$/m);
  });

  /**
   * `.env.example` marks each variable with the `[REQUIRED]`/`[OPTIONAL]` comment above it.
   * Returns that marker per variable name.
   */
  function envExampleMarkers(): Record<string, "REQUIRED" | "OPTIONAL"> {
    const markers: Record<string, "REQUIRED" | "OPTIONAL"> = {};
    let current: "REQUIRED" | "OPTIONAL" | null = null;
    for (const line of ENV_EXAMPLE.split("\n")) {
      const marker = /^#\s*\[(REQUIRED|OPTIONAL)\]/.exec(line);
      if (marker) current = marker[1] as "REQUIRED" | "OPTIONAL";
      const assignment = /^([A-Z][A-Z0-9_]*)=/.exec(line);
      if (assignment && current) markers[assignment[1]!] = current;
    }
    return markers;
  }

  /** The compose file without comment lines, so documented examples are not scanned. */
  const COMPOSE_CODE = COMPOSE.split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

  test("every required variable fails loudly instead of becoming a blank string", () => {
    // Compose substitutes an empty string for an unset variable, which used to start the
    // stack with DOMAIN="", CORS_ORIGIN="https://" and an empty database password. The
    // `${VAR:?...}` form makes Compose name every missing variable and refuse instead.
    const required = [
      "DOMAIN",
      "POSTGRES_DB",
      "POSTGRES_USER",
      "POSTGRES_PASSWORD",
      "AUTH0_DOMAIN",
      "AUTH0_AUDIENCE",
      "VITE_AUTH0_DOMAIN",
      "VITE_AUTH0_CLIENT_ID",
      "VITE_AUTH0_AUDIENCE",
    ];
    const markers = envExampleMarkers();
    for (const name of required) {
      assert.match(
        COMPOSE_CODE,
        new RegExp(`\\$\\{${name}:\\?[^}]+\\}`),
        `${name} must be declared required in the compose file`,
      );
      assert.equal(markers[name], "REQUIRED", `${name} must be marked [REQUIRED] in .env.example`);
    }
    // Optional ones must NOT be required, or an empty value would block the stack.
    for (const name of ["DATABASE_URL", "CORS_ORIGIN", "PUBLIC_UPLOAD_URL", "AUTH0_ISSUER"]) {
      assert.doesNotMatch(
        COMPOSE_CODE,
        new RegExp(`\\$\\{${name}:\\?`),
        `${name} must stay optional`,
      );
      assert.equal(markers[name], "OPTIONAL", `${name} must be marked [OPTIONAL]`);
    }
    // VITE_API_BASE_URL must stay optional AND empty: see the same-origin test above.
    assert.equal(markers.VITE_API_BASE_URL, "OPTIONAL");
  });

  test("every variable the stack interpolates is documented in .env.example", () => {
    const used = new Set(
      [...COMPOSE_CODE.matchAll(/\$\{([A-Z][A-Z0-9_]*)[:?\-}]/g)].map((m) => m[1]!),
    );
    assert.ok(used.size >= 20, `expected the full set, found ${used.size}`);
    for (const name of [...used].sort()) {
      assert.match(ENV_EXAMPLE, new RegExp(`^${name}=`, "m"), `${name} missing from .env.example`);
    }
    // And nothing documented there is unused, so the file never grows dead settings.
    const documented = [...ENV_EXAMPLE.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!);
    for (const name of documented) {
      assert.ok(used.has(name), `${name} is in .env.example but used nowhere in the stack`);
    }
  });

  test("the stack requires Compose V2 and says so where it breaks", () => {
    // `name:` is Compose-Spec only; the legacy 1.x binary rejects it. Keep the fixed
    // project name (it is what makes the volumes autowascenter_*), and document it.
    assert.match(COMPOSE, /^name: autowascenter$/m);
    assert.match(COMPOSE, /docker-compose/, "the legacy binary must be called out");
    assert.match(COMPOSE, /deploy\/\.env/, "where the env file is read from");
  });

  test("deploy/.env.example holds placeholders only, and .env is never built in", () => {
    assert.doesNotMatch(ENV_EXAMPLE, /eyJ[A-Za-z0-9_-]{10,}/, "no token-like value");
    assert.match(ENV_EXAMPLE, /^POSTGRES_PASSWORD=change-me/m);
    assert.doesNotMatch(ENV_EXAMPLE, /AUTH0_CLIENT_SECRET/);
    for (const pattern of [".env", "node_modules", "uploads", "backups", ".output"]) {
      assert.ok(
        DOCKERIGNORE.split("\n").some((l) => l.trim() === pattern),
        `.dockerignore must exclude ${pattern}`,
      );
    }
  });
});

describe("deploy stack: images, health and persistence", () => {
  test("all images are pinned to an explicit version", () => {
    const images = [
      ...COMPOSE.matchAll(/^\s+image: (\S+)$/gm),
      ...[
        "deploy/docker/web.Dockerfile",
        "deploy/docker/api.Dockerfile",
        "deploy/docker/backup.Dockerfile",
      ].flatMap((f) => [...read(f).matchAll(/^FROM (\S+)/gm)]),
    ].map((m) => m[1]!);
    assert.ok(images.length >= 6);
    for (const image of images) {
      assert.doesNotMatch(image, /:latest$/, image);
      assert.match(image, /:/, `${image} must carry a tag`);
    }
    assert.ok(images.includes("postgres:18.6-alpine"));
    assert.ok(images.includes("caddy:2.11.4-alpine"));
    assert.ok(images.includes("node:22.18.0-alpine"));
  });

  test("PostgreSQL, API and web have a healthcheck; the API's is the readiness endpoint", () => {
    for (const name of ["postgres", "api", "web"]) {
      assert.match(SERVICES[name]!, /healthcheck:/, name);
    }
    assert.match(SERVICES.api!, /health\/db/);
    // The web healthcheck must not depend on the database.
    assert.doesNotMatch(SERVICES.web!, /health\/db/);
    assert.match(SERVICES.postgres!, /pg_isready/);
    assert.match(SERVICES.api!, /depends_on:\s*\n\s+postgres:\s*\n\s+condition: service_healthy/);
  });

  test("data lives in named volumes: database, uploads, backups and Caddy state", () => {
    for (const volume of [
      "postgres_data",
      "uploads_data",
      "backup_data",
      "caddy_data",
      "caddy_config",
    ]) {
      assert.match(COMPOSE, new RegExp(`^\\s{2}${volume}:`, "m"), volume);
    }
    assert.match(SERVICES.postgres!, /- postgres_data:\/var\/lib\/postgresql/);
    assert.match(SERVICES.api!, /- uploads_data:\/app\/uploads/);
    // Only the backup job may see the backups: not the API, not the web app, not Caddy.
    for (const name of ["api", "web", "caddy", "postgres"]) {
      assert.ok(!SERVICES[name]!.includes("backup_data"), name);
    }
    assert.match(SERVICES.backup!, /- backup_data:\/backups/);
  });

  test("starting the stack never migrates: migrations are a separate command", () => {
    assert.doesNotMatch(SERVICES.api!, /^\s+(command|entrypoint):/m);
    assert.match(COMPOSE, /run --rm api node src\/scripts\/migrate\.ts/);
  });

  test("web and API run non-root with a read-only root filesystem", () => {
    for (const file of ["deploy/docker/web.Dockerfile", "deploy/docker/api.Dockerfile"]) {
      assert.match(read(file), /^USER node$/m, file);
    }
    for (const name of ["api", "web"]) {
      assert.match(SERVICES[name]!, /read_only: true/, name);
      assert.match(SERVICES[name]!, /cap_drop:\s*\n\s+- ALL/, name);
    }
    for (const block of Object.values(SERVICES)) {
      assert.match(block, /no-new-privileges:true/);
    }
  });
});

describe("deploy stack: Caddy routing", () => {
  test("/api and /uploads go to the API, everything else to the web app", () => {
    assert.match(CADDYFILE, /handle \/api\/\* \{\s*\n\s*reverse_proxy api:3001/);
    assert.match(CADDYFILE, /handle \/uploads\/\* \{\s*\n\s*reverse_proxy api:3001/);
    assert.match(CADDYFILE, /handle \{\s*\n\s*reverse_proxy web:3000/);
    // The uploads must not fall through to the web container.
    assert.ok(CADDYFILE.indexOf("handle /uploads/*") < CADDYFILE.indexOf("handle {"));
  });

  test("the domain is configurable and nothing hardcodes the production host", () => {
    assert.match(CADDYFILE, /\{\$DOMAIN\}/);
    assert.doesNotMatch(CADDYFILE, /autowascenter\.be/);
    assert.match(ENV_EXAMPLE, /^DOMAIN=example\.com$/m);
  });

  test("certificate state is persisted, so restarts do not re-request certificates", () => {
    assert.match(SERVICES.caddy!, /- caddy_data:\/data/);
    assert.match(SERVICES.caddy!, /- caddy_config:\/config/);
    assert.match(SERVICES.caddy!, /\.\/Caddyfile:\/etc\/caddy\/Caddyfile:ro/);
  });
});
