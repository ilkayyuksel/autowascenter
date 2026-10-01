// Upload test helpers: minimal images (only the signature matters to the API), a
// multipart/form-data builder and temporary storage directories under os.tmpdir().

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bytes = (...parts: (number[] | string)[]) =>
  Buffer.concat(
    parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))),
  );

export const JPEG = bytes(
  [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10],
  "JFIF\0",
  [1, 1, 0, 0, 1, 0, 1, 0, 0],
  [0xff, 0xd9],
);
export const PNG = bytes(
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  [0, 0, 0, 13],
  "IHDR",
  [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0],
);
export const WEBP = bytes("RIFF", [26, 0, 0, 0], "WEBPVP8L", [13, 0, 0, 0, 0x2f, 0, 0, 0, 0]);
export const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

export type FormPart =
  | { name: string; value: string }
  | { name: string; filename: string; type: string; data: Buffer };

const BOUNDARY = "----autowascenter-test-boundary";

/** Builds a multipart/form-data body exactly as a browser would send it. */
export function multipartBody(parts: FormPart[]) {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    if ("value" in part) {
      chunks.push(
        Buffer.from(
          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
        ),
      );
    } else {
      chunks.push(
        Buffer.from(
          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.type}\r\n\r\n`,
        ),
        part.data,
        Buffer.from("\r\n"),
      );
    }
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${BOUNDARY}`,
  };
}

export const imagePart = (data: Buffer, type: string, filename = "photo.jpg"): FormPart => ({
  name: "file",
  filename,
  type,
  data,
});

/** A fresh temporary directory; never inside the repository. */
export async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "autowascenter-uploads-"));
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}
