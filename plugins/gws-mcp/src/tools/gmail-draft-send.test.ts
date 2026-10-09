import { describe, expect, it } from "vitest";
import {
  decodeQuotedPrintable,
  draftFromHeader,
  encodeQuotedPrintable,
  signDraftRaw,
} from "./gmail-draft-send.js";

/** Fixed fixtures, never the live signature. */
const SIG = {
  html: '<div dir="ltr">Regards,<div>Dana Rivers</div></div>',
  text: "Regards, Dana Rivers",
};

const enc = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const dec = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const msg = (...lines: string[]) => lines.join("\r\n");

const PLAIN_DRAFT = msg(
  "From: Dana Rivers <sender@example.com>",
  "To: someone@example.com",
  "Subject: Hello",
  "Content-Type: text/plain; charset=UTF-8",
  "",
  "Hi there"
);

/** Pull one part's decoded body out of a signed result. */
function partBodies(raw: string) {
  const out = dec(raw);
  const boundary = /boundary="([^"]+)"/.exec(out)?.[1];
  if (!boundary) throw new Error("no multipart boundary");
  return out
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((p) => {
      const region = p.replace(/^\r\n/, "");
      const sep = region.indexOf("\r\n\r\n");
      const headers = region.slice(0, sep);
      let body = region.slice(sep + 4).replace(/\r\n$/, "");
      if (/base64/i.test(headers)) body = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
      if (/quoted-printable/i.test(headers)) body = decodeQuotedPrintable(body);
      return { headers, body };
    });
}

