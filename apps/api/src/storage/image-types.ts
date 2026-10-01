// Allowlist of uploadable image types, verified by magic bytes (file signature), not only by
// the client's Content-Type. Raster formats only: SVG (scriptable XML), GIF, HEIC etc. are
// rejected. See docs/GALLERY-STORAGE-MIGRATION.md "Allowed file types".

export interface ImageType {
  mime: "image/jpeg" | "image/png" | "image/webp";
  /** Server-chosen extension of the stored file (never the client's). */
  extension: "jpg" | "png" | "webp";
  matches: (header: Uint8Array) => boolean;
}

const startsWith = (header: Uint8Array, bytes: number[], offset = 0) =>
  bytes.every((b, i) => header[offset + i] === b);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

export const IMAGE_TYPES: readonly ImageType[] = [
  {
    mime: "image/jpeg",
    extension: "jpg",
    matches: (h) => startsWith(h, [0xff, 0xd8, 0xff]),
  },
  {
    mime: "image/png",
    extension: "png",
    matches: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    mime: "image/webp",
    extension: "webp",
    matches: (h) => startsWith(h, ascii("RIFF")) && startsWith(h, ascii("WEBP"), 8),
  },
];

/** Bytes needed to recognise every allowed signature. */
export const SIGNATURE_BYTES = 12;

export const ALLOWED_EXTENSIONS = IMAGE_TYPES.map((t) => t.extension);

export function imageTypeForMime(mime: string): ImageType | undefined {
  return IMAGE_TYPES.find((t) => t.mime === mime.toLowerCase());
}

export function detectImageType(header: Uint8Array): ImageType | undefined {
  return IMAGE_TYPES.find((t) => t.matches(header));
}
