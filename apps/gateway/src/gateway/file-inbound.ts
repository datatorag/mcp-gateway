/**
 * SCRUM-437: files the caller already holds, resolved in the gateway.
 *
 * A plugin-sourced reference names a file in a connected service, and the
 * crossing asks that service's plugin for the bytes. A local reference has
 * no source to ask: a `content` reference carries the file as base64 in the
 * call. This module turns one into the same `SourceFile` a plugin read gives,
 * so the destination leg after it is unchanged.
 *
 * The gateway is a corridor. Nothing here writes to disk or to a log, and
 * the decoded bytes live only as long as the crossing that holds them.
 */

import { safeDownloadName } from "./file-download";
import type { FileReference, SourceFile } from "./file-crossing";

/** The largest `content` file, decoded. The model has to write every
 * character of the base64 itself, so this sits well above any file a model
 * carries in practice and well below what the transport allows. */
export const MAX_CONTENT_BYTES = 1024 * 1024;
const CAP_WORDS = `${MAX_CONTENT_BYTES / (1024 * 1024)} MB`;
const TOO_LARGE = `The file is larger than ${CAP_WORDS}, the most a content reference carries. Nothing was uploaded.`;

/** The longest base64 a file of the cap can be, padding included. Anything
 * longer is refused before a byte is decoded. */
const MAX_BASE64_CHARS = Math.ceil(MAX_CONTENT_BYTES / 3) * 4;

/** The longest name kept, in UTF-16 units, as the source plugins keep them. */
const MAX_NAME_UNITS = 200;

/** Types by extension, for a name whose declared type is missing or not a
 * type. Short on purpose: anything else is opaque. */
export const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** `type/subtype` with an optional parameter, nothing that could end a header. */
const MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}(?:;[ \x21-\x7e]{0,200})?$/;

/** The standard base64 alphabet with padding only at the end. Node's decoder
 * skips characters it does not know, so a wrapped or base64url string would
 * decode to a different, damaged file without a word; it is checked here
 * instead. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * The name a file the caller sent is stored under. `safeDownloadName` is the
 * gateway's own rule (no control or direction characters, no separators, no
 * leading dots, no reserved device name); the name is then fitted to the
 * length the source plugins keep, with its extension, and never with half a
 * character at the cut. The destination plugins clean it again.
 */
export function cleanInboundName(name: string, fallback = "download"): string {
  const cleaned = safeDownloadName(name, fallback);
  if (cleaned.length <= MAX_NAME_UNITS) return cleaned;
  const ext = /\.[A-Za-z0-9]{1,10}$/.exec(cleaned)?.[0] ?? "";
  const head = cleaned.slice(0, MAX_NAME_UNITS - ext.length).toWellFormed().replace(/�$/, "").trimEnd();
  return `${head}${ext}`;
}

/** The type a file the caller sent is handed on with: the declared one when
 * it is a well-formed media type, else the extension's, else opaque. */
export function typeForName(name: string, declared?: unknown): string {
  if (typeof declared === "string" && MEDIA_TYPE.test(declared)) return declared;
  const ext = /\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1]?.toLowerCase();
  return ext && Object.hasOwn(EXTENSION_TYPES, ext) ? EXTENSION_TYPES[ext] : "application/octet-stream";
}

/**
 * A `content` reference, decoded. `readReference` has already checked that
 * `name` and `base64` are non-empty strings.
 */
export function resolveContent(ref: FileReference): { ok: true; file: SourceFile } | { ok: false; text: string } {
  const base64 = typeof ref.base64 === "string" ? ref.base64 : "";
  if (base64.length > MAX_BASE64_CHARS) {
    return {
      ok: false,
      text: TOO_LARGE,
    };
  }
  const unpadded = base64.replace(/=+$/, "");
  if (!BASE64.test(base64) || unpadded.length % 4 === 1) {
    return {
      ok: false,
      text: "The base64 must be one unbroken string of the standard alphabet. Nothing was uploaded.",
    };
  }
  const bytes = Buffer.from(base64, "base64") as Buffer<ArrayBuffer>;
  if (bytes.byteLength === 0) {
    return { ok: false, text: "The file is empty. Nothing was uploaded." };
  }
  if (bytes.byteLength > MAX_CONTENT_BYTES) {
    return {
      ok: false,
      text: TOO_LARGE,
    };
  }
  const name = cleanInboundName(typeof ref.name === "string" ? ref.name : "");
  return { ok: true, file: { bytes, name, type: typeForName(name, ref.mime_type) } };
}
