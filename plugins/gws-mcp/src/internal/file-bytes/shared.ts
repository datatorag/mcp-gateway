import type { GwsClient } from "../../gws-client.js";
import { errorMessage } from "../../google-api/errors.js";
import { base64urlFieldBytes } from "../../google-api/direct-upload.js";

/** What every file reference resolver shares: the answer shape, the
 * refusals, the capped read and the file name rules. The route
 * (`../file-bytes.ts`) and each resolver import from here, so no resolver
 * imports the route that registers it. */

/** The longest file name handed back, in UTF-16 units. */
export const MAX_NAME_LENGTH = 200;

export type FileBytesCode =
  | "ok"
  | "no_token"
  | "bad_request"
  | "unsupported_ref"
  | "too_large"
  | "not_found"
  | "upstream"
  | "method_not_allowed";

export interface FileBytesResponse {
  status: number;
  code: FileBytesCode;
  headers: Record<string, string>;
  body: Buffer;
}

/** One reference type. A new type is a file exporting one of these and a
 * line in the route's registry. */
export interface Resolver {
  /** The ref's own fields, checked before any call to Google: the text of a
   * 400 bad_request, or undefined when the ref is well formed. */
  validate(ref: Record<string, unknown>): string | undefined;
  /** The bytes of a ref `validate` accepted, never more than `maxBytes`. */
  resolve(ref: Record<string, unknown>, maxBytes: number, client: GwsClient): Promise<FileBytesResponse>;
}

/** A Gmail id as it goes into a URL path: letters, digits, _ and -. */
export const GMAIL_ID = /^[A-Za-z0-9_-]+$/;

export function refuse(status: number, code: FileBytesCode, error: string, extra?: Record<string, string>): FileBytesResponse {
  const body = Buffer.from(JSON.stringify({ error, code }), "utf8");
  return {
    status,
    code,
    headers: { "Content-Type": "application/json", "Content-Length": String(body.length), ...extra },
    body,
  };
}

/** The 200: the bytes, their type, and the name percent-encoded so any
 * character survives a header. */
export function found(body: Buffer, contentType: string, name: string): FileBytesResponse {
  return {
    status: 200,
    code: "ok",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.length),
      "X-File-Name": encodeURIComponent(name),
    },
    body,
  };
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** `what` is the noun the user reads: "message", "attachment". */
export const tooLarge = (what: string, size: number, cap: number) =>
  refuse(413, "too_large", `The ${what} is ${mb(size)}, which is over the ${mb(cap)} limit for one file.`);

/** What Google said, out of the transport's error text, without the wrapper.
 * The transport never puts the token in an error, so neither does this. */
function googleError(err: unknown): { status?: number; message: string } {
  const text = errorMessage(err).split("\n\n[transient")[0];
  const m = /^API error: (\{.*\})$/s.exec(text);
  if (m) {
    try {
      const e = (JSON.parse(m[1]) as { error?: { code?: number; message?: string } }).error;
      if (e?.message) return { status: e.code, message: e.message };
    } catch {
      // fall through to the text as it stands
    }
  }
  return { message: text };
}

/** A failed Gmail call as an answer. Every Gmail reference hangs off a
 * message, so a 404 is the message that is missing whichever read met it. */
export function upstreamFailure(what: string, err: unknown): FileBytesResponse {
  const { status, message } = googleError(err);
  if (status === 404) return refuse(404, "not_found", "Gmail has no message with that id in this mailbox.");
  return refuse(502, "upstream", `Gmail could not return the ${what}: ${message}`);
}

/** One base64url field of a JSON answer, decoded as it streams in and held
 * only up to the cap: the encoded text is never held whole, and the read
 * stops at the first byte past `maxBytes`, because a size Google reported
 * beforehand is not a promise. `over` is how many bytes had arrived then. */
export async function readCapped(
  stream: unknown,
  field: string,
  missing: string,
  maxBytes: number
): Promise<{ body: Buffer } | { over: number }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of base64urlFieldBytes(stream as AsyncIterable<Uint8Array>, field, missing)) {
    size += chunk.length;
    if (size > maxBytes) return { over: size };
    chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length));
  }
  return { body: Buffer.concat(chunks, size) };
}

/** Text as a file name part: no control characters, none of the characters
 * a file system refuses, whitespace collapsed. Line breaks and tabs (a
 * folded header) count as whitespace, so they become one space rather than
 * joining two words. Empty when nothing usable is left. */
export function sanitiseNamePart(text: string | undefined): string {
  return (text ?? "")
    .replace(/\s+/g, " ")
    .replace(/\p{Cc}/gu, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** `head + tail`, at most MAX_NAME_LENGTH long.
 *
 * THE TAIL IS NEVER CUT. It holds what makes the file open (the extension)
 * and whatever tells two files apart, so a long name loses head text and the
 * tail survives whole. */
export function fitName(head: string, tail: string): string {
  const room = MAX_NAME_LENGTH - tail.length;
  if (head.length > room) {
    // Not through the middle of a surrogate pair, and no space left dangling.
    head = head.slice(0, Math.max(room, 0)).toWellFormed().replace(/�$/, "").trimEnd();
  }
  // toWellFormed: a lone surrogate would make encodeURIComponent throw.
  return (head ? head + tail : tail.trimStart()).toWellFormed();
}
