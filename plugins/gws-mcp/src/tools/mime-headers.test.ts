import { describe, expect, it } from "vitest";
import { encodeAddressHeader, encodeHeaderValue } from "./mime-headers.js";

/* RFC 2047 for the headers the raw MIME builder writes. A raw UTF-8 byte in a
 * header is not a header: Gmail and most clients show mojibake or drop the
 * subject. The test reads the exact text back through a decoder written from
 * the RFC, so what is pinned is the round trip, not the encoder's own view. */

/** Decode a header value that may hold RFC 2047 B-encoded words, folded or not. */
function decodeHeader(value: string): string {
  const unfolded = value.replace(/\r\n[ \t]/g, "");
  // Whitespace between two encoded-words is ignored (RFC 2047 section 6.2).
  const joined = unfolded.replace(/(\?=)\s+(=\?)/g, "$1$2");
  return joined.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=/g, (_m, b64: string) =>
    Buffer.from(b64, "base64").toString("utf-8")
  );
}

describe("encodeHeaderValue (RFC 2047, UTF-8, B encoding)", () => {
  it("leaves a plain ASCII value exactly as it is", () => {
    expect(encodeHeaderValue("Q4 proposal, v2")).toBe("Q4 proposal, v2");
  });

  it.each([
    ["an em-dash", "Launch — tomorrow"],
    ["an accented letter", "Résumé attached"],
    ["a CJK character", "会議のメモ"],
    ["all three", "Café — 東京"],
  ])("encodes a subject with %s and reads back the exact text", (_label, subject) => {
    const encoded = encodeHeaderValue(subject);
    expect(encoded).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=(\r\n =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=)*$/);
    expect(encoded).not.toMatch(/[^\x20-\x7e\r\n]/); // ASCII on the wire
    expect(decodeHeader(encoded)).toBe(subject);
  });

  it("folds a long value into encoded-words of at most 75 characters, never splitting a character", () => {
    const subject = "日本語の長い件名 ".repeat(8).trim();
    const encoded = encodeHeaderValue(subject);
    const words = encoded.split("\r\n ");
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    expect(decodeHeader(encoded)).toBe(subject);
  });
});

describe("encodeAddressHeader", () => {
  it("leaves ASCII addresses and names alone", () => {
    expect(encodeAddressHeader("a@example.com, Bob <bob@example.com>")).toBe(
      "a@example.com, Bob <bob@example.com>"
    );
  });

  it("encodes only the display name, keeping the address itself bare", () => {
    const encoded = encodeAddressHeader("Jörg Müller <jorg@example.com>, a@example.com");
    expect(encoded).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <jorg@example.com>, a@example.com$/);
    expect(decodeHeader(encoded)).toBe("Jörg Müller <jorg@example.com>, a@example.com");
  });

  it("keeps an ASCII quoted name quoted when the list needed encoding elsewhere", () => {
    const encoded = encodeAddressHeader('"Doe, John" <john@example.com>, Jörg <jorg@example.com>');
    expect(encoded.startsWith('"Doe, John" <john@example.com>, =?UTF-8?B?')).toBe(true);
    // Still two entries, not three: the comma inside the quotes stays inside them.
    expect(encoded.match(/<[^>]+>/g)).toHaveLength(2);
    expect(encoded).toContain('"Doe, John"');
  });

  it("does not split on a comma inside a quoted display name", () => {
    const encoded = encodeAddressHeader('"Müller, Jörg" <jorg@example.com>');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <jorg@example.com>$/);
    expect(decodeHeader(encoded)).toBe("Müller, Jörg <jorg@example.com>");
  });
});

describe("address headers cannot carry a line break (gate finding)", () => {
  it("folds CRLF out of a bare address instead of returning it verbatim", () => {
    const out = encodeAddressHeader("victim@example.com\r\nBcc: attacker@example.com");
    expect(out).not.toMatch(/[\r\n]/);
    expect(out).toContain("victim@example.com");
  });

  it("folds CRLF out of the address inside a display-name form", () => {
    const out = encodeAddressHeader('"N" <a@b.c\r\nBcc: attacker@example.com>');
    expect(out).not.toMatch(/[\r\n]/);
  });

  it("still FOLDS a long encoded value with CRLF, which is legal and wanted", () => {
    // The guard must not break RFC 2047 continuation folding, which is the
    // one place a CRLF in a header value is correct.
    const out = encodeAddressHeader(`${"ü".repeat(200)} <a@b.c>`);
    expect(out).toMatch(/\r\n /);
  });
});
