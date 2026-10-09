import { randomUUID } from "node:crypto";
import {
  appendHtmlSignature,
  insertBeforeHtmlQuote,
  plainToHtml,
  signaturePresentInHtml,
} from "./gmail-signature.js";

/** A draft is signed by rewriting the MIME Gmail already stored, so the
 * result carries every header the draft had. `raw` is present only when the
 * state is `applied`; every other state means send the draft untouched. */
export interface DraftSignResult {
  raw?: string;
  state: "applied" | "already_present" | "skipped_unsupported_draft";
}

const UNSUPPORTED: DraftSignResult = { state: "skipped_unsupported_draft" };

/** The largest stored draft, in base64url characters, this will rewrite. */
export const DRAFT_SIGN_MAX_CHARS = 1024 * 1024;

/** Soft-wrap width for quoted-printable. RFC 2045 allows 76 including the
 * trailing "=", and a wrapped line can grow by two characters when the break
 * lands on whitespace that then has to be encoded, so the content budget is
 * held below the limit rather than at it. */
const QP_LINE = 72;

function decodeQuotedPrintableBytes(input: string): Buffer {
  const unfolded = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < unfolded.length; i++) {
    const ch = unfolded[i];
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(unfolded.slice(i + 1, i + 3))) {
      bytes.push(parseInt(unfolded.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    // Everything else in a quoted-printable stream is a single-byte literal.
    for (const b of Buffer.from(ch, "utf8")) bytes.push(b);
  }
  return Buffer.from(bytes);
}

export function decodeQuotedPrintable(input: string): string {
  return decodeQuotedPrintableBytes(input).toString("utf8");
}

/** Whitespace at the end of a line does not survive transport, so it is
 * encoded. This is the rule an ad-hoc encoder always misses. */
const fixTrailing = (line: string) =>
  line.replace(/[ \t]$/, (ws) => (ws === " " ? "=20" : "=09"));

export function encodeQuotedPrintable(input: string): string {
  const bytes = Buffer.from(input.replace(/\r\n|\r/g, "\n"), "utf8");
  const lines: string[] = [];
  let line = "";
  const put = (token: string) => {
    if (line.length + token.length > QP_LINE) {
      lines.push(`${fixTrailing(line)}=`);
      line = "";
    }
    line += token;
  };
  for (const b of bytes) {
    if (b === 0x0a) {
      lines.push(fixTrailing(line));
      line = "";
      continue;
    }
    const literal = (b >= 33 && b <= 126 && b !== 0x3d) || b === 0x20 || b === 0x09;
    put(literal ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, "0")}`);
  }
  lines.push(fixTrailing(line));
  return lines.join("\r\n");
}

type Cte = "7bit" | "8bit" | "binary" | "quoted-printable" | "base64";

function normaliseCte(value: string | undefined): Cte | undefined {
  const cte = (value ?? "7bit").trim().toLowerCase();
  if (cte === "7bit" || cte === "8bit" || cte === "binary") return cte;
  if (cte === "quoted-printable" || cte === "base64") return cte;
  return undefined;
}

function decodeCteBytes(body: string, cte: Cte): Buffer {
  if (cte === "quoted-printable") return decodeQuotedPrintableBytes(body);
  if (cte === "base64") return Buffer.from(body.replace(/\s/g, ""), "base64");
  return Buffer.from(body, "utf8");
}

/** Decode a part, or `undefined` when its bytes are not UTF-8.
 *
 * Proving the OUTER message is UTF-8 is not enough: a base64 or
 * quoted-printable part carries its own bytes, and those decode
 * independently. A part holding, say, a UTF-16 byte order mark passes the
 * outer check and would come back as replacement characters — mangling
 * content the signature never touches. So each part proves its own round trip
 * before anything is rewritten.
 *
 * Decoded text always uses "\n", so the insertion logic has one line ending
 * to reason about; encodeCte puts CRLF back. */
function decodePart(body: string, cte: Cte): string | undefined {
  const bytes = decodeCteBytes(body, cte);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) return undefined;
  return text.replace(/\r\n|\r/g, "\n");
}

function encodeCte(text: string, cte: Cte): string {
  if (cte === "quoted-printable") return encodeQuotedPrintable(text);
  const crlf = text.replace(/\n/g, "\r\n");
  if (cte === "base64") {
    return (Buffer.from(crlf, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
  }
  return crlf;
}

/** Header names are case-insensitive and a value may be folded onto
 * continuation lines, so the block is unfolded before it is read. */
function readHeader(headerBlock: string, name: string): string | undefined {
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    if (line.slice(0, colon).trim().toLowerCase() === name) return line.slice(colon + 1).trim();
  }
  return undefined;
}

/** Drop whole headers by name, continuation lines included. */
function withoutHeaders(headerBlock: string, names: string[]): string {
  const drop = new Set(names);
  const kept: string[] = [];
  let dropping = false;
  for (const line of headerBlock.split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) {
      if (!dropping) kept.push(line);
      continue;
    }
    const colon = line.indexOf(":");
    dropping = colon !== -1 && drop.has(line.slice(0, colon).trim().toLowerCase());
    if (!dropping && line !== "") kept.push(line);
  }
  return kept.join("\r\n");
}

/** Index just past the blank line that ends a header block, or -1. */
function bodyOffset(text: string, from = 0): number {
  const m = /\r?\n\r?\n/.exec(text.slice(from));
  return m ? from + m.index + m[0].length : -1;
}

/** A charset this code can safely round-trip through a JS string. Anything
 * else — latin-1, windows-1252, a CJK legacy encoding — would be mangled by
 * decoding it as UTF-8, so such a draft is left alone entirely. */
function charsetIsUtf8Safe(headerBlock: string): boolean {
  const contentType = readHeader(headerBlock, "content-type") ?? "";
  // An RFC 2231 continuation (charset*=UTF-8''iso-8859-1) is a form this does
  // not parse, and reading it as "unstated" would let a latin-1 part through.
  // Refuse rather than guess.
  if (/charset\s*\*\s*=/i.test(contentType)) return false;
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1];
  if (!charset) return true; // unstated defaults to us-ascii, a UTF-8 subset
  return ["utf-8", "utf8", "us-ascii", "ascii"].includes(charset.toLowerCase());
}

/** The longest line any MIME transfer encoding may emit (RFC 5322). */
const MAX_LINE = 998;

/** Can this text travel under the encoding its part's header declares?
 *
 * A signature holding an accent or an emoji is not 7bit, and a long signature
 * line breaks the line-length limit. Inserting it anyway produces invalid MIME
 * that some servers reject and others silently mangle, so a part that no
 * longer fits its declared encoding is re-encoded rather than shipped broken. */
function fitsEncoding(text: string, cte: Cte): boolean {
  if (cte === "quoted-printable" || cte === "base64") return true;
  if (cte === "7bit" && /[^\x00-\x7f]/.test(text)) return false;
  // Bytes, not characters: the limit is a wire limit, and one emoji is four
  // bytes but a single JS string unit pair.
  return !text.split("\n").some((line) => Buffer.byteLength(line, "utf8") > MAX_LINE);
}

/** Replace (or add) one header in a part's header block. */
function setHeader(headerBlock: string, name: string, value: string): string {
  const kept = withoutHeaders(headerBlock, [name.toLowerCase()]);
  return `${kept}\r\n${name}: ${value}`;
}

function mimeType(headerBlock: string): string {
  return (readHeader(headerBlock, "content-type") ?? "text/plain")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

export function draftFromHeader(rawB64: string): string | undefined {
  const message = Buffer.from(rawB64, "base64url").toString("utf8");
  const end = bodyOffset(message);
  return readHeader(end === -1 ? message : message.slice(0, end), "from");
}

interface Signature {
  html: string;
  text: string;
}

const encodeRaw = (message: string) => Buffer.from(message, "utf8").toString("base64url");

/** Put the signature into an HTML body: above the quoted original when there
 * is one, otherwise at the end. */
function signHtmlBody(html: string, sig: Signature): string {
  return insertBeforeHtmlQuote(html, sig.html) ?? appendHtmlSignature(html, sig.html);
}

/** Turn a single text/plain message into multipart/alternative, keeping the
 * plain part byte-identical and adding an HTML part that carries the
 * signature. The same promotion a plain `gmail_send` gets.
 *
 * The new part is written base64: we are authoring it, so there is no header
 * to preserve, and base64 has none of quoted-printable's line-length and
 * trailing-whitespace hazards. */
function promotePlainDraft(
  headerBlock: string,
  rawBody: string,
  plain: string,
  sig: Signature,
  nested: boolean
): string {
  const html = signHtmlBody(plainToHtml(plain), sig);
  const boundary = `=_gws_${randomUUID()}`;
  const partHeaders = [
    readHeader(headerBlock, "content-type") ?? "text/plain; charset=utf-8",
    readHeader(headerBlock, "content-transfer-encoding"),
  ];
  // A nested part may have had no header but its type, which leaves nothing
  // here; an empty line at the top would end the header block early.
  const kept = withoutHeaders(headerBlock, ["content-type", "content-transfer-encoding", "mime-version"]);
  return [
    ...(kept ? [kept] : []),
    ...(nested ? [] : ["MIME-Version: 1.0"]),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: ${partHeaders[0]}`,
    ...(partHeaders[1] ? [`Content-Transfer-Encoding: ${partHeaders[1]}`] : []),
    "",
    rawBody,
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeCte(html, "base64"),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** One part of a multipart draft, located in the original message so a
 * rewrite can replace exactly its body and leave every other byte alone. */
interface Part {
  kind: "plain" | "html";
  /** Start of this part's HEADER block, so a rewrite that has to change the
   * declared encoding can replace the headers as well as the body. */
  headerStart: number;
  start: number;
  end: number;
  cte: Cte;
  headers: string;
}

/** The largest stored draft WITH FILES, in base64url characters, this will
 * rewrite. Only its first part is decoded and edited; the files are spliced
 * back as the bytes they were, so this bounds the copy, not the work. */
export const DRAFT_WITH_FILES_MAX_CHARS = 36 * 1024 * 1024;

/** Append the account's signature to a draft's stored MIME.
 *
 * THE SIGNATURE GOES IN THE HTML PART ONLY; the plain part is never touched,
 * so only the HTML `gmail_quote` anchor matters. Two text shapes are
 * rewritten: a single `text/plain` message, which gains an HTML part, and
 * `multipart/alternative` whose parts are all `text/plain` or `text/html`,
 * whose HTML part is edited in place (or added when it has none).
 *
 * A draft with files (SCRUM-279) is `multipart/mixed` or `multipart/related`
 * whose FIRST part is one of those text shapes (or, for mixed, a related
 * part holding one). Only that first part is signed; every file after it is
 * carried across byte for byte and never decoded. Anything else — a nested
 * shape past that, an encoding we cannot re-emit — is reported
 * `skipped_unsupported_draft` and sent exactly as the user wrote it. */
export function signDraftRaw(rawB64: string, sig: Signature): DraftSignResult {
  // Checked FIRST, not after the rewrite. Decoding, rewriting and re-encoding
  // a message is un-yielding work on an event loop every session shares, so a
  // draft past this size is sent as it stands. A text draft is nowhere near
  // it. (This used to be the transport's one-argv-string limit. That limit
  // left with the CLI transport; the reason to bound the work did not.) A
  // draft with files has its own, larger bound below, because only its text
  // part is worked on.
  if (rawB64.length > DRAFT_WITH_FILES_MAX_CHARS) return UNSUPPORTED;
  // Past the text bound, only a draft with files goes on, and the headers
  // that say so are read from the head alone, before anything big is decoded.
  if (rawB64.length > DRAFT_SIGN_MAX_CHARS && !headDeclaresFiles(rawB64)) return UNSUPPORTED;

  const bytes = Buffer.from(rawB64, "base64url");
  const message = bytes.toString("utf8");
  // The whole message round-trips through a JS string, so a byte sequence that
  // is not valid UTF-8 would come back as replacement characters and corrupt
  // parts we never meant to touch. Prove the round trip before rewriting
  // anything; a draft that fails it is sent exactly as it stands.
  if (!Buffer.from(message, "utf8").equals(bytes)) return UNSUPPORTED;

  const out = signEntity(message, sig, 0);
  if (out.state !== "applied" || out.text === undefined) return { state: out.state };
  return { raw: encodeRaw(out.text), state: "applied" };
}

/** Whether a draft's top-level type is multipart/mixed or related, read from
 * its first 64 KB (a header block is far smaller) without decoding the rest. */
function headDeclaresFiles(rawB64: string): boolean {
  const head = Buffer.from(rawB64.slice(0, 64 * 1024), "base64url").toString("utf8");
  const end = bodyOffset(head);
  if (end === -1) return false;
  const type = mimeType(head.slice(0, end));
  return type === "multipart/mixed" || type === "multipart/related";
}

interface EntityResult {
  text?: string;
  state: DraftSignResult["state"];
}

const UNSUPPORTED_ENTITY: EntityResult = { state: "skipped_unsupported_draft" };

/** Sign one MIME entity: the whole message at depth 0, the first part of a
 * mixed or related container below it. Returns the rewritten entity text. */
function signEntity(message: string, sig: Signature, depth: number): EntityResult {
  const bodyStart = bodyOffset(message);
  if (bodyStart === -1) return UNSUPPORTED_ENTITY;

  const headerBlock = message.slice(0, bodyStart);
  const contentType = readHeader(headerBlock, "content-type") ?? "text/plain";
  const type = mimeType(headerBlock);

  if (type === "multipart/mixed" || type === "multipart/related") {
    const boundary = /boundary\s*=\s*"?([^";]+)"?/i.exec(contentType)?.[1];
    if (!boundary) return UNSUPPORTED_ENTITY;
    const body = message.slice(bodyStart);
    const delims = findDelimiters(body, boundary);
    if (delims.length < 2) return UNSUPPORTED_ENTITY;
    if (!body.startsWith(`--${boundary}--`, delims[delims.length - 1])) return UNSUPPORTED_ENTITY;
    const lineEnd = body.indexOf("\n", delims[0]);
    if (lineEnd === -1) return UNSUPPORTED_ENTITY;
    const regionStart = lineEnd + 1;
    let regionEnd = delims[1];
    if (body[regionEnd - 1] === "\n") regionEnd--;
    if (body[regionEnd - 1] === "\r") regionEnd--;
    if (regionEnd < regionStart) return UNSUPPORTED_ENTITY;
    const first = body.slice(regionStart, regionEnd);
    const firstType = mimeType(first.slice(0, Math.max(0, bodyOffset(first))));
    // What a first part may be. This table is also the depth bound: a
    // related part is allowed only under mixed, and nothing else nests, so
    // mixed > related > text is as deep as the recursion can go.
    const allowed =
      firstType === "text/plain" ||
      firstType === "multipart/alternative" ||
      (type === "multipart/mixed" && firstType === "multipart/related");
    if (!allowed) return UNSUPPORTED_ENTITY;
    // The text part is bounded as a whole text draft is.
    if (Buffer.byteLength(first, "utf8") > (DRAFT_SIGN_MAX_CHARS * 3) / 4 && firstType !== "multipart/related") {
      return UNSUPPORTED_ENTITY;
    }
    const signed = signEntity(first, sig, depth + 1);
    if (signed.state !== "applied" || signed.text === undefined) return signed;
    return {
      text: message.slice(0, bodyStart + regionStart) + signed.text + message.slice(bodyStart + regionEnd),
      state: "applied",
    };
  }

  // A part inside a container carries no MIME-Version of its own.
  const nested = depth > 0;

  if (type === "text/plain") {
    const cte = normaliseCte(readHeader(headerBlock, "content-transfer-encoding"));
    if (!cte) return UNSUPPORTED_ENTITY;
    if (!charsetIsUtf8Safe(headerBlock)) return UNSUPPORTED_ENTITY;
    const rawBody = message.slice(bodyStart);
    const plain = decodePart(rawBody, cte);
    if (plain === undefined) return UNSUPPORTED_ENTITY;
    if (signaturePresentInHtml(plainToHtml(plain), sig.text)) {
      return { state: "already_present" };
    }
    return { text: promotePlainDraft(headerBlock, rawBody, plain, sig, nested), state: "applied" };
  }

  if (type !== "multipart/alternative") return UNSUPPORTED_ENTITY;

  const boundary = /boundary\s*=\s*"?([^";]+)"?/i.exec(contentType)?.[1];
  if (!boundary) return UNSUPPORTED_ENTITY;

  const body = message.slice(bodyStart);
  const delims = findDelimiters(body, boundary);
  if (delims.length < 2) return UNSUPPORTED_ENTITY;
  if (!body.startsWith(`--${boundary}--`, delims[delims.length - 1])) return UNSUPPORTED_ENTITY;

  const parts: Part[] = [];
  for (let k = 0; k < delims.length - 1; k++) {
    const lineEnd = body.indexOf("\n", delims[k]);
    if (lineEnd === -1) return UNSUPPORTED_ENTITY;
    const regionStart = lineEnd + 1;
    let regionEnd = delims[k + 1];
    if (body[regionEnd - 1] === "\n") regionEnd--;
    if (body[regionEnd - 1] === "\r") regionEnd--;
    if (regionEnd < regionStart) return UNSUPPORTED_ENTITY;

    const region = body.slice(regionStart, regionEnd);
    const partBodyStart = bodyOffset(region);
    if (partBodyStart === -1) return UNSUPPORTED_ENTITY;
    const partHeaders = region.slice(0, partBodyStart);

    const kind = textPartKind(mimeType(partHeaders));
    if (!kind) return UNSUPPORTED_ENTITY;
    const cte = normaliseCte(readHeader(partHeaders, "content-transfer-encoding"));
    if (!cte) return UNSUPPORTED_ENTITY;

    if (!charsetIsUtf8Safe(partHeaders)) return UNSUPPORTED_ENTITY;
    parts.push({
      kind,
      headerStart: bodyStart + regionStart,
      start: bodyStart + regionStart + partBodyStart,
      end: bodyStart + regionEnd,
      cte,
      headers: partHeaders.replace(/\r?\n$/, ""),
    });
  }
  if (parts.length === 0) return UNSUPPORTED_ENTITY;

  const htmlPart = parts.find((p) => p.kind === "html");
  if (htmlPart) {
    const html = decodePart(message.slice(htmlPart.start, htmlPart.end), htmlPart.cte);
    if (html === undefined) return UNSUPPORTED_ENTITY;
    if (signaturePresentInHtml(html, sig.text)) return { state: "already_present" };
    const signed = signHtmlBody(html, sig);

    if (fitsEncoding(signed, htmlPart.cte)) {
      const out =
        message.slice(0, htmlPart.start) +
        encodeCte(signed, htmlPart.cte) +
        message.slice(htmlPart.end);
      return { text: out, state: "applied" };
    }
    // The signature does not fit what this part declares (an accent or an
    // emoji in a 7bit part, or a line past the limit). Re-encode the part as
    // base64 and say so in its header, rather than emitting invalid MIME.
    const rewritten =
      `${setHeader(htmlPart.headers, "Content-Transfer-Encoding", "base64")}\r\n\r\n` +
      encodeCte(signed, "base64");
    const out = message.slice(0, htmlPart.headerStart) + rewritten + message.slice(htmlPart.end);
    return { text: out, state: "applied" };
  }

  // multipart/alternative with no HTML part: add one, derived from the plain
  // part exactly as a plain-only draft is promoted.
  const plainPart = parts[0];
  const plain = decodePart(message.slice(plainPart.start, plainPart.end), plainPart.cte);
  if (plain === undefined) return UNSUPPORTED_ENTITY;
  // Escaped once: the presence check and the signing below want the same
  // string, and plainToHtml is five full-body regex passes.
  const plainAsHtml = plainToHtml(plain);
  if (signaturePresentInHtml(plainAsHtml, sig.text)) return { state: "already_present" };
  const html = signHtmlBody(plainAsHtml, sig);
  const closing = bodyStart + delims[delims.length - 1];
  const added = [
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeCte(html, "base64"),
    "",
  ].join("\r\n");
  return {
    text: message.slice(0, closing) + added + message.slice(closing),
    state: "applied",
  };
}

/** Offsets of every boundary delimiter line within a multipart body. */
function findDelimiters(body: string, boundary: string): number[] {
  const needle = `--${boundary}`;
  const found: number[] = [];
  for (let i = body.indexOf(needle); i !== -1; i = body.indexOf(needle, i + 1)) {
    if (i !== 0 && body[i - 1] !== "\n") continue;
    // RFC 2046 allows only the closing "--" and linear whitespace after the
    // boundary. Without this, a body line reading "--boundaryEXTRA" is taken
    // for a delimiter and splits the part early.
    const after = body[i + needle.length];
    if (after !== undefined && !["-", "\r", "\n", " ", "\t"].includes(after)) continue;
    found.push(i);
  }
  return found;
}

function textPartKind(type: string): "plain" | "html" | undefined {
  if (type === "text/plain") return "plain";
  if (type === "text/html") return "html";
  return undefined;
}
