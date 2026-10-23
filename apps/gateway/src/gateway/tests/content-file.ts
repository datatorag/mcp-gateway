import { createHash } from "node:crypto";

/**
 * The file the content-reference cases send (SCRUM-437): 1 KB, generated,
 * the same every run, with a PNG signature so a destination that looks at
 * the type sees an image. It is a fixture of the run, not of an account.
 */
export function contentFile(): { bytes: Buffer; base64: string; sha256: string } {
  const bytes = Buffer.alloc(1024);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  for (let i = 8; i < bytes.length; i++) bytes[i] = (i * 31) % 256;
  return {
    bytes,
    base64: bytes.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
