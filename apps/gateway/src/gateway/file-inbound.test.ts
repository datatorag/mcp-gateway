/**
 * SCRUM-437: a file the caller already holds, carried in the call as base64.
 * The gateway decodes, cleans and types it itself; no source plugin is asked.
 */

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CONTENT_BYTES,
  cleanInboundName,
  resolveContent,
  typeForName,
} from "./file-inbound";

const ref = (fields: Record<string, unknown>) => ({ type: "content", ...fields });

describe("resolveContent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("decodes the base64 to the bytes, under the cleaned name and the declared type", () => {
    const out = resolveContent(ref({ name: "notes.txt", base64: "aGk=", mime_type: "text/plain" }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.file.bytes.toString("utf8")).toBe("hi");
    expect(out.file.name).toBe("notes.txt");
    expect(out.file.type).toBe("text/plain");
  });

  it("accepts base64 without its padding", () => {
    const out = resolveContent(ref({ name: "a.bin", base64: "aGk" }));
    expect(out.ok && out.file.bytes.toString("utf8")).toBe("hi");
  });

  it.each([
    ["a trailing line break", "aGk=\n"],
    ["a space inside", "aG k="],
    ["line-wrapped base64", "aGVsbG8g\nd29ybGQ="],
    ["the base64url alphabet", "a-k="],
    ["padding in the middle", "aG=k"],
    ["a length no base64 can have", "aGk=a"],
  ])("refuses %s rather than decoding a damaged file", (_label, base64) => {
    const out = resolveContent(ref({ name: "a.bin", base64 }));
    expect(out).toEqual({
      ok: false,
      text: "The base64 must be one unbroken string of the standard alphabet. Nothing was uploaded.",
    });
  });

  it("refuses an empty file", () => {
    const out = resolveContent(ref({ name: "a.bin", base64: "" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.text).toContain("empty");
  });

  it("takes a file of exactly the cap", () => {
    const base64 = Buffer.alloc(MAX_CONTENT_BYTES, 1).toString("base64");
    const out = resolveContent(ref({ name: "a.bin", base64 }));
    expect(out.ok && out.file.bytes.byteLength).toBe(MAX_CONTENT_BYTES);
  });

  it("refuses one byte over the cap, naming the cap", () => {
    const base64 = Buffer.alloc(MAX_CONTENT_BYTES + 1, 1).toString("base64");
    const out = resolveContent(ref({ name: "a.bin", base64 }));
    expect(out).toEqual({
      ok: false,
      text: "The file is larger than 1 MB, the most a content reference carries. Nothing was uploaded.",
    });
  });

  it("refuses base64 too long for the cap before decoding any of it", () => {
    const spy = vi.spyOn(Buffer, "from");
    const out = resolveContent(ref({ name: "a.bin", base64: "A".repeat(Math.ceil(MAX_CONTENT_BYTES / 3) * 4 + 4) }));
    expect(out.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("is the bytes the caller sent, so the destination's receipt hash is the caller's", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252]);
    const out = resolveContent(ref({ name: "a.bin", base64: bytes.toString("base64") }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    expect(hash(out.file.bytes)).toBe(hash(bytes));
  });
});

describe("cleanInboundName", () => {
  it("drops path separators and leading dots", () => {
    expect(cleanInboundName("../.npmrc")).toBe("npmrc");
  });

  it("does not keep a reserved device name", () => {
    expect(cleanInboundName("con.txt")).toBe("download.txt");
  });

  it("fits a long name to 200 units and keeps the extension", () => {
    const out = cleanInboundName(`${"a".repeat(300)}.pdf`);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".pdf")).toBe(true);
  });

  it("does not split a character in two when it fits", () => {
    const out = cleanInboundName(`${"é".repeat(150)}${"😀".repeat(40)}.png`);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toBe(out.toWellFormed());
    expect(out.endsWith(".png")).toBe(true);
  });
});

describe("typeForName", () => {
  it("uses a declared type when it is well formed", () => {
    expect(typeForName("a.png", "image/png")).toBe("image/png");
    expect(typeForName("a.bin", "application/vnd.custom+json")).toBe("application/vnd.custom+json");
  });

  it("falls back to the extension when the declared type is not a type", () => {
    expect(typeForName("a.png", "not a type")).toBe("image/png");
    expect(typeForName("a.png", "image/png\r\nX-Evil: 1")).toBe("image/png");
    expect(typeForName("a.PDF")).toBe("application/pdf");
  });

  it("is opaque when neither says", () => {
    expect(typeForName("a.zzz")).toBe("application/octet-stream");
    expect(typeForName("noextension")).toBe("application/octet-stream");
  });
});
