import { describe, expect, it } from "vitest";
import {
  addressOnly,
  buildReplyBodies,
  derivePlain,
  escapeHtml,
  forwardPlainBlock,
  forwardSubject,
  htmlAttributionDate,
  htmlQuoteBlock,
  originalPlainText,
  plainAttribution,
  quotePlain,
  replySubject,
  threadHeaders,
  type OriginalMessage,
} from "./gmail-reply.js";

/** The original the gws CLI synthesises in `+reply --dry-run`, so the
 * expectations below can be the CLI's own output byte-for-byte. */
const CLI_ORIGINAL: OriginalMessage = {
  from: "sender@example.com",
  date: "Thu, 1 Jan 2026 00:00:00 +0000",
  subject: "Original subject",
  messageId: "<ABC@example.com>",
  html: "<p>Original message body</p>",
  plain: "Original message body",
};

describe("matching the CLI's composer", () => {
  it("reproduces the CLI's plain attribution line exactly", () => {
    expect(plainAttribution(CLI_ORIGINAL.date, CLI_ORIGINAL.from)).toBe(
      "On Thu, 1 Jan 2026 00:00:00 +0000, sender@example.com wrote:"
    );
  });

  it("reproduces the CLI's HTML attribution date exactly", () => {
    // The CLI writes `Thu, Jan 1, 2026 at 12:00 AM` with a NARROW NO-BREAK
    // SPACE (U+202F) before AM, which is what Intl emits for en-US.
    expect(htmlAttributionDate(CLI_ORIGINAL.date)).toBe(
      "Thu, Jan 1, 2026 at 12:00 AM"
    );
  });

  it("reproduces the CLI's HTML quote block exactly", () => {
    expect(htmlQuoteBlock(CLI_ORIGINAL, "<p>Original message body</p>")).toBe(
      '<div class="gmail_quote gmail_quote_container">' +
        '<div dir="ltr" class="gmail_attr">On Thu, Jan 1, 2026 at 12:00 AM, ' +
        '<a href="mailto:sender@example.com">sender@example.com</a> wrote:<br></div>' +
        '<blockquote class="gmail_quote" style="margin:0 0 0 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">' +
        '<div dir="ltr"><p>Original message body</p></div>' +
        "</blockquote></div>"
    );
  });

  it("reproduces the CLI's plain quoted body exactly", () => {
    expect(quotePlain("Original message body")).toBe("> Original message body");
  });
});

