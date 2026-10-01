// Storage abstraction for uploaded files. Business code only depends on this interface;
// the concrete backend (local filesystem today, possibly S3-compatible later) is chosen at
// startup. Nothing here knows about Supabase.

export type StorageArea = "gallery";

/** A file that was received but not yet validated or stored (never publicly served). */
export interface StagedFile {
  /** Local path to write the incoming bytes to. */
  path: string;
  /** Removes the staged file if it still exists (safe to call more than once). */
  discard(): Promise<void>;
}

export interface StoredObject {
  /** Provider-relative identifier, e.g. "gallery/<uuid>.jpg". Never a filesystem path. */
  key: string;
  /** Canonical public URL, built from configuration (PUBLIC_UPLOAD_URL). */
  publicUrl: string;
  size: number;
}

export interface StorageProvider {
  /** Creates a private staging file for an incoming upload. */
  createStagingFile(): Promise<StagedFile>;
  /**
   * Moves a validated staged file into `area` under a server-generated random name with the
   * given (allowlisted) extension.
   */
  put(input: { area: StorageArea; extension: string; staged: StagedFile }): Promise<StoredObject>;
  /** Deletes a stored object; "missing" when it did not exist. Rejects invalid keys. */
  delete(key: string): Promise<"deleted" | "missing">;
  /** Canonical public URL of a key. */
  publicUrl(key: string): string;
  /**
   * Ownership check: the key when `url` is a canonical public URL of an object this provider
   * manages, otherwise null (external URLs such as old Supabase Storage URLs, other hosts,
   * paths with traversal, …). Only keys returned here may ever be deleted.
   */
  keyFromPublicUrl(url: string): string | null;
  /** Keys of all stored objects in an area (diagnostics). */
  list(area: StorageArea): Promise<string[]>;
}
