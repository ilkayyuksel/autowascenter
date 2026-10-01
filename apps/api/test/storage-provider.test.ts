// LocalStorageProvider against the StorageProvider contract, in temporary directories.

import assert from "node:assert/strict";
import { access, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { LocalStorageProvider } from "../src/storage/local-storage-provider.ts";
import type { StorageProvider } from "../src/storage/storage-provider.ts";
import { JPEG, tempDir } from "./helpers/uploads.ts";

const BASE = "https://autowascenter.be/uploads";
const KEY_RE =
  /^gallery\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

let root: string;
let removeRoot: () => Promise<void>;
let local: LocalStorageProvider;
let storage: StorageProvider; // tests use the abstraction wherever possible

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

async function stage(content: Buffer = JPEG) {
  const staged = await storage.createStagingFile();
  await writeFile(staged.path, content);
  return staged;
}

before(async () => {
  ({ dir: root, remove: removeRoot } = await tempDir());
  local = await LocalStorageProvider.create({ rootDir: root, publicBaseUrl: `${BASE}/` });
  storage = local;
});
after(() => removeRoot());

describe("LocalStorageProvider", () => {
  test("create: makes the gallery and private staging directories", async () => {
    assert.deepEqual((await readdir(root)).sort(), [".staging", "gallery"]);
    assert.equal(local.areaDirectory("gallery"), join(root, "gallery"));
  });

  test("put: moves the staged file under a server-generated UUID name", async () => {
    const staged = await stage();
    assert.ok(staged.path.startsWith(join(root, ".staging")));
    const stored = await storage.put({ area: "gallery", extension: "jpg", staged });

    assert.match(stored.key, KEY_RE);
    assert.equal(stored.size, JPEG.length);
    assert.equal(stored.publicUrl, `${BASE}/${stored.key}`); // trailing slash normalised
    assert.deepEqual(await readFile(join(root, stored.key)), JPEG);
    assert.equal(await exists(staged.path), false, "staging file is moved, not copied");
    if (process.platform !== "win32") {
      assert.equal((await stat(join(root, stored.key))).mode & 0o777, 0o640);
    }

    const other = await storage.put({ area: "gallery", extension: "jpg", staged: await stage() });
    assert.notEqual(other.key, stored.key);
  });

  test("put: only allowlisted extensions", async () => {
    for (const extension of ["svg", "php", "html", "JPG", "jpg/../x", "", "jpeg"]) {
      const staged = await stage();
      await assert.rejects(storage.put({ area: "gallery", extension, staged }), /not allowed/);
      await staged.discard();
    }
  });

  test("staging discard is idempotent", async () => {
    const staged = await stage();
    await staged.discard();
    await staged.discard();
    assert.equal(await exists(staged.path), false);
  });

  test("publicUrl: central, canonical; invalid keys rejected", () => {
    const key = "gallery/0b0e4d4c-9a1f-4c55-8f3e-2f5c6a7b8c9d.webp";
    assert.equal(storage.publicUrl(key), `${BASE}/${key}`);
    for (const bad of [
      "gallery/../.env",
      "../gallery/0b0e4d4c-9a1f-4c55-8f3e-2f5c6a7b8c9d.webp",
      "/etc/passwd",
      "gallery/evil.jpg",
      ".staging/0b0e4d4c-9a1f-4c55-8f3e-2f5c6a7b8c9d.jpg",
    ]) {
      assert.throws(() => storage.publicUrl(bad), /Invalid storage key/);
    }
  });

  test("ownership: only canonical URLs of this provider map to a key", () => {
    const key = "gallery/0b0e4d4c-9a1f-4c55-8f3e-2f5c6a7b8c9d.png";
    assert.equal(storage.keyFromPublicUrl(`${BASE}/${key}`), key);

    const foreign = [
      // Old Supabase Storage URLs are never ours.
      "https://abcd1234.supabase.co/storage/v1/object/public/gallery/0b0e4d4c-9a1f-4c55-8f3e-2f5c6a7b8c9d.png",
      // Other host / scheme / prefix confusion.
      `https://evil.example/uploads/${key}`,
      `http://autowascenter.be/uploads/${key}`,
      `https://autowascenter.be/uploads-evil/${key}`,
      `https://autowascenter.be/uploads/x/../${key}`,
      `/uploads/${key}`,
      key,
      // Traversal and encoding tricks.
      `${BASE}/gallery/../.env`,
      `${BASE}/gallery/..%2F.env`,
      `${BASE}/gallery/%2e%2e/secret.jpg`,
      `${BASE}/gallery\\..\\.env`,
      `${BASE}//etc/passwd`,
      `${BASE}/gallery/0b0e4d4c-9a1f-4c55-8f3e-2f5c6a7b8c9d.png?x=1`,
      `${BASE}/gallery/0b0e4d4c-9a1f-4c55-8f3e-2f5c6a7b8c9d.png/`,
      `${BASE}/gallery/0B0E4D4C-9A1F-4C55-8F3E-2F5C6A7B8C9D.png`,
      `${BASE}/gallery/0b0e4d4c-9a1f-4c55-8f3e-2f5c6a7b8c9d.svg`,
      `${BASE}/.staging/0b0e4d4c-9a1f-4c55-8f3e-2f5c6a7b8c9d.png`,
      "",
    ];
    for (const url of foreign) assert.equal(storage.keyFromPublicUrl(url), null, url);
  });

  test("delete: removes a stored file; missing file → 'missing'; invalid key throws", async () => {
    const stored = await storage.put({ area: "gallery", extension: "jpg", staged: await stage() });
    assert.equal(await storage.delete(stored.key), "deleted");
    assert.equal(await exists(join(root, stored.key)), false);
    assert.equal(await storage.delete(stored.key), "missing");

    await writeFile(join(root, ".env"), "SECRET=1");
    await assert.rejects(storage.delete("gallery/../.env"), /Invalid storage key/);
    await assert.rejects(storage.delete("../.env"), /Invalid storage key/);
    assert.equal(await exists(join(root, ".env")), true);
  });

  test("delete: a symlink planted in the gallery is never followed", async (t) => {
    const target = join(root, "outside.txt");
    await writeFile(target, "keep me");
    const key = "gallery/11111111-1111-4111-8111-111111111111.jpg";
    try {
      await symlink(target, join(root, key));
    } catch {
      t.skip("creating symlinks is not permitted on this system");
      return;
    }
    await assert.rejects(storage.delete(key), /non-regular file/);
    assert.equal(await readFile(target, "utf8"), "keep me");
  });

  test("list: only stored objects of the area", async () => {
    const dir = await tempDir();
    try {
      const p = await LocalStorageProvider.create({ rootDir: dir.dir, publicBaseUrl: BASE });
      const s1 = await p.put({ area: "gallery", extension: "jpg", staged: await stageIn(p) });
      const s2 = await p.put({ area: "gallery", extension: "jpg", staged: await stageIn(p) });
      await writeFile(join(p.areaDirectory("gallery"), "notes.txt"), "x");
      assert.deepEqual(await p.list("gallery"), [s1.key, s2.key].sort());
    } finally {
      await dir.remove();
    }
  });
});

async function stageIn(p: StorageProvider) {
  const staged = await p.createStagingFile();
  await writeFile(staged.path, JPEG);
  return staged;
}