describe("the signature sits above the quote", () => {
  const signed = "Reply text<br clear=\"all\"><br clear=\"all\"><div><div class=\"gmail_signature\">SIG</div></div>";

  it("puts the whole signed body, signature included, before the quote", () => {
    const { html } = buildReplyBodies(CLI_ORIGINAL, "Reply text", signed);
    expect(html.indexOf("gmail_signature")).toBeLessThan(html.indexOf("gmail_quote"));
  });

  it("never lets the signature reach the plain part", () => {
    const { plain } = buildReplyBodies(CLI_ORIGINAL, "Reply text", signed);
    expect(plain).not.toContain("gmail_signature");
    expect(plain).not.toContain("SIG");
    expect(plain.startsWith("Reply text\n\nOn Thu, 1 Jan 2026")).toBe(true);
  });

  it("builds BOTH parts, which is the whole point of the change", () => {
    const { plain, html } = buildReplyBodies(CLI_ORIGINAL, "Reply text", signed);
    expect(plain.length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(0);
  });
});

describe("the plain quote's source", () => {
  it("prefers the original's own text/plain part over flattening its HTML", () => {
    // The HTML here would flatten to something different, so a pass proves the
    // plain part was preferred rather than that both happen to agree.
    const differing = { ...CLI_ORIGINAL, html: "<p>NOT THIS</p>" };
    expect(originalPlainText(differing)).toBe("Original message body");
  });

  it("flattens the HTML only when there is no plain part", () => {
    const noPlain = { ...CLI_ORIGINAL, plain: undefined, html: "<p>from the markup</p>" };
    expect(originalPlainText(noPlain)).toBe("from the markup");
  });

  it("BOUNDS what it flattens, because the original is inbound mail", () => {
    // The bound now lives in derivePlain, which owns it for every path that
    // has to derive a plain body. Asserted on the OUTPUT rather than on a
    // spy's input, so it holds wherever the slicing happens.
    const huge = "x".repeat(2 * 1024 * 1024);
    const out = derivePlain(huge);
    expect(out.length).toBeLessThan(huge.length);
    expect(out).toContain("[truncated]");
  });

  it("does NOT truncate a body inside the bound", () => {
    // Without this the test above passes on a derivePlain that truncates
    // everything.
    const small = "hello world";
    expect(derivePlain(small)).toBe("hello world");
  });
});

describe("headers", () => {
  it("does not double a Re: prefix", () => {
    expect(replySubject("Re: Original subject")).toBe("Re: Original subject");
    expect(replySubject("Original subject")).toBe("Re: Original subject");
  });

  it("does not double a Fwd: prefix", () => {
    expect(forwardSubject("Fwd: x")).toBe("Fwd: x");
    expect(forwardSubject("x")).toBe("Fwd: x");
  });

  it("accumulates References and points In-Reply-To at the parent", () => {
    expect(threadHeaders({ ...CLI_ORIGINAL, references: "<older@x>" })).toEqual([
      "In-Reply-To: <ABC@example.com>",
      "References: <older@x> <ABC@example.com>",
    ]);
  });

  it("emits NO thread headers when the original had no Message-ID", () => {
    // An empty In-Reply-To is worse than none: it breaks threading outright.
    expect(threadHeaders({ ...CLI_ORIGINAL, messageId: "" })).toEqual([]);
  });

  it("takes the bare address out of a display-name From", () => {
    expect(addressOnly("Manuel Yang <m@x.com>")).toBe("m@x.com");
    expect(addressOnly("m@x.com")).toBe("m@x.com");
  });
});

describe("escaping", () => {
  it("escapes a plain original before it becomes HTML", () => {
    const noHtml: OriginalMessage = { ...CLI_ORIGINAL, html: undefined, plain: "a <b> & \"c\"" };
    const { html } = buildReplyBodies(noHtml, "hi", "hi");
    expect(html).toContain("a &lt;b&gt; &amp; &quot;c&quot;");
    expect(html).not.toContain("<b>");
  });

  it("escapes an address before putting it in the mailto", () => {
    expect(escapeHtml('a"b<c')).toBe("a&quot;b&lt;c");
  });
});

describe("the forwarded block", () => {
  it("carries the original's own headers, which is what makes a forward a forward", () => {
    expect(forwardPlainBlock(CLI_ORIGINAL, "you@example.com", "Original message body")).toBe(
      [
        "---------- Forwarded message ---------",
        "From: sender@example.com",
        "Date: Thu, 1 Jan 2026 00:00:00 +0000",
        "Subject: Original subject",
        "To: you@example.com",
        "",
        "Original message body",
      ].join("\n")
    );
  });
});

describe("header injection from the inbound original (attacker-controlled)", () => {
  // Every value below is copied out of a message SOMEONE ELSE sent us. A CRLF
  // in any of them would inject a header into the reply we send — a silent Bcc
  // is the worst case, exfiltrating the user's own reply.
  const evil = (over: Partial<OriginalMessage>): OriginalMessage => ({
    ...CLI_ORIGINAL,
    ...over,
  });

  it("strips CRLF out of a Message-ID before it becomes a header", () => {
    const h = threadHeaders(
      evil({ messageId: "<x@y>\r\nBcc: attacker@evil.example" })
    );
    // Each header must be ONE line. Joining them and looking for \n cannot
    // work — the join supplies it — so every element is checked on its own.
    for (const line of h) expect(line).not.toMatch(/[\r\n]/);
    // The address survives only as junk INSIDE a value, never as its own
    // header, which is what makes it harmless.
    expect(h.some((l) => /^Bcc:/i.test(l))).toBe(false);
  });

  it("strips CRLF out of References", () => {
    const h = threadHeaders(
      evil({ references: "<a@b>\r\nBcc: attacker@evil.example" })
    );
    for (const line of h) expect(line).not.toMatch(/[\r\n]/);
    expect(h.some((l) => /^Bcc:/i.test(l))).toBe(false);
  });

  it("strips a bare LF too, not just CRLF", () => {
    // Gmail's own writer folds with CRLF, but a lone LF still starts a new
    // header line for most parsers, so testing only \r\n would prove nothing.
    const h = threadHeaders(evil({ messageId: "<x@y>\nBcc: a@b.c" }));
    for (const line of h) expect(line).not.toMatch(/[\r\n]/);
    expect(h.some((l) => /^Bcc:/i.test(l))).toBe(false);
  });

  it("strips CRLF out of the subject a reply derives", () => {
    expect(replySubject("hi\r\nBcc: attacker@evil.example")).not.toMatch(/[\r\n]/);
    expect(forwardSubject("hi\r\nBcc: attacker@evil.example")).not.toMatch(/[\r\n]/);
  });

  it("strips CRLF out of the address a reply is addressed to", () => {
    expect(addressOnly("Name <a@b.c>\r\nBcc: attacker@evil.example")).not.toMatch(/[\r\n]/);
  });

  it("keeps the sanitised value USABLE rather than emptying it", () => {
    // Failing closed to an empty To or Subject would be its own bug.
    expect(addressOnly("Name <a@b.c>\r\nx")).toContain("a@b.c");
    expect(replySubject("real subject\r\nx")).toContain("real subject");
  });
});