describe("quoted-printable codec", () => {
  const roundTrip = (s: string) => decodeQuotedPrintable(encodeQuotedPrintable(s));

  it("round-trips plain ASCII", () => {
    expect(roundTrip("Hi there")).toBe("Hi there");
  });

  it("round-trips an equals sign", () => {
    expect(encodeQuotedPrintable("a=b")).toBe("a=3Db");
    expect(roundTrip("a=b")).toBe("a=b");
  });

  it("round-trips multi-byte UTF-8", () => {
    expect(encodeQuotedPrintable("café")).toBe("caf=C3=A9");
    expect(roundTrip("café")).toBe("café");
  });

  it("encodes whitespace that would otherwise be trailing", () => {
    expect(encodeQuotedPrintable("a \r\nb")).toBe("a=20\r\nb");
    expect(roundTrip("a \r\nb")).toBe("a \r\nb");
  });

  it("soft-wraps a long line and round-trips it", () => {
    const long = "x".repeat(200);
    const out = encodeQuotedPrintable(long);
    expect(out).toContain("=\r\n");
    for (const line of out.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    expect(roundTrip(long)).toBe(long);
  });

  it("decodes a soft line break as no break at all", () => {
    expect(decodeQuotedPrintable("ab=\r\ncd")).toBe("abcd");
  });
});

describe("draftFromHeader", () => {
  it("reads the From header", () => {
    expect(draftFromHeader(enc(PLAIN_DRAFT))).toBe("Dana Rivers <sender@example.com>");
  });

  it("unfolds a From header wrapped onto a second line", () => {
    const folded = msg("From: Dana Rivers", " <sender@example.com>", "To: a@b.c", "", "Hi");
    expect(draftFromHeader(enc(folded))).toBe("Dana Rivers <sender@example.com>");
  });

  it("is undefined when there is no From header", () => {
    expect(draftFromHeader(enc(msg("To: a@b.c", "", "Hi")))).toBeUndefined();
  });
});

describe("a text/plain-only draft gains an HTML part", () => {
  it("keeps the plain part unsigned and puts the signature in the new HTML part", () => {
    const out = signDraftRaw(enc(PLAIN_DRAFT), SIG);
    expect(out.state).toBe("applied");
    const parts = partBodies(out.raw!);
    expect(parts).toHaveLength(2);
    expect(parts[0].headers).toContain("text/plain");
    expect(parts[0].body).toBe("Hi there");
    expect(parts[0].body).not.toContain("Dana Rivers");
    expect(parts[1].headers).toContain("text/html");
    expect(parts[1].body).toContain("Hi there");
    expect(parts[1].body).toContain(SIG.html);
  });

  it("keeps every other header and drops only the ones it replaces", () => {
    const got = dec(signDraftRaw(enc(PLAIN_DRAFT), SIG).raw!);
    const headers = got.slice(0, got.indexOf("\r\n\r\n"));
    expect(headers).toContain("From: Dana Rivers <sender@example.com>");
    expect(headers).toContain("To: someone@example.com");
    expect(headers).toContain("Subject: Hello");
    expect(headers).toContain("multipart/alternative");
    // the old single-part Content-Type must not remain at the top level
    expect(headers).not.toContain("Content-Type: text/plain");
  });

  it("carries a quoted-printable plain body through byte-identical", () => {
    const draft = msg(
      "From: a@b.c",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Caf=C3=A9 time"
    );
    const parts = partBodies(signDraftRaw(enc(draft), SIG).raw!);
    expect(parts[0].headers).toContain("quoted-printable");
    expect(parts[0].body).toBe("Café time");
    expect(parts[1].body).toContain(SIG.html);
  });

  it("treats a missing Content-Type as text/plain", () => {
    expect(signDraftRaw(enc(msg("From: a@b.c", "To: d@e.f", "", "Hi")), SIG).state).toBe("applied");
  });

  it("refuses an encoding it cannot re-emit", () => {
    const draft = msg(
      "From: a@b.c",
      "Content-Type: text/plain",
      "Content-Transfer-Encoding: uuencode",
      "",
      "Hi"
    );
    expect(signDraftRaw(enc(draft), SIG).state).toBe("skipped_unsupported_draft");
  });
});

describe("multipart/alternative: the HTML part only", () => {
  const alt = (plain: string, html: string, boundary = "b1") =>
    msg(
      "From: Dana Rivers <sender@example.com>",
      "To: someone@example.com",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      plain,
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "",
      html,
      `--${boundary}--`,
      ""
    );

  it("signs the html part and leaves the plain part byte-identical", () => {
    const out = signDraftRaw(enc(alt("Hi there", "<div>Hi there</div>")), SIG);
    expect(out.state).toBe("applied");
    const got = dec(out.raw!);
    expect(got).toContain(SIG.html);
    expect(got).toContain('class="gmail_signature"');
    const parts = partBodies(out.raw!);
    expect(parts[0].body).toBe("Hi there");
    expect(parts[0].body).not.toContain("Dana Rivers");
    expect(parts[1].body).toContain(SIG.html);
  });

  it("keeps the boundary and the part headers", () => {
    const got = dec(signDraftRaw(enc(alt("Hi", "<div>Hi</div>")), SIG).raw!);
    expect(got).toContain('Content-Type: multipart/alternative; boundary="b1"');
    expect(got).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(got).toContain("Content-Type: text/html; charset=UTF-8");
    expect(got).toContain("--b1--");
  });

  it("inserts above the quote when the HTML part holds a quoted reply", () => {
    const html = `<div>My reply</div><div class="gmail_quote">earlier</div>`;
    const got = dec(signDraftRaw(enc(alt("My reply", html)), SIG).raw!);
    expect(got.indexOf("gmail_signature")).toBeLessThan(got.indexOf("gmail_quote"));
  });

  it("signs a quoted reply even though the plain part has no attribution line", () => {
    // the plain anchor no longer matters: the plain part is never touched
    const html = `<div>My reply</div><div class="gmail_quote">earlier</div>`;
    expect(signDraftRaw(enc(alt("My reply", html)), SIG).state).toBe("applied");
  });

  it("reports already_present from the HTML marker alone", () => {
    const html = `<div>Hi</div><div class="gmail_signature">whatever</div>`;
    expect(signDraftRaw(enc(alt("Hi", html)), SIG).state).toBe("already_present");
  });

  it("adds an HTML part to a multipart draft that has none", () => {
    const draft = msg(
      "From: a@b.c",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain",
      "",
      "Hi",
      "--b1--",
      ""
    );
    const out = signDraftRaw(enc(draft), SIG);
    expect(out.state).toBe("applied");
    const parts = partBodies(out.raw!);
    expect(parts).toHaveLength(2);
    expect(parts[0].body).toBe("Hi");
    expect(parts[1].headers).toContain("text/html");
    expect(parts[1].body).toContain(SIG.html);
    expect(dec(out.raw!)).toContain("--b1--");
  });

  // SCRUM-279: a draft with files. Only the first part is signed; every file
  // after it is carried across byte for byte.
  const FILE_PART = ["--m1", "Content-Type: application/pdf; name=x.pdf", "Content-Transfer-Encoding: base64", "", "JVBERi0xLjQKJfbk/N8K", "--m1--", ""];

  it("signs the text first part of multipart/mixed and leaves the file's bytes untouched", async () => {
    const draft = msg("From: a@b.c", 'Content-Type: multipart/mixed; boundary="m1"', "", "--m1", "Content-Type: text/plain", "", "Hi", ...FILE_PART);
    const out = signDraftRaw(enc(draft), SIG);
    expect(out.state).toBe("applied");
    const text = dec(out.raw!);
    expect(text.slice(text.indexOf("--m1\r\nContent-Type: application/pdf"))).toBe(FILE_PART.join("\r\n"));
    const { simpleParser } = await import("mailparser");
    const mail = await simpleParser(Buffer.from(text));
    expect(mail.text?.trim()).toBe("Hi");
    expect(mail.html).toContain("Dana Rivers");
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0].content.equals(Buffer.from("JVBERi0xLjQKJfbk/N8K", "base64"))).toBe(true);
    // One MIME-Version, at the top: the promoted inner part carries none.
    expect(text.match(/MIME-Version/g) ?? []).toHaveLength(0);
  });

  it("signs mixed > related > alternative, the shape gmail_create_draft writes with an inline image and a file", async () => {
    const draft = msg(
      "From: a@b.c",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="m1"',
      "",
      "--m1",
      'Content-Type: multipart/related; boundary="r1"; type="multipart/alternative"',
      "",
      "--r1",
      'Content-Type: multipart/alternative; boundary="a1"',
      "",
      "--a1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hi",
      "--a1",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<p>Hi</p><img src="cid:c.png">',
      "--a1--",
      "",
      "--r1",
      "Content-Type: image/png; name=c.png",
      "Content-Transfer-Encoding: base64",
      "Content-ID: <c.png>",
      "",
      "iVBORw0K",
      "--r1--",
      "",
      ...FILE_PART
    );
    const out = signDraftRaw(enc(draft), SIG);
    expect(out.state).toBe("applied");
    const { simpleParser } = await import("mailparser");
    const mail = await simpleParser(Buffer.from(dec(out.raw!)));
    // The parser inlines a cid image as a data: URL; the order is what counts.
    expect(mail.html).toMatch(/<img src="data:image\/png[^"]*">.*Dana Rivers/s);
    expect(mail.attachments.map((a) => a.filename)).toEqual(["c.png", "x.pdf"]);
    expect(signDraftRaw(out.raw!, SIG).state).toBe("already_present");
  });

  it("a mixed draft already signed reports already_present", () => {
    const draft = msg("From: a@b.c", 'Content-Type: multipart/mixed; boundary="m1"', "", "--m1", "Content-Type: text/html", "", "x", ...FILE_PART);
    // text/html alone as the first part is not a shape this rewrites...
    expect(signDraftRaw(enc(draft), SIG).state).toBe("skipped_unsupported_draft");
    const signed = msg(
      "From: a@b.c",
      'Content-Type: multipart/mixed; boundary="m1"',
      "",
      "--m1",
      'Content-Type: multipart/alternative; boundary="a1"',
      "",
      "--a1",
      "Content-Type: text/plain",
      "",
      "Hi",
      "--a1",
      "Content-Type: text/html",
      "",
      `<p>Hi</p>${SIG.html}`,
      "--a1--",
      "",
      ...FILE_PART
    );
    // ...but the alternative shape is, and a signed one is left alone.
    expect(signDraftRaw(enc(signed), SIG).state).toBe("already_present");
  });

  it("refuses a mixed draft whose first part is itself a file", () => {
    const draft = msg("From: a@b.c", 'Content-Type: multipart/mixed; boundary="m1"', "", ...FILE_PART.slice(0, -2), ...FILE_PART);
    expect(signDraftRaw(enc(draft), SIG).state).toBe("skipped_unsupported_draft");
  });

  it("refuses nesting deeper than mixed > related > text", () => {
    const draft = msg(
      "From: a@b.c",
      'Content-Type: multipart/mixed; boundary="m1"',
      "",
      "--m1",
      'Content-Type: multipart/mixed; boundary="m2"',
      "",
      "--m2",
      "Content-Type: text/plain",
      "",
      "Hi",
      "--m2--",
      "",
      ...FILE_PART
    );
    expect(signDraftRaw(enc(draft), SIG).state).toBe("skipped_unsupported_draft");
  });

  it("a big file does not stop the signing, a big text part does", () => {
    const bigFile = "A".repeat(3 * 1024 * 1024);
    const draft = msg("From: a@b.c", 'Content-Type: multipart/mixed; boundary="m1"', "", "--m1", "Content-Type: text/plain", "", "Hi", "--m1", "Content-Type: application/pdf", "Content-Transfer-Encoding: base64", "", bigFile, "--m1--", "");
    expect(signDraftRaw(enc(draft), SIG).state).toBe("applied");
    const bigText = msg("From: a@b.c", 'Content-Type: multipart/mixed; boundary="m1"', "", "--m1", "Content-Type: text/plain", "", "x".repeat(1024 * 1024), ...FILE_PART);
    expect(signDraftRaw(enc(bigText), SIG).state).toBe("skipped_unsupported_draft");
    // And a plain text draft of the same size is still refused, as before.
    expect(signDraftRaw(enc(msg("From: a@b.c", "Content-Type: text/plain", "", bigFile)), SIG).state).toBe("skipped_unsupported_draft");
  });

  it("refuses a non-text part inside multipart/alternative", () => {
    const draft = msg(
      "From: a@b.c",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain",
      "",
      "Hi",
      "--b1",
      "Content-Type: image/png",
      "Content-Transfer-Encoding: base64",
      "",
      "AAAA",
      "--b1--",
      ""
    );
    expect(signDraftRaw(enc(draft), SIG).state).toBe("skipped_unsupported_draft");
  });

  it("refuses a nested multipart", () => {
    const draft = msg(
      "From: a@b.c",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain",
      "",
      "Hi",
      "--b1",
      'Content-Type: multipart/related; boundary="r1"',
      "",
      "--r1",
      "Content-Type: text/html",
      "",
      "<div>Hi</div>",
      "--r1--",
      "--b1--",
      ""
    );
    expect(signDraftRaw(enc(draft), SIG).state).toBe("skipped_unsupported_draft");
  });

  it("refuses multipart/alternative with no boundary parameter", () => {
    const draft = msg("From: a@b.c", "Content-Type: multipart/alternative", "", "Hi");
    expect(signDraftRaw(enc(draft), SIG).state).toBe("skipped_unsupported_draft");
  });
});

