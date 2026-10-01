# Gallery Storage Migration

Phase 6C: gallery image storage moves from Supabase Storage to self-hosted local filesystem storage behind a `StorageProvider` abstraction. The API can upload, store metadata for, publicly serve and delete gallery images. **The frontend is not migrated in this phase** and still uses Supabase Storage. **Existing Supabase files are not moved.**

## Current Supabase Storage

Source: `src/routes/admin/galerij.tsx`, `src/routes/galerij.tsx`, `supabase/migrations/20260418141959_….sql` (lines 192–212).

| Aspect             | Current behaviour (Supabase)                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Bucket             | `gallery`, **public** (`storage.buckets.public = true`); read for everyone, insert/update/delete for `has_role(…, 'admin')` (RLS) |
| File input         | `<input type="file" accept="image/*">`, **one file** per upload, no `multiple`                                                    |
| Type / size limits | **None** server-side: `accept="image/*"` is only a browser hint (SVG, GIF, HEIC… would be accepted); no bucket size limit         |
| Object name        | `${crypto.randomUUID()}.${extension of the user's file name}`: random name, but the **extension comes from the client**           |
| Stored URL         | `getPublicUrl(name)` → `https://<project>.supabase.co/storage/v1/object/public/gallery/<uuid>.<ext>` in `gallery_items.image_url` |
| Metadata on upload | `{ image_url, sort_order: items.length }`; `title`/`description`/`sort_order` are edited afterwards                               |
| Edited fields      | `title`, `description`, `sort_order`                                                                                              |
| Delete             | Storage `remove([last URL segment])` from the browser, then delete the row; no check that the URL is really a bucket object       |
| Public page uses   | `id`, `title`, `description`, `image_url`, `category`, `before_image_url`                                                         |
| `before_image_url` | Read by the public page, but the admin UI has **no** field or upload for it                                                       |
| `category`         | Read by the public page, but the admin UI does **not** set it                                                                     |

→

## New local storage

