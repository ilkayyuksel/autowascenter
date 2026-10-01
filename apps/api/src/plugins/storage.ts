import { lstat } from "node:fs/promises";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { LocalStorageProvider, STORED_FILE_PATTERN } from "../storage/local-storage-provider.ts";
import type { StorageProvider } from "../storage/storage-provider.ts";

declare module "fastify" {
  interface FastifyInstance {
    /** File storage for uploads; null = not configured (uploads answer 503). */
    storage: StorageProvider | null;
  }
}

/** URL prefix of public gallery files; PUBLIC_UPLOAD_URL must point at "/uploads". */
export const GALLERY_URL_PREFIX = "/uploads/gallery/";

/** Files never change (new upload = new UUID name), so they may be cached for a year. */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

export function registerStorage(app: FastifyInstance, storage: StorageProvider | null) {
  app.decorate("storage", storage);
}

/**
 * GET /uploads/gallery/<uuid>.<jpg|png|webp>: serves exactly UPLOAD_DIR/gallery and nothing
 * else (no listing, no staging area, no dotfiles, no other names, no symlinks). Anything
 * else is a plain 404. In production a reverse proxy may serve the same directory instead.
 */
export async function uploadsStaticRoutes(app: FastifyInstance, storage: LocalStorageProvider) {
  const root = storage.areaDirectory("gallery");

  // Runs before @fastify/static (child plugin below): only server-generated names, and only
  // regular files. lstat never follows a symlink, so a planted link is not served.
  app.addHook("onRequest", async (request, reply) => {
    const name = (request.params as { "*"?: string })["*"] ?? "";
    if (!STORED_FILE_PATTERN.test(name)) return reply.callNotFound();
    const stats = await lstat(join(root, name)).catch(() => null);
    if (!stats?.isFile()) return reply.callNotFound();
  });

  await app.register(fastifyStatic, {
    root,
    prefix: GALLERY_URL_PREFIX,
    decorateReply: false,
    list: false,
    index: false,
    dotfiles: "deny",
    redirect: false,
    cacheControl: false, // own header below
    allowedPath: (pathName) => STORED_FILE_PATTERN.test(pathName.replace(/^\//, "")),
    setHeaders: (reply) => {
      reply.header("Cache-Control", IMMUTABLE_CACHE);
      reply.header("X-Content-Type-Options", "nosniff");
      // An image needs no scripts, styles or frames, even when opened directly.
      reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
      reply.header("Cross-Origin-Resource-Policy", "cross-origin");
    },
  });
}

export function isLocalStorage(storage: StorageProvider | null): storage is LocalStorageProvider {
  return storage instanceof LocalStorageProvider;
}