/* The whole message round-trips through a JS string, so anything that is not
 * valid UTF-8 would come back as replacement characters and corrupt parts the
 * signature never touches. Such a draft is left alone entirely. */
describe("a draft this code cannot round-trip is left alone", () => {
  it("refuses a part whose charset is not utf-8 or us-ascii", () => {
    const draft = msg(
      "From: a@b.c",
      "Content-Type: text/plain; charset=iso-8859-1",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Caf=E9 time"
    );
    expect(signDraftRaw(enc(draft), SIG).state).toBe("skipped_unsupported_draft");
  });

  it("refuses a multipart whose HTML part declares windows-1252", () => {
    const draft = msg(
      "From: a@b.c",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Hi",
      "--b1",
      'Content-Type: text/html; charset="windows-1252"',
      "",
      "<div>Hi</div>",
      "--b1--",
      ""
    );
    expect(signDraftRaw(enc(draft), SIG).state).toBe("skipped_unsupported_draft");
  });

  it("accepts an unstated charset, which defaults to us-ascii", () => {
    expect(signDraftRaw(enc(msg("From: a@b.c", "Content-Type: text/plain", "", "Hi")), SIG).state).toBe(
      "applied"
    );
  });

  it("refuses a message carrying a raw 8-bit byte that is not valid UTF-8", () => {
    const head = Buffer.from(
      msg("From: a@b.c", "Content-Type: text/plain; charset=UTF-8", "", "Caf"),
      "utf8"
    );
    // 0xE9 alone is latin-1 "é" and is not a valid UTF-8 sequence.
    const raw = Buffer.concat([head, Buffer.from([0xe9]), Buffer.from(" time", "utf8")]);
    expect(signDraftRaw(raw.toString("base64url"), SIG).state).toBe("skipped_unsupported_draft");
  });
});

