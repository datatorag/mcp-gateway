import { describe, expect, it } from "vitest";
import { fakeClient } from "./fake-client.test-helper.js";
import {
  appendHtmlSignature,
  applySignature,
  insertBeforeHtmlQuote,
  lookupSignature,
  plainToHtml,
  signaturePresentInHtml,
} from "./gmail-signature.js";

/** Fixed fixtures. NEVER the live signature: the account's real one changes
 * whenever someone edits it, and a test that read it would break for reasons
 * that have nothing to do with this code. */
const SIG = '<div dir="ltr">Regards,<div>Dana Rivers</div></div>';
const SIG_TEXT = "Regards, Dana Rivers";

/** A signature with a hosted image, the shape Gmail stores when a logo is
 * added. Nothing converts it; it travels as-is. */
const IMG_SIG =
  '<div dir="ltr">Dana Rivers<br><div><img width="96" height="96" ' +
  'src="https://img.example.com/mail-sig/abc123"></div></div>';

const sendAsList = (entries: unknown[]) => ({ sendAs: entries });

describe("plainToHtml", () => {
  it("escapes markup characters and maps newlines to <br>", () => {
    expect(plainToHtml("a < b & c\nsecond")).toBe("a &lt; b &amp; c<br>second");
  });
});

describe("appendHtmlSignature", () => {
  it("wraps the stored markup in Gmail's signature container, byte-identical", () => {
    const out = appendHtmlSignature("<p>Hi</p>", SIG);
    expect(out).toContain('class="gmail_signature"');
    expect(out).toContain('data-smartmail="gmail_signature"');
    expect(out).toContain(SIG);
    expect(out).toContain('<br clear="all"><br clear="all">');
    expect(out.indexOf("<p>Hi</p>")).toBeLessThan(out.indexOf("gmail_signature"));
  });

  it("passes an image signature through untouched", () => {
    expect(appendHtmlSignature("<p>Hi</p>", IMG_SIG)).toContain(IMG_SIG);
  });

  it("adds no -- line", () => {
    expect(appendHtmlSignature("<p>Hi</p>", SIG)).not.toMatch(/^--\s*$/m);
  });

  it("inserts before </body> when the body is a full document", () => {
    const out = appendHtmlSignature("<html><body><p>Hi</p></body></html>", SIG);
    expect(out.indexOf("gmail_signature")).toBeLessThan(out.indexOf("</body>"));
    expect(out.endsWith("</body></html>")).toBe(true);
  });
});

describe("already-present detection, on the HTML part", () => {
  it("treats a gmail_signature marker as present", () => {
    expect(signaturePresentInHtml(`<p>Hi</p><div class="gmail_signature">x</div>`, SIG_TEXT)).toBe(
      true
    );
  });

  it("treats a data-smartmail marker alone as present", () => {
    expect(
      signaturePresentInHtml(`<p>Hi</p><div data-smartmail="gmail_signature">x</div>`, SIG_TEXT)
    ).toBe(true);
  });

  it("finds an unmarked signature at the end of the body", () => {
    expect(signaturePresentInHtml(`<p>Hi</p>${SIG}`, SIG_TEXT)).toBe(true);
  });

  it("does NOT match the signature text mid-body", () => {
    expect(
      signaturePresentInHtml(`<p>Regards, Dana Rivers wrote the patch</p><p>thanks</p>`, SIG_TEXT)
    ).toBe(false);
  });

  it("does not match a near miss", () => {
    expect(signaturePresentInHtml("<p>Hi</p><div>Regards,<div>Dana</div></div>", SIG_TEXT)).toBe(
      false
    );
  });

  it("looks before a gmail_quote block, so a quoted signature does not count", () => {
    expect(
      signaturePresentInHtml(
        `<p>Hi</p><div class="gmail_quote"><p>earlier</p>${SIG}</div>`,
        SIG_TEXT
      )
    ).toBe(false);
  });

  it("falls back to the marker alone when the signature carries no text", () => {
    expect(signaturePresentInHtml("<p>Hi</p>", "")).toBe(false);
    expect(signaturePresentInHtml('<p>Hi</p><div class="gmail_signature"><img></div>', "")).toBe(
      true
    );
  });
});

