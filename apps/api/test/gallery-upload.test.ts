// Gallery storage end to end: upload, public files, delete, consistency. PGlite + local
// test Auth0 keys + a LocalStorageProvider in a temporary directory (never the repo).

import assert from "node:assert/strict";
import { access, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import { after, before, beforeEach, describe, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createApp } from "../src/app.ts";
import { galleryItemResponse } from "../src/contracts/admin-write.ts";
import { schema, type Database } from "../src/db/index.ts";
import { LocalStorageProvider } from "../src/storage/local-storage-provider.ts";
import { findOrphanUploads } from "../src/storage/orphans.ts";
import type { StorageProvider } from "../src/storage/storage-provider.ts";
import { createTestAuth, type TestAuth } from "./helpers/auth.ts";
import { failWhen } from "./helpers/failure.ts";
import { NOW } from "./helpers/fixtures.ts";
import { createTestDb } from "./helpers/test-db.ts";
import {
  imagePart,
  JPEG,
  multipartBody,
  PNG,
  SVG,
  tempDir,
  WEBP,
  type FormPart,
} from "./helpers/uploads.ts";

const BASE = "http://localhost:3001/uploads";
const MAX_BYTES = 4096;
const UUID_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const SUPABASE_URL =
  "https://abcd1234.supabase.co/storage/v1/object/public/gallery/0b0e4d4c-9a1f-4c55-8f3e-2f5c6a7b8c9d.jpg";

let pg: PGlite;
let db: Database;
let reset: () => Promise<unknown>;
let auth: TestAuth;
let token: string;
let root: string;
let removeRoot: () => Promise<void>;
let storage: LocalStorageProvider;
let app: FastifyInstance;
let logs: string[] = [];

const logStream = new Writable({
  write(chunk, _enc, done) {
    logs.push(String(chunk));
    done();
  },
});

async function buildApp(options: { storage?: StorageProvider | null; rateMax?: number } = {}) {
  return createApp({
    db,
    corsOrigins: ["http://localhost:8080"],
    logLevel: "info",
    logStream,
    tokenVerifier: auth.verifier,
    clock: () => NOW,
    storage: options.storage === undefined ? storage : options.storage,
    uploads: {
      maxBytes: MAX_BYTES,
      rateLimit: { max: options.rateMax ?? 1000, timeWindowMs: 60_000 },
    },
  });
}

before(async () => {
  const t = await createTestDb();
  pg = t.pg;
  db = t.db;
  reset = t.reset;
  auth = await createTestAuth();
  token = await auth.token();
  ({ dir: root, remove: removeRoot } = await tempDir());
  storage = await LocalStorageProvider.create({ rootDir: root, publicBaseUrl: BASE });
  app = await buildApp();
});
after(async () => {
  await app.close();
  await pg.close();
  await removeRoot();
});
beforeEach(async () => {
  await reset();
  for (const dir of ["gallery", ".staging"]) {
    for (const name of await readdir(join(root, dir))) await rm(join(root, dir, name));
  }
  await rm(join(root, ".env"), { force: true });
  logs = [];
});

const galleryDir = () => join(root, "gallery");
const galleryFiles = async () => (await readdir(galleryDir())).sort();
const stagingFiles = () => readdir(join(root, ".staging"));
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

async function upload(
  parts: FormPart[],
  { bearer = token, target = app }: { bearer?: string | null; target?: FastifyInstance } = {},
) {
  const { payload, contentType } = multipartBody(parts);
  const res = await target.inject({
    method: "POST",
    url: "/api/admin/gallery/upload",
    headers: {
      "content-type": contentType,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    payload,
  });
  return { status: res.statusCode, body: res.body, json: () => res.json() as unknown };
}

const errorShape = z.strictObject({
  error: z.strictObject({ code: z.string(), message: z.string() }),
});
function assertError(
  res: { status: number; json: () => unknown; body: string },
  status: number,
  code: string,
) {
  assert.equal(res.status, status, res.body);
  assert.equal(errorShape.parse(res.json()).error.code, code);
  // Never filesystem paths or internals in an error response.
  assert.ok(!res.body.includes(root), "no server path in response");
  assert.doesNotMatch(res.body, /\.staging|ENOENT|stack|at .*\.ts/);
}

async function assertNothingStored() {
  assert.deepEqual(await galleryFiles(), []);
  assert.deepEqual(await stagingFiles(), []);
  assert.equal((await db.select().from(schema.galleryItems)).length, 0);
}

async function uploadOk(data: Buffer, type: string, fields: FormPart[] = []) {
  const res = await upload([...fields, imagePart(data, type)]);
  assert.equal(res.status, 201, res.body);
  return galleryItemResponse.parse(res.json()).data;
}

describe("POST /api/admin/gallery/upload", () => {
  test("1. valid JPEG upload → 201, file stored, row created", async () => {
    const item = await uploadOk(JPEG, "image/jpeg");
    const name = item.image_url.slice(`${BASE}/gallery/`.length);
    assert.match(name, UUID_NAME);
    assert.ok(name.endsWith(".jpg"));
    assert.deepEqual(await readFile(join(galleryDir(), name)), JPEG);
    assert.deepEqual(await stagingFiles(), [], "staging is empty afterwards");
  });

  test("2. valid PNG upload", async () => {
    const item = await uploadOk(PNG, "image/png");
    assert.match(item.image_url, /\.png$/);
  });

  test("3. valid WebP upload", async () => {
    const item = await uploadOk(WEBP, "image/webp");
    assert.match(item.image_url, /\.webp$/);
  });

  test("4. invalid MIME types (SVG, GIF, HTML, octet-stream) → 415, nothing stored", async () => {
    for (const [data, type] of [
      [SVG, "image/svg+xml"],
      [Buffer.from("GIF89a...."), "image/gif"],
      [Buffer.from("<html></html>"), "text/html"],
      [JPEG, "application/octet-stream"],
    ] as const) {
      assertError(await upload([imagePart(data, type)]), 415, "UNSUPPORTED_MEDIA_TYPE");
    }
    await assertNothingStored();
  });

  test("5. fake MIME: wrong magic bytes or a type mismatch → 415", async () => {
    assertError(
      await upload([imagePart(Buffer.from("not really a png at all"), "image/png")]),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
    assertError(
      await upload([imagePart(SVG, "image/jpeg", "x.jpg")]),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
    assertError(await upload([imagePart(PNG, "image/jpeg")]), 415, "UNSUPPORTED_MEDIA_TYPE");
    const php = Buffer.from("<?php system($_GET['c']); ?>");
    assertError(
      await upload([imagePart(php, "image/jpeg", "shell.php.jpg")]),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
    await assertNothingStored();
  });

  test("6. file too large → 413 FILE_TOO_LARGE, nothing stored; exact limit is accepted", async () => {
    const tooBig = Buffer.concat([JPEG, Buffer.alloc(MAX_BYTES)]);
    assertError(await upload([imagePart(tooBig, "image/jpeg")]), 413, "FILE_TOO_LARGE");
    await assertNothingStored();

    const exact = Buffer.concat([JPEG, Buffer.alloc(MAX_BYTES - JPEG.length)]);
    const item = await uploadOk(exact, "image/jpeg");
    assert.ok(item.id);
  });

  test("7. malformed or wrong multipart → 4xx, nothing stored", async () => {
    const send = (payload: string | Buffer, contentType: string) =>
      app
        .inject({
          method: "POST",
          url: "/api/admin/gallery/upload",
          headers: { authorization: `Bearer ${token}`, "content-type": contentType },
          payload,
        })
        .then((r) => ({ status: r.statusCode, body: r.body, json: () => r.json() as unknown }));

    // Truncated body: no closing boundary.
    const { payload, contentType } = multipartBody([imagePart(JPEG, "image/jpeg")]);
    assertError(
      await send(payload.subarray(0, payload.length - 40), contentType),
      400,
      "MALFORMED_MULTIPART",
    );
    // Garbage with a multipart content type.
    assertError(await send("this is not multipart", contentType), 400, "MALFORMED_MULTIPART");
    // Not multipart at all.
    assertError(await send('{"image_url":"x"}', "application/json"), 415, "UNSUPPORTED_MEDIA_TYPE");
    // No file, two files, wrong field name, unknown / duplicate fields, client image_url.
    assertError(await upload([{ name: "title", value: "x" }]), 400, "VALIDATION_ERROR");
    assertError(
      await upload([imagePart(JPEG, "image/jpeg"), imagePart(PNG, "image/png")]),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await upload([{ name: "image", filename: "a.jpg", type: "image/jpeg", data: JPEG }]),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await upload([{ name: "image_url", value: "/etc/passwd" }, imagePart(JPEG, "image/jpeg")]),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await upload([
        { name: "title", value: "a" },
        { name: "title", value: "b" },
        imagePart(JPEG, "image/jpeg"),
      ]),
      400,
      "VALIDATION_ERROR",
    );
    assertError(
      await upload([{ name: "sort_order", value: "-1" }, imagePart(JPEG, "image/jpeg")]),
      400,
      "VALIDATION_ERROR",
    );
    assertError(await upload([imagePart(Buffer.alloc(0), "image/jpeg")]), 400, "EMPTY_FILE");
    await assertNothingStored();
  });

  test("8. unauthenticated upload → 401, nothing stored", async () => {
    assertError(
      await upload([imagePart(JPEG, "image/jpeg")], { bearer: null }),
      401,
      "AUTHENTICATION_REQUIRED",
    );
    assertError(
      await upload([imagePart(JPEG, "image/jpeg")], { bearer: await auth.foreignToken() }),
      401,
      "AUTHENTICATION_INVALID",
    );
    await assertNothingStored();
  });

  test("9. authenticated non-admin upload → 403, nothing stored", async () => {
    const noPermission = await auth.token({ permissions: [] });
    assertError(
      await upload([imagePart(JPEG, "image/jpeg")], { bearer: noPermission }),
      403,
      "AUTHORIZATION_REQUIRED",
    );
    await assertNothingStored();
  });

  test("10. admin upload stores metadata and shows up in public and admin lists", async () => {
    const item = await uploadOk(PNG, "image/png", [
      { name: "title", value: "  Polijstbeurt  " },
      { name: "description", value: "" },
      { name: "sort_order", value: "7" },
    ]);
    assert.equal(item.title, "Polijstbeurt");
    assert.equal(item.description, null);
    assert.equal(item.sort_order, 7);
    assert.equal(item.before_image_url, null);

    const pub = (await app.inject({ method: "GET", url: "/api/gallery" })).json() as {
      data: { id: string; image_url: string }[];
    };
    assert.deepEqual(
      pub.data.map((g) => [g.id, g.image_url]),
      [[item.id, item.image_url]],
    );
    const admin = (
      await app.inject({
        method: "GET",
        url: "/api/admin/gallery",
        headers: { authorization: `Bearer ${token}` },
      })
    ).json() as { data: { id: string }[] };
    assert.deepEqual(
      admin.data.map((g) => g.id),
      [item.id],
    );

    // Default sort order as in the current UI: number of existing items.
    const second = await uploadOk(JPEG, "image/jpeg");
    assert.equal(second.sort_order, 1);
  });

  test("11. generated filename: UUID + server-chosen extension, never the client's name", async () => {
    const res = await upload([imagePart(WEBP, "image/webp", "Mijn Auto (1).JPG.exe")]);
    const item = galleryItemResponse.parse(res.json()).data;
    const name = item.image_url.split("/").pop()!;
    assert.match(name, UUID_NAME);
    assert.ok(name.endsWith(".webp"));
    assert.deepEqual(await galleryFiles(), [name]);
    assert.ok(!logs.join("").includes("Mijn Auto"), "client file name is not logged");
  });

  test("12. path traversal through the client file name has no effect", async () => {
    for (const filename of [
      "../../../evil.jpg",
      "..\\..\\evil.jpg",
      "/etc/passwd",
      "%2e%2e%2fevil.jpg",
    ]) {
      const res = await upload([imagePart(JPEG, "image/jpeg", filename)]);
      assert.equal(res.status, 201);
    }
    assert.deepEqual((await readdir(root)).sort(), [".staging", "gallery"]);
    const files = await galleryFiles();
    assert.equal(files.length, 4);
    for (const f of files) assert.match(f, UUID_NAME);
  });

  test("13. public URL comes from PUBLIC_UPLOAD_URL, never from request headers", async () => {
    const { payload, contentType } = multipartBody([imagePart(JPEG, "image/jpeg")]);
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/gallery/upload",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": contentType,
        host: "evil.example",
        "x-forwarded-host": "evil.example",
      },
      payload,
    });
    const item = galleryItemResponse.parse(res.json()).data;
    assert.ok(item.image_url.startsWith(`${BASE}/gallery/`));
    assert.ok(!res.body.includes(root), "no filesystem path in the response");
    assert.equal(storage.keyFromPublicUrl(item.image_url), item.image_url.slice(BASE.length + 1));
  });

  test("rate limit: separate, configurable limit → 429", async () => {
    const limited = await buildApp({ rateMax: 2 });
    try {
      for (let i = 0; i < 2; i++) {
        assert.equal(
          (await upload([imagePart(JPEG, "image/jpeg")], { target: limited })).status,
          201,
        );
      }
      assertError(
        await upload([imagePart(JPEG, "image/jpeg")], { target: limited }),
        429,
        "RATE_LIMITED",
      );
      assert.equal((await galleryFiles()).length, 2);
    } finally {
      await limited.close();
    }
  });

  test("without configured storage → 503, nothing stored", async () => {
    const noStorage = await buildApp({ storage: null });
    try {
      assertError(
        await upload([imagePart(JPEG, "image/jpeg")], { target: noStorage }),
        503,
        "STORAGE_UNAVAILABLE",
      );
      await assertNothingStored();
    } finally {
      await noStorage.close();
    }
  });

  test("17 + 18. DB insert fails → 500, the stored file is removed again (compensation)", async () => {
    const cleanup = await failWhen(pg, "gallery_items", "true");
    try {
      assertError(await upload([imagePart(JPEG, "image/jpeg")]), 500, "INTERNAL_ERROR");
    } finally {
      await cleanup();
    }
    await assertNothingStored();
  });

  test("18b. compensation itself fails → logged safely, 500, no paths leaked", async () => {
    const failingDelete: StorageProvider = {
      createStagingFile: () => storage.createStagingFile(),
      put: (input) => storage.put(input),
      publicUrl: (key) => storage.publicUrl(key),
      keyFromPublicUrl: (url) => storage.keyFromPublicUrl(url),
      list: (area) => storage.list(area),
      delete: async () => {
        throw new Error("disk unavailable");
      },
    };
    const target = await buildApp({ storage: failingDelete });
    const cleanup = await failWhen(pg, "gallery_items", "true");
    try {
      assertError(await upload([imagePart(JPEG, "image/jpeg")], { target }), 500, "INTERNAL_ERROR");
    } finally {
      await cleanup();
      await target.close();
    }
    const text = logs.join("");
    assert.match(text, /gallery upload cleanup failed/);
    assert.equal((await galleryFiles()).length, 1, "orphan stays; it is reported, not hidden");
    assert.equal((await db.select().from(schema.galleryItems)).length, 0);
  });

  test("logs: useful metadata, never tokens or multipart content", async () => {
    const item = await uploadOk(JPEG, "image/jpeg", [
      { name: "description", value: "geheime-notitie" },
    ]);
    const text = logs.join("");
    const line = logs
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.msg === "gallery image uploaded");
    assert.ok(line);
    assert.equal(line.galleryItemId, item.id);
    assert.equal(line.size, JPEG.length);
    assert.equal(line.mime, "image/jpeg");
    assert.match(String(line.key), /^gallery\//);
    assert.ok(!text.includes(token), "no JWT");
    assert.doesNotMatch(text, /authorization|Bearer|geheime-notitie|JFIF/i);
  });
});

describe("GET /uploads/gallery/*", () => {
  test("14. serves an uploaded file publicly with immutable cache and safe headers", async () => {
    const item = await uploadOk(PNG, "image/png");
    const res = await app.inject({ method: "GET", url: new URL(item.image_url).pathname });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.rawPayload, PNG);
    assert.equal(res.headers["content-type"], "image/png");
    assert.equal(res.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["content-security-policy"], "default-src 'none'; sandbox");
  });

  test("20. no directory traversal, listing, staging, dotfiles or other names", async () => {
    await writeFile(join(root, ".env"), "SECRET=do-not-serve");
    await writeFile(join(galleryDir(), ".htaccess"), "x");
    await writeFile(join(galleryDir(), "readme.txt"), "x");
    const staged = await storage.createStagingFile();
    await writeFile(staged.path, JPEG);
    const stagedName = staged.path.split(/[\\/]/).pop()!;

    for (const url of [
      "/uploads/gallery/",
      "/uploads/gallery",
      "/uploads/",
      "/uploads/.env",
      "/uploads/gallery/../.env",
      "/uploads/gallery/..%2F.env",
      "/uploads/gallery/%2e%2e/.env",
      "/uploads/gallery/%2e%2e%2f.env",
      "/uploads/gallery/..%5C.env",
      "/uploads/gallery/..\\.env",
      "/uploads/gallery/.htaccess",
      "/uploads/gallery/readme.txt",
      `/uploads/.staging/${stagedName}`,
      `/uploads/gallery/../.staging/${stagedName}`,
      `/uploads/gallery/%2e%2e%2f.staging%2f${stagedName}`,
      "/uploads/gallery/11111111-1111-4111-8111-111111111111.jpg", // valid name, no file
      "/uploads/gallery/11111111-1111-4111-8111-111111111111.svg",
    ]) {
      const res = await app.inject({ method: "GET", url });
      assert.equal(res.statusCode, 404, url);
      assert.doesNotMatch(res.body, /do-not-serve|JFIF/, url);
    }
    await staged.discard();
  });
});

describe("DELETE /api/admin/gallery/:id with storage", () => {
  const del = (id: string, bearer: string | null = token) =>
    app.inject({
      method: "DELETE",
      url: `/api/admin/gallery/${id}`,
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    });

  async function insertRow(imageUrl: string, beforeImageUrl: string | null = null) {
    const [row] = await db
      .insert(schema.galleryItems)
      .values({ imageUrl, beforeImageUrl })
      .returning({ id: schema.galleryItems.id });
    return row!.id;
  }

  test("15. deletes the row and the managed local file", async () => {
    const item = await uploadOk(JPEG, "image/jpeg");
    const path = join(root, storage.keyFromPublicUrl(item.image_url)!);
    assert.equal(await exists(path), true);

    assert.equal((await del(item.id)).statusCode, 204);
    assert.equal(await exists(path), false);
    assert.equal((await db.select().from(schema.galleryItems)).length, 0);
    assert.equal(
      (await app.inject({ method: "GET", url: new URL(item.image_url).pathname })).statusCode,
      404,
    );
  });

  test("16. external Supabase URL: row deleted, nothing on disk touched", async () => {
    const keep = await uploadOk(PNG, "image/png");
    const before = await galleryFiles();
    const id = await insertRow(SUPABASE_URL);
    assert.equal((await del(id)).statusCode, 204);
    assert.deepEqual(await galleryFiles(), before);
    assert.equal((await db.select().from(schema.galleryItems)).length, 1);
    assert.ok(keep.id);
  });

  test("hostile image_url values never reach the filesystem", async () => {
    await writeFile(join(root, ".env"), "SECRET=1");
    for (const url of [
      `${BASE}/gallery/../.env`,
      `${BASE}/gallery/..%2F.env`,
      `${BASE}/../.env`,
      "/uploads/gallery/../../.env",
      join(root, ".env"),
      "https://evil.example/uploads/gallery/11111111-1111-4111-8111-111111111111.jpg",
    ]) {
      const id = await insertRow(url);
      assert.equal((await del(id)).statusCode, 204, url);
    }
    assert.equal(await exists(join(root, ".env")), true);
  });

  test("19. managed file already missing → row still deleted (204), warning logged", async () => {
    const item = await uploadOk(JPEG, "image/jpeg");
    await storage.delete(storage.keyFromPublicUrl(item.image_url)!);
    assert.equal((await del(item.id)).statusCode, 204);
    assert.equal((await db.select().from(schema.galleryItems)).length, 0);
    assert.match(logs.join(""), /gallery file already missing/);
  });

  test("a file still referenced by another row is kept", async () => {
    const item = await uploadOk(JPEG, "image/jpeg");
    await insertRow(item.image_url);
    assert.equal((await del(item.id)).statusCode, 204);
    assert.equal((await galleryFiles()).length, 1);
  });

  test("before_image_url pointing at a managed file is removed too", async () => {
    const before = await uploadOk(JPEG, "image/jpeg");
    const after = await uploadOk(PNG, "image/png");
    await db.delete(schema.galleryItems).where(eq(schema.galleryItems.id, before.id));
    await db
      .update(schema.galleryItems)
      .set({ beforeImageUrl: before.image_url })
      .where(eq(schema.galleryItems.id, after.id));
    assert.equal((await del(after.id)).statusCode, 204);
    assert.deepEqual(await galleryFiles(), []);
  });

  test("database delete fails → file kept, error response without internals", async () => {
    const item = await uploadOk(JPEG, "image/jpeg");
    await pg.exec(`
      CREATE OR REPLACE FUNCTION test_block_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced test failure'; END $$;
      CREATE TRIGGER test_block_delete BEFORE DELETE ON gallery_items
        FOR EACH ROW EXECUTE FUNCTION test_block_delete();
    `);
    try {
      const res = await del(item.id);
      assertError(
        { status: res.statusCode, body: res.body, json: () => res.json() },
        500,
        "INTERNAL_ERROR",
      );
    } finally {
      await pg.exec("DROP TRIGGER IF EXISTS test_block_delete ON gallery_items;");
    }
    assert.equal((await galleryFiles()).length, 1);
  });

  test("auth: delete requires admin:access; unknown id → 404", async () => {
    const item = await uploadOk(JPEG, "image/jpeg");
    assert.equal((await del(item.id, null)).statusCode, 401);
    assert.equal((await del(item.id, await auth.token({ permissions: [] }))).statusCode, 403);
    assert.equal((await galleryFiles()).length, 1);
    assert.equal((await del("00000000-0000-4000-8000-000000000000")).statusCode, 404);
  });
});

describe("orphan report (read-only)", () => {
  test("lists orphan files, missing files and external references; deletes nothing", async () => {
    const kept = await uploadOk(JPEG, "image/jpeg");
    const lost = await uploadOk(PNG, "image/png");
    const orphan = await storage.put({
      area: "gallery",
      extension: "webp",
      staged: await (async () => {
        const s = await storage.createStagingFile();
        await writeFile(s.path, WEBP);
        return s;
      })(),
    });
    await storage.delete(storage.keyFromPublicUrl(lost.image_url)!);
    await db.insert(schema.galleryItems).values({ imageUrl: SUPABASE_URL });

    const before = await galleryFiles();
    const report = await findOrphanUploads(db, storage);
    assert.deepEqual(report.orphanFiles, [orphan.key]);
    assert.deepEqual(report.missingFiles, [
      { table: "gallery_items", id: lost.id, key: storage.keyFromPublicUrl(lost.image_url) },
    ]);
    assert.equal(report.externalReferences, 1);
    assert.deepEqual(await galleryFiles(), before, "report is read-only");
    assert.ok(kept.id);
  });
});
