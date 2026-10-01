// Local filesystem storage (Docker-volume ready): UPLOAD_DIR/gallery/<uuid>.<ext>, staged
// uploads in UPLOAD_DIR/.staging (never served). Every path is derived from a strictly
// validated key, never from user input, and must resolve inside its area directory.

import { randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readdir, rename, unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { ALLOWED_EXTENSIONS } from "./image-types.ts";
import type { StagedFile, StorageArea, StorageProvider, StoredObject } from "./storage-provider.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
/** The ONLY accepted key shape: area + server-generated UUID v4 + allowlisted extension. */
const KEY_PATTERN = new RegExp(`^(gallery)/(${UUID})\\.(${ALLOWED_EXTENSIONS.join("|")})$`);
/** File names accepted in an area directory (also used by the static file route). */
export const STORED_FILE_PATTERN = new RegExp(`^${UUID}\\.(${ALLOWED_EXTENSIONS.join("|")})$`);

export interface LocalStorageOptions {
  /** UPLOAD_DIR (absolute after resolution). */
  rootDir: string;
  /** PUBLIC_UPLOAD_URL without trailing slash, e.g. https://autowascenter.be/uploads */
  publicBaseUrl: string;
}

/** Files are readable by the owner and group (e.g. a reverse proxy), never executable. */
const FILE_MODE = 0o640;
const DIR_MODE = 0o750;

export class LocalStorageProvider implements StorageProvider {
  readonly rootDir: string;
  readonly publicBaseUrl: string;
  private readonly stagingDir: string;

  private constructor(options: LocalStorageOptions) {
    this.rootDir = resolve(options.rootDir);
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, "");
    this.stagingDir = resolve(this.rootDir, ".staging");
  }

  /** Creates the provider and its directories. */
  static async create(options: LocalStorageOptions): Promise<LocalStorageProvider> {
    const provider = new LocalStorageProvider(options);
    await mkdir(provider.stagingDir, { recursive: true, mode: DIR_MODE });
    await mkdir(provider.areaDirectory("gallery"), { recursive: true, mode: DIR_MODE });
    return provider;
  }

  /** Directory of an area; the static file route serves exactly this directory. */
  areaDirectory(area: StorageArea): string {
    return resolve(this.rootDir, area);
  }

  /** Validated absolute path of a key, guaranteed to lie inside its area directory. */
  private pathFor(key: string): string {
    const match = KEY_PATTERN.exec(key);
    if (!match) throw new Error("Invalid storage key");
    const areaDir = this.areaDirectory(match[1] as StorageArea);
    const path = resolve(areaDir, `${match[2]}.${match[3]}`);
    if (!path.startsWith(areaDir + sep)) throw new Error("Invalid storage key");
    return path;
  }

  async createStagingFile(): Promise<StagedFile> {
    const path = resolve(this.stagingDir, `${randomUUID()}.upload`);
    return {
      path,
      discard: async () => {
        await unlink(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      },
    };
  }

  async put({
    area,
    extension,
    staged,
  }: {
    area: StorageArea;
    extension: string;
    staged: StagedFile;
  }): Promise<StoredObject> {
    if (!ALLOWED_EXTENSIONS.includes(extension as (typeof ALLOWED_EXTENSIONS)[number])) {
      throw new Error("Extension not allowed");
    }
    const key = `${area}/${randomUUID()}.${extension}`;
    const destination = this.pathFor(key);
    try {
      await rename(staged.path, destination); // same filesystem: atomic
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await copyFile(staged.path, destination);
      await staged.discard();
    }
    await chmod(destination, FILE_MODE);
    const { size } = await lstat(destination);
    return { key, publicUrl: this.publicUrl(key), size };
  }

  async delete(key: string): Promise<"deleted" | "missing"> {
    const path = this.pathFor(key);
    let stats;
    try {
      stats = await lstat(path); // lstat: a symlink is never followed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
      throw error;
    }
    if (!stats.isFile()) throw new Error("Refusing to delete a non-regular file");
    await unlink(path);
    return "deleted";
  }

  publicUrl(key: string): string {
    this.pathFor(key); // validates the key
    return `${this.publicBaseUrl}/${key}`;
  }

  keyFromPublicUrl(url: string): string | null {
    const prefix = `${this.publicBaseUrl}/`;
    if (typeof url !== "string" || !url.startsWith(prefix)) return null;
    const key = url.slice(prefix.length);
    // The strict pattern excludes "..", "/", "\", "%", query strings, other areas, etc.
    return KEY_PATTERN.test(key) ? key : null;
  }

  async list(area: StorageArea): Promise<string[]> {
    const entries = await readdir(this.areaDirectory(area), { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && STORED_FILE_PATTERN.test(e.name))
      .map((e) => `${area}/${e.name}`)
      .sort();
  }
}
