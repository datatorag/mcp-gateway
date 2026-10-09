import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { renderHeaders } from "../tools/mime-headers.js";

/**
 * A message with attachments, built as a stream (SCRUM-279).
 *
 * Pure: headers, bodies and byte sources in, a byte stream out. Nothing here
 * calls Google, and nothing holds an attachment whole: each source is read as
 * the stream is consumed and base64-encoded as it passes, so the most this
 * holds at once is one chunk of one file.
 *
 * Shapes, from the inside out:
 *   body     text/plain, or multipart/alternative (plain first, then html)
 *   related  multipart/related [body, inline images...]   when any file is inline
 *   mixed    multipart/mixed [body or related, files...]  when any file is attached
 * A message with neither is not built here; the caller keeps today's path.
 */

export interface MessageBodies {
  plain: string;
  /** When present the body is multipart/alternative. */
  html?: string;
}

export interface ByteAttachment {
  filename: string;
  mimeType: string;
  /** Without angle brackets. */
  contentId: string;
  /** `inline` sits in multipart/related and renders where the HTML
   * references `cid:<contentId>`; `attachment` goes in multipart/mixed. */
  disposition: "inline" | "attachment";
  /** Opened once, when the stream reaches this part. */
  open: () => AsyncIterable<Uint8Array>;
}

interface Entity {
  headers: string[];
  body: () => AsyncIterable<string | Buffer>;
}

const CRLF = "\r\n";

function boundary(): string {
  return `=_gws_${randomUUID()}`;
}

function textEntity(type: "plain" | "html", text: string): Entity {
  return {
    headers: [`Content-Type: text/${type}; charset=utf-8`],
    body: async function* () {
      yield text;
    },
  };
}

/** The same wire shape as the unattached send path: plain part first, since
 * clients prefer the last part they can render. */
function bodyEntity(bodies: MessageBodies): Entity {
  if (bodies.html === undefined) return textEntity("plain", bodies.plain);
  return multipart("alternative", [textEntity("plain", bodies.plain), textEntity("html", bodies.html)]);
}

function multipart(subtype: string, children: Entity[], extra = ""): Entity {
  const b = boundary();
  return {
    headers: [`Content-Type: multipart/${subtype}; boundary="${b}"${extra}`],
    body: async function* () {
      for (const child of children) {
        yield `--${b}${CRLF}${renderHeaders(child.headers)}${CRLF}${CRLF}`;
        yield* child.body();
        yield CRLF;
      }
      yield `--${b}--${CRLF}`;
    },
  };
}

/** base64 at 76 columns: 57 input bytes make one line, so whole lines are
 * emitted as bytes arrive and the remainder waits for the next chunk. */
const LINE_BYTES = 57;

function encodeLines(bytes: Buffer): string {
  const text = bytes.toString("base64");
  let out = "";
  for (let i = 0; i < text.length; i += 76) out += text.slice(i, i + 76) + CRLF;
  return out;
}

export async function* base64Lines(source: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  let carry: Buffer = Buffer.alloc(0);
  for await (const chunk of source) {
    const joined = carry.length > 0 ? Buffer.concat([carry, chunk]) : Buffer.from(chunk);
    const whole = joined.length - (joined.length % LINE_BYTES);
    if (whole > 0) yield encodeLines(joined.subarray(0, whole));
    carry = Buffer.from(joined.subarray(whole));
  }
  if (carry.length > 0) yield encodeLines(carry);
}

/** A MIME type the header can carry as it stands: `type/subtype` in token
 * characters. Anything else (a parameter smuggled in, a quote, a line break)
 * is sent as application/octet-stream rather than written into the header. */
const MIME_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;

export function safeMimeType(value: string | undefined): string {
  return value && MIME_TYPE.test(value) ? value.toLowerCase() : "application/octet-stream";
}

/** A filename fit for a header parameter: no control characters, no path
 * separators, bounded length. The name still reaches the recipient; it just
 * cannot break the header it sits in. */
export function safeFilename(value: string | undefined): string {
  const cleaned = Array.from((value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "_").trim())
    .slice(0, 200)
    .join("");
  return cleaned === "" ? "attachment" : cleaned;
}

/** Characters RFC 2231 lets through unencoded in an extended value. */
const ATTR_CHAR = /[A-Za-z0-9!#$&+.^_`|~-]/;
const SEGMENT = 60;

/** `name="x"` when the value is short plain ASCII, otherwise RFC 2231 with
 * continuations, each on its own folded line, so no header line approaches
 * the 998-octet limit whatever the filename. */
export function fileParam(param: string, filename: string): string {
  if (/^[\x20-\x7e]*$/.test(filename) && filename.length <= SEGMENT) {
    return `${param}="${filename.replace(/(["\\])/g, "\\$1")}"`;
  }
  const encoded: string[] = [];
  for (const byte of Buffer.from(filename, "utf8")) {
    const ch = String.fromCharCode(byte);
    encoded.push(byte < 0x80 && ATTR_CHAR.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`);
  }
  const segments: string[] = [];
  let current = "";
  for (const token of encoded) {
    if (current.length + token.length > SEGMENT) {
      segments.push(current);
      current = "";
    }
    current += token;
  }
  if (current) segments.push(current);
  return segments.map((s, i) => `${param}*${i}*=${i === 0 ? "UTF-8''" : ""}${s}`).join(`;${CRLF}\t`);
}

function attachmentEntity(file: ByteAttachment): Entity {
  const name = safeFilename(file.filename);
  return {
    headers: [
      `Content-Type: ${safeMimeType(file.mimeType)};${CRLF}\t${fileParam("name", name)}`,
      `Content-Disposition: ${file.disposition};${CRLF}\t${fileParam("filename", name)}`,
      "Content-Transfer-Encoding: base64",
      `Content-ID: <${file.contentId}>`,
    ],
    body: () => base64Lines(file.open()),
  };
}

/** The whole message as a byte stream. `headers` are the message's own
 * (To, Subject, threading); MIME-Version and the top Content-Type are added
 * here. Every header line passes through `renderHeaders`, so a line break in
 * any value is folded, never structural. */
export function buildMessage(headers: string[], bodies: MessageBodies, files: ByteAttachment[]): Readable {
  const inline = files.filter((f) => f.disposition === "inline");
  const attached = files.filter((f) => f.disposition === "attachment");
  let entity = bodyEntity(bodies);
  if (inline.length > 0) {
    const rootType = bodies.html === undefined ? "text/plain" : "multipart/alternative";
    entity = multipart("related", [entity, ...inline.map(attachmentEntity)], `; type="${rootType}"`);
  }
  if (attached.length > 0) entity = multipart("mixed", [entity, ...attached.map(attachmentEntity)]);
  const top = entity;
  async function* stream(): AsyncGenerator<Buffer> {
    yield Buffer.from(`${renderHeaders([...headers, "MIME-Version: 1.0", ...top.headers])}${CRLF}${CRLF}`);
    for await (const piece of top.body()) yield typeof piece === "string" ? Buffer.from(piece, "utf8") : piece;
  }
  return Readable.from(stream(), { objectMode: false });
}