/* A signature holding an accent or an emoji is not 7bit, and a long line
 * breaks the RFC line limit. Inserting it anyway makes invalid MIME that some
 * servers reject and others silently mangle. */
describe("a signature that does not fit the part's declared encoding", () => {
  const sevenBit = (html: string) =>
    msg(
      "From: a@b.c",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Hi",
      "--b1",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      html,
      "--b1--",
      ""
    );

  it("re-encodes a 7bit part as base64 when the signature holds an emoji", () => {
    const emojiSig = { html: "<div>Regards 🎉<div>Dana Rivers</div></div>", text: "Regards 🎉 Dana Rivers" };
    const out = signDraftRaw(enc(sevenBit("<div>Hi</div>")), emojiSig);
    expect(out.state).toBe("applied");
    const got = dec(out.raw!);
    expect(got).toContain("Content-Transfer-Encoding: base64");
    expect(got).not.toContain("Content-Transfer-Encoding: 7bit");
    // the emoji is not sitting raw in a 7bit part
    expect(got).not.toContain("🎉");
    const parts = partBodies(out.raw!);
    expect(parts[1].body).toContain("🎉");
    expect(parts[1].body).toContain("<div>Hi</div>");
    // the plain part is untouched
    expect(parts[0].body).toBe("Hi");
  });

  it("re-encodes when the signed body would exceed the line-length limit", () => {
    const longSig = { html: `<div>${"x".repeat(1200)}</div>`, text: "x".repeat(1200) };
    const got = dec(signDraftRaw(enc(sevenBit("<div>Hi</div>")), longSig).raw!);
    expect(got).toContain("Content-Transfer-Encoding: base64");
  });

  it("leaves the encoding alone when the signature does fit", () => {
    const got = dec(signDraftRaw(enc(sevenBit("<div>Hi</div>")), SIG).raw!);
    expect(got).toContain("Content-Transfer-Encoding: 7bit");
    expect(got).not.toContain("Content-Transfer-Encoding: base64");
  });
});

