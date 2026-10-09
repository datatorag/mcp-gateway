/**
 * RFC 2047 encoding for the header values the raw MIME builder writes.
 *
 * A header field is ASCII or it is not a header: a raw UTF-8 byte in Subject
 * or in an address display name arrives as mojibake in Gmail and most other
 * clients, or the field is dropped. Non-ASCII text goes out as UTF-8 B-encoded
 * words, folded so no encoded-word passes 75 characters (RFC 2047 section 2),
 * split only on character boundaries, so a decoder reads the exact text back.
 *
 * Addresses are never encoded, only the display name in front of one: an
 * encoded-word inside an addr-spec is not an address.
 */

const ENCODED_WORD_MAX = 75;
const PREFIX = "=?UTF-8?B?";
const SUFFIX = "?=";
/** Base64 grows 3 bytes to 4 chars; this many raw bytes keeps a word at or under the limit. */
const BYTES_PER_WORD = Math.floor((ENCODED_WORD_MAX - PREFIX.length - SUFFIX.length) / 4) * 3;

export function isAscii(value: string): boolean {
  // Printable ASCII plus tab; a control character or anything above 0x7e
  // needs encoding (or is not a valid header at all).
  return /^[\x20-\x7e\t]*$/.test(value);
}

function encodedWord(bytes: Buffer): string {
  return `${PREFIX}${bytes.toString("base64")}${SUFFIX}`;
}

/** One value, encoded whole when it needs it, folded into words that each
 * fit the limit; a word boundary never falls inside a multi-byte character. */
export function encodeHeaderValue(value: string): string {
  if (isAscii(value)) return value;
  const words: string[] = [];
  let chunk: string[] = [];
  let chunkBytes = 0;
  for (const ch of value) {
    const n = Buffer.byteLength(ch, "utf-8");
    if (chunkBytes + n > BYTES_PER_WORD && chunk.length > 0) {
      words.push(encodedWord(Buffer.from(chunk.join(""), "utf-8")));
      chunk = [];
      chunkBytes = 0;
    }
    chunk.push(ch);
    chunkBytes += n;
  }
  if (chunk.length > 0) words.push(encodedWord(Buffer.from(chunk.join(""), "utf-8")));
  // Folded with CRLF + space: the whitespace between two adjacent
  // encoded-words is ignored by a decoder, so the text joins back exactly.
  return words.join("\r\n ");
}

/** Splits an address list on commas that sit outside double quotes. */
function splitAddresses(list: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of list) {
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** `Name <addr>` with a non-ASCII name becomes `=?UTF-8?B?...?= <addr>`; the
 * address itself is never touched, and an ASCII entry passes through as it was. */
/** Fold any line break out of a value destined for a header.
 *
 * `encodeHeaderValue` is safe by accident: `isAscii` excludes CR and LF, so a
 * value carrying one is B-encoded and the break stops being structural. The
 * address path has no such luck — a CRLF address has no angle-addr, so it
 * would be returned verbatim and a `\r\nBcc:` would become a real header.
 *
 * The same fold is what protects every value a reply or forward copies out of
 * an INBOUND message (Message-ID, References, Subject, From). Folds rather
 * than rejects: a reply must not fail because the message being replied to was
 * malformed. Callers still reject a line break in their OWN arguments, which
 * is a contract error deserving a clear message; this is the other half. */
export function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function encodeAddressHeader(list: string): string {
  if (isAscii(list)) return list;
  return splitAddresses(list)
    .map((entry) => {
      const m = /^(.*?)\s*<([^<>]+)>$/.exec(entry);
      // A bare address: nothing to ENCODE, but a line break in it would
      // still be structural, so it is folded.
      if (!m) return singleLine(entry);
      // Folded ONCE, here, because three of the returns below interpolate it
      // and a per-branch fold is one someone can forget.
      const addr = singleLine(m[2]);
      let name = m[1].trim();
      if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) {
        name = name.slice(1, -1);
      }
      if (name === "") return `<${addr}>`;
      // An ASCII name in a list that needed encoding elsewhere keeps its
      // quotes when it needs them (a comma or another special inside it),
      // so it stays one entry.
      if (isAscii(name)) {
        return /[",;:<>@()\\[\]]/.test(name) ? `"${name.replace(/"/g, '\\"')}" <${addr}>` : `${name} <${addr}>`;
      }
      return `${encodeHeaderValue(name)} <${addr}>`;
    })
    .join(", ");
}

/** The ONE place a header array becomes wire bytes.
 *
 * Folds any line break as it joins, so "no header line contains CR or LF" is a
 * property of the assembly rather than of every producer remembering to check.
 * The producers still reject a line break in the CALLER's own arguments
 * (`assertHeadersSingleLine`) — that is an argument-contract error worth a
 * clear message. This is the other half: attacker-supplied values copied out of
 * an inbound message get folded here, so a header derived somewhere new cannot
 * become an injection by being forgotten. */
export function renderHeaders(lines: string[]): string {
  return lines.map(foldUnlessContinuation).join("\r\n");
}

/** Fold every line break EXCEPT a legal RFC 2047/5322 continuation.
 *
 * `CRLF + SP|TAB` inside a header value is correct and wanted — it is how
 * `encodeHeaderValue` wraps a long encoded subject, and it is the one place a
 * CRLF in a header is not an injection. A blanket fold flattens those too,
 * which silently unfolds long non-ASCII subjects past the line-length limit.
 * The split captures the legal folds so only the gaps between them are
 * folded. */
function foldUnlessContinuation(line: string): string {
  return line
    .split(/(\r\n[ \t])/)
    .map((piece, i) => (i % 2 === 1 ? piece : piece.replace(/[\r\n]+/g, " ")))
    .join("");
}