describe("the quoted-original search", () => {
  /** MANY unclosed starts, not one. A single "<div " followed by filler costs
   * nothing even under a quadratic form — the cost comes from every start
   * re-scanning the rest of the body, so the number of starts is the lever. */
  const unclosed = (kb: number) => "<div ".repeat(Math.ceil((kb * 1024) / 5));

  it("puts the signature above a gmail_quote block", () => {
    const out = insertBeforeHtmlQuote(`<p>Hi</p><div class="gmail_quote">earlier</div>`, SIG);
    expect(out).toBeDefined();
    expect(out!.indexOf("gmail_signature")).toBeLessThan(out!.indexOf("gmail_quote"));
  });

  it("finds the blockquote form too", () => {
    expect(
      insertBeforeHtmlQuote(`<p>Hi</p><blockquote class="gmail_quote">old</blockquote>`, SIG)
    ).toBeDefined();
  });

  it("reports no anchor rather than guessing", () => {
    expect(insertBeforeHtmlQuote("<p>Hi</p>", SIG)).toBeUndefined();
  });

  it("does not treat the bare token outside a tag as a quote", () => {
    expect(insertBeforeHtmlQuote("<p>talking about gmail_quote here</p>", SIG)).toBeUndefined();
  });

  it("does not treat some other element carrying the class as a quote", () => {
    expect(insertBeforeHtmlQuote(`<span class="gmail_quote">old</span>`, SIG)).toBeUndefined();
  });

  // Sized so a quadratic form reddens the case in seconds rather than
  // minutes, which keeps the mutation runnable. It was once also the largest
  // body that could arrive; nothing caps that now, and the send-path test in
  // gmail-send.test.ts covers megabytes.
  it("does not stall on a large body whose tags never close", () => {
    const started = Date.now();
    expect(insertBeforeHtmlQuote(unclosed(128), SIG)).toBeUndefined();
    expect(signaturePresentInHtml(unclosed(128), SIG_TEXT)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("does not stall on a large body full of the token with no tags at all", () => {
    const started = Date.now();
    expect(signaturePresentInHtml("gmail_quote ".repeat(11_000), SIG_TEXT)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("lookupSignature", () => {
  it("reads the isDefault entry", async () => {
    const { client, calls } = fakeClient([
      {
        data: sendAsList([
          { sendAsEmail: "other@example.com", isDefault: false, signature: "<p>wrong</p>" },
          { sendAsEmail: "sender@example.com", isDefault: true, signature: SIG },
        ]),
      },
    ]);
    const got = await lookupSignature(client);
    expect(calls[0]).toMatchObject({
      service: "gmail",
      resource: "users.settings.sendAs",
      method: "list",
      params: { userId: "me" },
    });
    expect(got).toMatchObject({ ok: true, html: SIG });
  });

  it("prefers the entry matching a given From address, case-insensitively", async () => {
    const { client } = fakeClient([
      {
        data: sendAsList([
          { sendAsEmail: "sender@example.com", isDefault: true, signature: SIG },
          { sendAsEmail: "alias@example.com", isDefault: false, signature: "<p>alias</p>" },
        ]),
      },
    ]);
    expect(await lookupSignature(client, "Alias <ALIAS@example.com>")).toMatchObject({
      ok: true,
      html: "<p>alias</p>",
    });
  });

  it("falls back to the default when the From address has no entry", async () => {
    const { client } = fakeClient([
      {
        data: sendAsList([
          { sendAsEmail: "sender@example.com", isDefault: true, signature: SIG },
        ]),
      },
    ]);
    expect(await lookupSignature(client, "nobody@example.com")).toMatchObject({
      ok: true,
      html: SIG,
    });
  });

  it("reports none_set for an empty signature", async () => {
    const { client } = fakeClient([
      { data: sendAsList([{ sendAsEmail: "a@b.c", isDefault: true, signature: "" }]) },
    ]);
    expect(await lookupSignature(client)).toEqual({ ok: false, state: "none_set" });
  });

  it("reports none_set when the entry has no signature field at all", async () => {
    const { client } = fakeClient([
      { data: sendAsList([{ sendAsEmail: "a@b.c", isDefault: true }]) },
    ]);
    expect(await lookupSignature(client)).toEqual({ ok: false, state: "none_set" });
  });

  it("reports unavailable rather than throwing when the lookup fails", async () => {
    const { client } = fakeClient([{ throws: "API error: 500" }]);
    expect(await lookupSignature(client)).toEqual({ ok: false, state: "unavailable" });
  });

  it("reports unavailable on an empty sendAs list", async () => {
    const { client } = fakeClient([{ data: sendAsList([]) }]);
    expect(await lookupSignature(client)).toEqual({ ok: false, state: "unavailable" });
  });
});

describe("applySignature puts the signature in the HTML part ONLY", () => {
  const withSig = (signature = SIG) =>
    fakeClient([{ data: sendAsList([{ isDefault: true, signature }]) }]);

  it("makes no sendAs call when signature is false", async () => {
    const { client, calls } = withSig();
    expect(await applySignature(client, { signature: false }, { body: "Hi" })).toEqual({
      body: "Hi",
      state: "suppressed",
    });
    expect(calls).toHaveLength(0);
  });

  it("promotes a plain-only body and leaves the PLAIN part unsigned", async () => {
    const { client } = withSig();
    const got = await applySignature(client, {}, { body: "Hi <there> & all" });
    expect(got.state).toBe("applied");
    // the plain part is the caller's body, untouched
    expect(got.body).toBe("Hi <there> & all");
    expect(got.html).toContain("Hi &lt;there&gt; &amp; all");
    expect(got.html).toContain(SIG);
    expect(got.html).toContain('class="gmail_signature"');
  });

  it("signs the html part and leaves a caller-given plain body alone", async () => {
    const { client } = withSig();
    const got = await applySignature(client, {}, { body: "plain", html: "<p>rich</p>" });
    expect(got.state).toBe("applied");
    expect(got.body).toBe("plain");
    expect(got.html).toContain("<p>rich</p>");
    expect(got.html).toContain(SIG);
  });

  it("carries the UNSIGNED markup for whoever builds a plain fallback", async () => {
    const { client } = withSig();
    const got = await applySignature(client, {}, { html: "<p>rich</p>" });
    expect(got.state).toBe("applied");
    // not derived here: the paths with one body slot have no plain part, and
    // flattening is superlinear on adversarial markup, so the work would be
    // thrown away on those paths while stalling every session on the loop
    expect(got.body).toBeUndefined();
    expect(got.unsignedHtml).toBe("<p>rich</p>");
    expect(got.unsignedHtml).not.toContain("Dana Rivers");
    expect(got.html).toContain(SIG);
  });

  it("carries an image signature into the HTML part byte-identical", async () => {
    const { client } = withSig(IMG_SIG);
    const got = await applySignature(client, {}, { body: "Hi" });
    expect(got.html).toContain(IMG_SIG);
    expect(got.body).toBe("Hi");
  });

  it("leaves the bodies untouched and reports the state when nothing is set", async () => {
    const { client } = fakeClient([{ data: sendAsList([{ isDefault: true, signature: "" }]) }]);
    expect(await applySignature(client, {}, { body: "Hi" })).toEqual({
      body: "Hi",
      state: "none_set",
    });
  });

  it("leaves the bodies untouched when the lookup is unavailable", async () => {
    const { client } = fakeClient([{ throws: "boom" }]);
    expect(await applySignature(client, {}, { body: "Hi" })).toEqual({
      body: "Hi",
      state: "unavailable",
    });
  });

  it("does not append twice", async () => {
    const { client } = withSig();
    const already = `<p>Hi</p><div class="gmail_signature">${SIG}</div>`;
    expect(await applySignature(client, {}, { html: already })).toEqual({
      html: already,
      state: "already_present",
    });
  });
});

/* A quoted earlier message routinely carries its own signature block. If the
 * marker test looked at the whole body, every reply to a signed thread would
 * read as already signed and go out bare — the most common real send there
 * is. Both checks therefore run above the quote. */
describe("a signature inside the quote is not this message's signature", () => {
  const QUOTED_SIGNED =
    `<div>my reply</div>` +
    `<div class="gmail_quote"><div>earlier</div>` +
    `<div class="gmail_signature">${SIG}</div></div>`;

  it("does not read a marker inside the quote as already present", () => {
    expect(signaturePresentInHtml(QUOTED_SIGNED, SIG_TEXT)).toBe(false);
  });

  it("does not read the bare data-smartmail form inside the quote either", () => {
    const html =
      `<div>my reply</div><div class="gmail_quote">` +
      `<div data-smartmail="gmail_signature">${SIG}</div></div>`;
    expect(signaturePresentInHtml(html, SIG_TEXT)).toBe(false);
  });

  it("still reads a marker ABOVE the quote as already present", () => {
    const html =
      `<div>my reply</div><div class="gmail_signature">${SIG}</div>` +
      `<div class="gmail_quote">earlier</div>`;
    expect(signaturePresentInHtml(html, SIG_TEXT)).toBe(true);
  });

  it("signs such a reply, above the quote", () => {
    const out = insertBeforeHtmlQuote(QUOTED_SIGNED, SIG);
    expect(out).toBeDefined();
    expect(out!.indexOf("gmail_signature")).toBeLessThan(out!.indexOf("gmail_quote"));
  });
});

describe("suppression is read generously", () => {
  const withSig = () => fakeClient([{ data: sendAsList([{ isDefault: true, signature: SIG }]) }]);

  it("honours a stringy false from a loose client", async () => {
    const { client, calls } = withSig();
    const got = await applySignature(client, { signature: "false" }, { body: "Hi" });
    expect(got).toEqual({ body: "Hi", state: "suppressed" });
    expect(calls).toHaveLength(0);
  });

  it("still applies for anything else, including a stringy true", async () => {
    const { client } = withSig();
    expect((await applySignature(client, { signature: "true" }, { body: "Hi" })).state).toBe(
      "applied"
    );
  });

  it("does not throw when both bodies are absent", async () => {
    const { client } = withSig();
    const got = await applySignature(client, {}, {});
    expect(got.state).toBe("applied");
    expect(got.html).toContain(SIG);
  });
});

describe("the plain fallback's source is safe on every applied path", () => {
  const withSig = () => fakeClient([{ data: sendAsList([{ isDefault: true, signature: SIG }]) }]);

  /* Whoever builds a plain part derives it from unsignedHtml. That is only
   * safe if unsignedHtml is set wherever html is signed — otherwise the
   * fallback silently reaches for the SIGNED markup. Pinned here rather than
   * left to depend on a caller two functions away always supplying a body. */
  it("sets unsignedHtml whenever a signature is applied, promotion included", async () => {
    const fromHtml = await applySignature((await withSig()).client, {}, { html: "<p>rich</p>" });
    expect(fromHtml.state).toBe("applied");
    expect(fromHtml.unsignedHtml).toBeDefined();
    expect(fromHtml.unsignedHtml).not.toContain("Dana Rivers");

    const promoted = await applySignature((await withSig()).client, {}, { body: "just plain" });
    expect(promoted.state).toBe("applied");
    expect(promoted.unsignedHtml).toBeDefined();
    expect(promoted.unsignedHtml).toContain("just plain");
    expect(promoted.unsignedHtml).not.toContain("Dana Rivers");
  });
});