describe("the promoted draft's headers", () => {
  it("does not duplicate MIME-Version when the draft already had one", () => {
    const draft = msg(
      "From: a@b.c",
      "MIME-Version: 1.0",
      "To: d@e.f",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Hi"
    );
    const got = dec(signDraftRaw(enc(draft), SIG).raw!);
    const headers = got.slice(0, got.indexOf("\r\n\r\n"));
    expect(headers.match(/^MIME-Version:/gim)).toHaveLength(1);
  });

  it("carries a folded header through intact", () => {
    const draft = msg(
      "From: a@b.c",
      "Subject: a subject that was",
      " folded onto a second line",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Hi"
    );
    const got = dec(signDraftRaw(enc(draft), SIG).raw!);
    expect(got).toContain("Subject: a subject that was\r\n folded onto a second line");
  });
});

/* Proving the OUTER message is UTF-8 is not enough: a base64 or
 * quoted-printable part carries its own bytes and decodes independently, so
 * each part proves its own round trip. Without this a part holding, say, a
 * UTF-16 BOM comes back as replacement characters and ships as `applied`. */
describe("a part whose own decoded bytes are not UTF-8", () => {
  const withBase64Html = (payload: Buffer) =>
    msg(
      "From: a@b.c",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Hi",
      "--b1",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      payload.toString("base64"),
      "--b1--",
      ""
    );

  it("is left alone rather than mangled", () => {
    // 0xff 0xfe is a UTF-16 BOM: valid bytes, not valid UTF-8.
    const payload = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<div>Hi</div>", "utf8")]);
    expect(signDraftRaw(enc(withBase64Html(payload)), SIG).state).toBe("skipped_unsupported_draft");
  });

  it("still signs a base64 part whose bytes ARE valid UTF-8", () => {
    const out = signDraftRaw(enc(withBase64Html(Buffer.from("<div>Café</div>", "utf8"))), SIG);
    expect(out.state).toBe("applied");
    expect(partBodies(out.raw!)[1].body).toContain("Café");
  });

  it("is left alone when a quoted-printable part decodes to non-UTF-8 bytes", () => {
    const draft = msg(
      "From: a@b.c",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Caf=E9 time"
    );
    expect(signDraftRaw(enc(draft), SIG).state).toBe("skipped_unsupported_draft");
  });
});