| Aspect      | New behaviour (self-hosted)                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Backend     | `LocalStorageProvider` (`apps/api/src/storage/local-storage-provider.ts`): the local filesystem, Docker-volume ready           |
| Root        | `UPLOAD_DIR` (default `./uploads`, relative to the API's working directory; ignored by `.gitignore`)                           |
| Layout      | `UPLOAD_DIR/gallery/<uuid v4>.<jpg\|png\|webp>` (public) and `UPLOAD_DIR/.staging/<uuid>.upload` (private, incomplete uploads) |
| Public URL  | `PUBLIC_UPLOAD_URL/gallery/<name>`, e.g. `https://autowascenter.be/uploads/gallery/0b0e…9d.jpg`                                |
| Upload      | `POST /api/admin/gallery/upload` (multipart, one file + `title`, `description`, `sort_order`), `admin:access`                  |
| Delete      | `DELETE /api/admin/gallery/:id` deletes the row and, only for files this provider owns, the file                               |
| Serving     | `GET /uploads/gallery/<name>` by the API (`@fastify/static`), or later by the reverse proxy from the same directory            |
| Ownership   | The **provider** decides (`keyFromPublicUrl`); routes and services never parse paths                                           |
| Permissions | Directories `0750`, files `0640` (owner + group, e.g. a proxy group), never executable; staging files `0600`                   |
| Backup      | `UPLOAD_DIR` **must** be backed up together with the database dump (rows reference files; restore both from the same moment)   |

The filesystem path is never returned to clients and never logged in full; logs contain the **key** (`gallery/<uuid>.<ext>`) only.

## Storage abstraction

```
Gallery route (routes/admin/gallery-upload.ts, content-write.ts)
  → service (services/admin/gallery-upload.service.ts, content-write.service.ts)
    → StorageProvider (storage/storage-provider.ts)       ← interface, no Supabase concepts
        └── LocalStorageProvider (local filesystem)
    → database metadata (gallery_items via Drizzle)
```

```ts
interface StorageProvider {
  createStagingFile(): Promise<StagedFile>; // private temp file for an incoming upload
  put({ area, extension, staged }): Promise<StoredObject>; // move validated file, server-generated name
  delete(key): Promise<"deleted" | "missing">;
  publicUrl(key): string; // canonical URL from PUBLIC_UPLOAD_URL
  keyFromPublicUrl(url): string | null; // ownership check: null = not ours, never touch
  list(area): Promise<string[]>; // diagnostics
}
```

- **Keys**, not paths: `gallery/<uuid>.<ext>`. Only the provider turns a key into a path, after validating it against one strict pattern.
- The provider is created once at startup (`server.ts`) and injected into `createApp({ storage })` (`app.storage`). Tests inject a provider on a temporary directory. Without a provider, uploads answer **503 `STORAGE_UNAVAILABLE`** and deletes remove rows only.
- A future S3-compatible backend implements the same interface; routes, services and tests of the business flow stay unchanged. `@fastify/static` serving is only registered for the local provider.

## File naming

- Stored name: `crypto.randomUUID()` (UUID v4, 122 random bits) + an extension **chosen by the server from the detected content type** (`jpg`, `png`, `webp`).
- The client's file name is **ignored completely**: not used, not stored, not logged. `../../evil.php.jpg` simply becomes `<uuid>.jpg` (if it is a real JPEG).
- New upload = new name. A file is never overwritten, which makes immutable caching safe.

## Allowed file types

Investigated: the current UI accepts `image/*` without any server check. Gallery photos are camera/phone photos, so only common raster formats are needed.

| Type | MIME         | Magic bytes                  | Extension |
| ---- | ------------ | ---------------------------- | --------- |
| JPEG | `image/jpeg` | `FF D8 FF`                   | `jpg`     |
| PNG  | `image/png`  | `89 50 4E 47 0D 0A 1A 0A`    | `png`     |
| WebP | `image/webp` | `RIFF` (0–3) + `WEBP` (8–11) | `webp`    |

- **Both** must hold: the part's `Content-Type` is on the allowlist (early rejection), **and** the file's first bytes match **that same** type (after staging). Otherwise **415 `UNSUPPORTED_MEDIA_TYPE`**. A text file declared as `image/png`, a PNG declared as `image/jpeg`, or PHP code named `.jpg` are rejected.
- **SVG is not allowed** (XML that can contain scripts). GIF, HEIC/HEIF, AVIF, BMP, TIFF: not allowed (not needed; could be added to `storage/image-types.ts` later).
- No extra dependency: the three signatures are checked in `storage/image-types.ts`.
- Images are stored as uploaded (no re-encoding/EXIF stripping; possible later improvement).

## File size limits

- `MAX_UPLOAD_BYTES`, default **10 485 760 (10 MiB)**, configurable from 1 KiB to 50 MiB.
- Rationale: there is no limit today (Supabase bucket without `file_size_limit`; Supabase's own global cap is 50 MB). Gallery photos come from phones/cameras: a 12-MP JPEG is typically 2–5 MB, high-quality 48-MP shots up to ~8–10 MB; PNG screenshots and WebP are smaller. 10 MiB accepts realistic photos while bounding disk use and request time. The 50 MiB cap mirrors Supabase's global limit.
- Enforced **while streaming** by `@fastify/multipart` (`limits.fileSize`): the upload is cut off as soon as the limit is exceeded → **413 `FILE_TOO_LARGE`**, the staging file is removed, no row is created.
- Other multipart limits: 1 file, 3 text fields, 4 parts, 16 KiB per field, 20 header pairs. An empty file → 400 `EMPTY_FILE`.

## Upload flow

`POST /api/admin/gallery/upload` (full request/response: `docs/ADMIN-API.md`, "Gallery upload"):

1. **Authentication/authorization**: parent-plugin hooks (valid Auth0 token, `admin:access`); the rate limit (`UPLOAD_RATE_LIMIT_MAX`, default 30 per `UPLOAD_RATE_LIMIT_WINDOW_MS`, default 1 h, per client IP) runs before them.
2. **Multipart validation**: must be `multipart/form-data` (415 otherwise); only `file`, `title`, `description`, `sort_order`; one file; no duplicates; malformed or truncated body → 400 `MALFORMED_MULTIPART`. The multipart parser is registered **only** for this route.
3. **File type** (declared MIME on the allowlist, else 415).
4. **File size** (streaming limit, else 413).
5. **Server-side filename**: the staging name and the final name are random UUIDs.
6. **Temporary location**: the file is streamed to `UPLOAD_DIR/.staging/<uuid>.upload` (`wx`, mode `0600`), never into memory as a whole and never into the public directory.
7. **Validation**: non-empty, magic bytes match the declared type, metadata validated by a strict Zod contract (`galleryUploadFields`).
8. **Move** to `UPLOAD_DIR/gallery/<uuid>.<ext>` with `rename` (atomic on one filesystem; copy + delete fallback across filesystems), then `chmod 0640`.
9. **Database metadata**: `INSERT INTO gallery_items (image_url, title, description, sort_order)`; `sort_order` defaults to the number of items, as in the current UI.
10. **Public URL** from `PUBLIC_UPLOAD_URL` via `storage.publicUrl(key)`, never from `Host`/`X-Forwarded-Host`/the client.
11. **Response** **201** `{ data: AdminGalleryItem }` with the public `image_url`, never a filesystem path. The item appears immediately in `GET /api/gallery` and `GET /api/admin/gallery`.

The staging file is removed in a `finally` on every failure path. Logged on success: `galleryItemId`, `key`, `size`, `mime`.

## Delete flow

`DELETE /api/admin/gallery/:id` (`admin:access`):

1. Delete the row with `RETURNING image_url, before_image_url` (load + delete in one statement; unknown id → 404, nothing touched).
2. For each URL: `storage.keyFromPublicUrl(url)`. Only an **exact** `PUBLIC_UPLOAD_URL/gallery/<uuid v4>.<jpg|png|webp>` yields a key. Anything else (Supabase URLs, other hosts, relative paths, `..`, `%2e`, `\`, query strings, other directories) → `null` → **never deleted**.
3. If another row still references the same URL (`gallery_items.image_url`/`before_image_url`, `services.image_url`, `vehicle_types.image_url`) → file kept.
4. `storage.delete(key)`: `lstat` (no symlink following), only regular files, `unlink`.
5. Failures after the committed row delete (file already missing, I/O error) are **logged** (`warn`/`error` with id + key) and the response is still **204**: the row is gone, at worst a file stays as an orphan.

If the database delete fails, no file is touched (500, file intact).

## Database/file consistency

The filesystem and PostgreSQL do not share a transaction. The order of operations guarantees that **a row never points to a file that was not stored successfully**; the only possible inconsistency is an unreferenced file (orphan), never a broken image.

| Failure                                           | Result                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Upload rejected (type, size, auth, malformed…)    | Staging file removed, no final file, no row                                                         |
| Write/move to final location fails                | No row created; staging file removed; 500                                                           |
| DB insert fails                                   | **Compensation**: final file deleted again; 500 (`INTERNAL_ERROR`, no details)                      |
| Compensation delete also fails                    | Logged as `gallery upload cleanup failed (orphan left)` with the key only; 500; orphan file remains |
| Process crashes between move and insert           | Orphan file in `gallery/` (or leftover in `.staging/`)                                              |
| DB delete fails                                   | Nothing deleted on disk; error response                                                             |
| File delete fails / file missing after row delete | 204; logged; orphan (if the file still exists)                                                      |

This is an accepted **eventual-consistency boundary**: orphans are harmless (unreferenced, unguessable names) and can be found with the read-only report below.

## Public URLs

- Built centrally by the provider: `publicUrl(key) = PUBLIC_UPLOAD_URL + "/" + key`.
- `PUBLIC_UPLOAD_URL` is **required in production**, must be `http(s)://…` without trailing slash, query or fragment. Development default: `http://localhost:<PORT>/uploads`.
- It must point at the place that serves `UPLOAD_DIR` as `/uploads` (the API itself, or later the reverse proxy on the public domain, e.g. `https://autowascenter.be/uploads`).
- Changing `PUBLIC_UPLOAD_URL` later means existing URLs are no longer recognised as owned (they are then treated as external: not deleted). A domain change therefore needs a deliberate URL rewrite in the database.

**Serving** (`apps/api/src/plugins/storage.ts`): `GET /uploads/gallery/*` via `@fastify/static` with root **exactly** `UPLOAD_DIR/gallery`:

- `list: false`, `index: false`, `redirect: false`, `dotfiles: "deny"`; plus an `onRequest` guard that only accepts names matching `<uuid v4>.<jpg|png|webp>` and only regular files (`lstat`, no symlinks); everything else → JSON 404.
- `UPLOAD_DIR` itself, `.staging/`, `.env`, logs or any other file are not reachable.
- Headers:
  - `Cache-Control: public, max-age=31536000, immutable` (names never change content)
  - `X-Content-Type-Options: nosniff`
  - `Content-Security-Policy: default-src 'none'; sandbox`
  - `Cross-Origin-Resource-Policy: cross-origin` (images may be embedded by the frontend origin)
  - `Content-Type` from the server-chosen extension; `ETag`/`Last-Modified` as usual.
- No authentication (public gallery, like the public Supabase bucket).

## Security

| Check                   | Measure                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Max file size           | Streaming limit `MAX_UPLOAD_BYTES` → 413; staging removed                                                                      |
| Allowed MIME types      | Allowlist JPEG/PNG/WebP → 415                                                                                                  |
| Magic bytes             | Signature must match the declared type → 415                                                                                   |
| Generated filename      | UUID v4 + server extension; client name ignored                                                                                |
| Path traversal          | Keys validated by one strict regex + `resolve` + "inside area directory" check; no `path.join(UPLOAD_DIR, userInput)` anywhere |
| Arbitrary file deletion | Only keys returned by `keyFromPublicUrl` (exact canonical prefix + strict pattern); `lstat`, regular files only                |
| Executable extensions   | Only `jpg`/`png`/`webp` are ever written; files `0640`; the API never executes or includes uploaded files                      |
| SVG policy              | Not allowed                                                                                                                    |
| Directory listing       | Disabled; root limited to `gallery/`; `nosniff` + restrictive CSP on every file                                                |
| Auth                    | Upload and delete: Auth0 `admin:access` (parent-plugin hooks); public files: none                                              |
| Rate limit              | Separate per-route limit on upload (default 30/h per IP), 429 `RATE_LIMITED`                                                   |
| Logs                    | id, key, size, MIME. Never JWT, `Authorization`, secrets, multipart content, client file names, full DB URL                    |
| Error responses         | `{ error: { code, message } }` only; no stack traces, absolute paths, SQL or driver details                                    |

## Orphan files

Possible orphans (see the table above): failed compensation, crash between move and insert, failed file delete, leftovers in `.staging/` after a crash.

Diagnostics (read-only):

```sh
cd apps/api
npm run storage:orphans   # uses DATABASE_URL, UPLOAD_DIR, PUBLIC_UPLOAD_URL
```

It prints `orphanFiles` (stored files no row references), `missingFiles` (managed URLs whose file is missing) and the number of `externalReferences` (e.g. Supabase URLs), and **deletes nothing**. There is deliberately **no automatic cleanup job**. A future cleanup must be explicit: review the report, take a backup, exclude files younger than a grace period (in-flight uploads), then delete.

## Existing Supabase URLs

- Existing `gallery_items.image_url` values (`https://<project>.supabase.co/storage/v1/object/public/gallery/…`) **stay as they are** and keep working as long as the Supabase bucket exists.
- They are **external** for the new provider: `keyFromPublicUrl` returns `null`, so a delete removes the row but **never** tries to delete anything, locally or at Supabase.
- `POST /api/admin/gallery` still accepts an existing absolute path or http(s) URL (metadata only), as in phase 6B.

## Future data migration

Not part of this phase. A separate, explicit migration later:

1. Export the Supabase bucket `gallery` (all objects) and the `gallery_items` rows.
2. For each referenced object: verify type by magic bytes (convert or reject anything not JPEG/PNG/WebP, e.g. SVG/HEIC), store via the provider under a new UUID name.
3. Rewrite `image_url` (and `before_image_url`) to the new canonical URL in one database transaction; keep a mapping file (old URL → new key) for rollback.
4. Run `npm run storage:orphans` (expect 0 missing files and 0 external references), then retire the bucket.

`before_image_url`: the admin UI cannot set it today, so no upload for it was built. The upload endpoint can be extended later with an optional second file part (`before_file`) using the same validation and the same compensation (delete both files on insert failure).

## Future Docker volume

Not implemented in this phase (no Dockerfile, docker-compose.yml or Caddyfile yet). The infrastructure phase needs:

- A named volume mounted at e.g. `/var/lib/autowascenter/uploads`, with `UPLOAD_DIR` set to that path, owned by the (non-root) API user; `.staging/` on the **same** volume so the final move is an atomic `rename`.
- `PUBLIC_UPLOAD_URL=https://<domain>/uploads`.
- Either proxy `/uploads/gallery/*` to the API, or let Caddy serve **only** `<volume>/gallery` read-only with the same headers (no listing, no other directories) — never the whole volume.
- The volume in the backup plan together with `pg_dump` (same schedule, restored together).
- `trustProxy` enabled in the API so the upload rate limit uses real client IPs.