describe("encoding validity is measured in bytes and parsed strictly", () => {
  const part = (cte: string, html: string, ct = "text/html; charset=UTF-8") =>
    msg(
      "From: a@b.c",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Hi",
      "--b1",
      `Content-Type: ${ct}`,
      `Content-Transfer-Encoding: ${cte}`,
      "",
      html,
      "--b1--",
      ""
    );

  it("counts a line's BYTES, so multi-byte characters cannot smuggle it over the limit", () => {
    // 400 emoji is 800 UTF-16 units but 1600 bytes, over the 998 limit.
    const emojiSig = { html: `<div>${"🎉".repeat(400)}</div>`, text: "🎉" };
    const got = dec(signDraftRaw(enc(part("8bit", "<div>Hi</div>")), emojiSig).raw!);
    expect(got).toContain("Content-Transfer-Encoding: base64");
  });

  it("refuses an RFC 2231 charset continuation rather than reading it as unstated", () => {
    expect(
      signDraftRaw(enc(part("7bit", "<div>Hi</div>", "text/html; charset*=UTF-8''iso-8859-1")), SIG)
        .state
    ).toBe("skipped_unsupported_draft");
  });
});

describe("boundary matching", () => {
  it("does not treat a body line that merely starts with the boundary as a delimiter", () => {
    const draft = msg(
      "From: a@b.c",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "line one",
      "--b1EXTRA is not a delimiter",
      "line three",
      "--b1",
      "Content-Type: text/html; charset=UTF-8",
      "",
      "<div>Hi</div>",
      "--b1--",
      ""
    );
    const out = signDraftRaw(enc(draft), SIG);
    expect(out.state).toBe("applied");
    // Asserted on the raw message, not via partBodies: that helper splits
    // naively on the boundary and would itself be fooled by this line, which
    // is the very confusion under test.
    const got = dec(out.raw!);
    expect(got).toContain("line one\r\n--b1EXTRA is not a delimiter\r\nline three");
    // the signature landed at the end of the HTML part, not mid-body
    expect(got.indexOf("gmail_signature")).toBeGreaterThan(got.indexOf("<div>Hi</div>"));
  });
});
