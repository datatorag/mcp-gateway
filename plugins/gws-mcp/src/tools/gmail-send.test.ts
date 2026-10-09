import { describe, expect, it } from "vitest";
import { handleGmail, renderHeaders } from "./gmail.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";

/** Decode the base64url raw MIME a compose call emitted. These tests assert
 * the EMITTED REQUEST, not the response: the bug they pin was a success
 * response wrapping a message whose Content-Type contradicted its body. */
function rawMime(call: Record<string, unknown>): string {
  const jsonBody = call.jsonBody as {
    raw?: string;
    message?: { raw?: string };
  };
  const raw = jsonBody.raw ?? jsonBody.message?.raw;
  if (!raw) throw new Error("call carried no raw MIME");
  return Buffer.from(raw, "base64url").toString("utf-8");
}

/** Split a multipart/alternative MIME string into its boundary and parts. */
function parseMultipart(mime: string) {
  const boundary = /boundary="([^"]+)"/.exec(mime)?.[1];
  if (!boundary) throw new Error("no multipart boundary in message");
  expect(mime).toContain(`--${boundary}--`); // closing delimiter
  const parts = mime
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((p) => p.replace(/^\r\n/, ""));
  return { boundary, parts };
}

/** Every tool that writes or sends a message resolves the signature before
 * it composes anything (SCRUM-278 for the send tools, SCRUM-291 for the draft
 * tools), so its plan leads with a sendAs.list step and the composed call
 * lands at calls[1].
 * These cases assert the UNSIGNED shape, so the account has no signature —
 * which is also the property "a plain send with no signature is byte-identical
 * to before" is made of. */
const NO_SIG = { data: { sendAs: [{ isDefault: true, signature: "" }] } };


/** The original every reply and forward now READS before composing. The CLI
 * helper used to do this fetch inside the binary; owning it is what makes a
 * multipart/alternative reply possible, and it costs one extra API call. */
const ORIGINAL = {
  data: {
    id: "m1",
    threadId: "t1",
    payload: {
      headers: [
        { name: "From", value: "Sender Name <sender@example.com>" },
        { name: "Date", value: "Thu, 1 Jan 2026 00:00:00 +0000" },
        { name: "Subject", value: "Original subject" },
        { name: "Message-ID", value: "<ABC@example.com>" },
      ],
      mimeType: "text/plain",
      body: { data: Buffer.from("Original message body").toString("base64url") },
    },
  },
};

describe("plain-text compose (unchanged shape)", () => {
  it("gmail_create_draft with body only emits single-part text/plain", async () => {
    const { client, calls } = fakeClient([
      NO_SIG,
      { data: { id: "d1", message: { id: "m1" } } },
    ]);
    await handleGmail(client, "gmail_create_draft", {
      to: "a@example.com",
      subject: "Hi",
      body: "plain words",
    });

    const mime = rawMime(calls[1]);
    expect(mime).toContain("Content-Type: text/plain; charset=utf-8");
    expect(mime).not.toContain("multipart/alternative");
    expect(mime).toContain("plain words");
  });

  it("gmail_send with body only now sends raw MIME, NOT the CLI helper", async () => {
    const { client, calls } = fakeClient([NO_SIG, { data: { id: "m1" } }]);
    await handleGmail(client, "gmail_send", {
      to: "a@example.com",
      subject: "Hi",
      body: "plain words",
    });

    expect(calls[1]).toMatchObject({ service: "gmail", resource: "users.messages", method: "send" });
    // The helper is gone from every send path, so no call may carry a command.
    expect(calls.every((c) => c.command === undefined)).toBe(true);
    const mime = rawMime(calls[1]);
    expect(mime).toContain("Content-Type: text/plain; charset=utf-8");
    expect(mime).toContain("plain words");
  });
});

describe("html_body composes multipart/alternative", () => {
  it("gmail_send with html_body sends raw MIME via the API, not the helper", async () => {
    const { client, calls } = fakeClient([NO_SIG, { data: { id: "m1" } }]);
    await handleGmail(client, "gmail_send", {
      to: "a@example.com",
      subject: "Hi",
      body: "fallback text",
      html_body: "<p>Hello <b>world</b></p>",
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      service: "gmail",
      resource: "users.messages",
      method: "send",
      params: { userId: "me" },
    });

    const mime = rawMime(calls[1]);
    expect(mime).toContain("MIME-Version: 1.0");
    expect(mime).toContain("To: a@example.com");

    const { parts } = parseMultipart(mime);
    expect(parts).toHaveLength(2);
    // Plain part FIRST, html LAST: clients prefer the last renderable part.
    expect(parts[0]).toContain("Content-Type: text/plain; charset=utf-8");
    expect(parts[0]).toContain("fallback text");
    expect(parts[1]).toContain("Content-Type: text/html; charset=utf-8");
    expect(parts[1]).toContain("<p>Hello <b>world</b></p>");
  });

  it("derives the plain fallback from the HTML when body is absent", async () => {
    const { client, calls } = fakeClient([
      NO_SIG,
      { data: { id: "d1", message: { id: "m1" } } },
    ]);
    await handleGmail(client, "gmail_create_draft", {
      to: "a@example.com",
      subject: "Hi",
      html_body: "<p>Hello <b>world</b></p>",
    });

    const { parts } = parseMultipart(rawMime(calls[1]));
    const plainBody = parts[0].split("\r\n\r\n")[1];
    expect(plainBody).toContain("Hello world");
    expect(plainBody).not.toContain("<b>"); // never raw markup in the fallback
  });

  it("gmail_update_draft carries html_body through the same builder", async () => {
    const { client, calls } = fakeClient([NO_SIG, { data: { id: "d1" } }]);
    await handleGmail(client, "gmail_update_draft", {
      draft_id: "d1",
      thread_id: "t1",
      to: "a@example.com",
      subject: "Hi",
      html_body: "<i>updated</i>",
    });

    const mime = rawMime(calls[1]);
    expect(mime).toContain("multipart/alternative");
    expect(mime).toContain("<i>updated</i>");
    expect((calls[1].jsonBody as { message: { threadId?: string } }).message.threadId).toBe("t1");
  });
});

describe("reply and forward compose multipart/alternative themselves", () => {
  it("gmail_reply ALWAYS builds both parts, which the CLI helper could not", async () => {
    const { client, calls } = fakeClient([NO_SIG, ORIGINAL, { data: { id: "m2" } }]);
    await handleGmail(client, "gmail_reply", {
      message_id: "m1",
      html_body: "<b>Bold reply</b>",
    });

    const mime = rawMime(calls[2]);
    expect(mime).toContain("multipart/alternative");
    expect(mime).toContain("Content-Type: text/plain; charset=utf-8");
    expect(mime).toContain("Content-Type: text/html; charset=utf-8");
    expect(mime).toContain("<b>Bold reply</b>");
  });

  it("gmail_reply with a PLAIN body keeps its text/plain part", async () => {
    // The whole reason for this refactor: the helper turned a signed plain
    // reply into single-part text/html and the plain alternative vanished.
    const { client, calls } = fakeClient([NO_SIG, ORIGINAL, { data: { id: "m2" } }]);
    await handleGmail(client, "gmail_reply", { message_id: "m1", body: "plain reply" });

    const mime = rawMime(calls[2]);
    expect(mime).toContain("multipart/alternative");
    const plainPart = mime.split("Content-Type: text/html")[0];
    expect(plainPart).toContain("plain reply");
  });

  it("gmail_reply threads by In-Reply-To, References AND threadId", async () => {
    const { client, calls } = fakeClient([NO_SIG, ORIGINAL, { data: { id: "m2" } }]);
    await handleGmail(client, "gmail_reply", { message_id: "m1", body: "x" });

    const mime = rawMime(calls[2]);
    expect(mime).toContain("In-Reply-To: <ABC@example.com>");
    expect(mime).toContain("References: <ABC@example.com>");
    expect(mime).toContain("Subject: Re: Original subject");
    // Replying to a display-name From must address the BARE address.
    expect(mime).toContain("To: sender@example.com");
    expect((calls[2].jsonBody as { threadId?: string }).threadId).toBe("t1");
  });

  it("gmail_reply quotes the original in BOTH parts", async () => {
    const { client, calls } = fakeClient([NO_SIG, ORIGINAL, { data: { id: "m2" } }]);
    await handleGmail(client, "gmail_reply", { message_id: "m1", body: "x" });

    const mime = rawMime(calls[2]);
    expect(mime).toContain("> Original message body");
    expect(mime).toContain("gmail_quote");
  });

  it("gmail_forward carries the forwarded-message header block", async () => {
    const { client, calls } = fakeClient([NO_SIG, ORIGINAL, { data: { id: "m3" } }]);
    await handleGmail(client, "gmail_forward", {
      message_id: "m1",
      to: "b@example.com",
      html_body: "<p>FYI</p>",
    });

    const mime = rawMime(calls[2]);
    expect(mime).toContain("Subject: Fwd: Original subject");
    expect(mime).toContain("To: b@example.com");
    expect(mime).toContain("---------- Forwarded message ---------");
    expect(mime).toContain("<p>FYI</p>");
  });

  it("gmail_forward without a note still forwards the original", async () => {
    const { client, calls } = fakeClient([NO_SIG, ORIGINAL, { data: { id: "m3" } }]);
    await handleGmail(client, "gmail_forward", { message_id: "m1", to: "b@example.com" });

    const mime = rawMime(calls[2]);
    expect(mime).toContain("---------- Forwarded message ---------");
    expect(mime).toContain("Original message body");
  });
});

describe("body/html_body contract errors fire before any call", () => {
  it("gmail_send with neither body nor html_body is rejected", async () => {
    const { client, calls } = fakeClient([]);
    await expect(
      handleGmail(client, "gmail_send", { to: "a@example.com", subject: "Hi" })
    ).rejects.toThrow(
      "gmail_send: provide body (plain text), html_body (HTML), or both."
    );
    expect(calls).toHaveLength(0);
  });

  it("gmail_reply with both body and html_body is rejected, not half-sent", async () => {
    const { client, calls } = fakeClient([]);
    await expect(
      handleGmail(client, "gmail_reply", {
        message_id: "m1",
        body: "plain",
        html_body: "<b>html</b>",
      })
    ).rejects.toThrow("gmail_reply: provide body or html_body, not both");
    expect(calls).toHaveLength(0);
  });

  it("gmail_reply with neither body nor html_body is rejected", async () => {
    const { client, calls } = fakeClient([]);
    await expect(
      handleGmail(client, "gmail_reply", { message_id: "m1" })
    ).rejects.toThrow("gmail_reply: provide body (plain text) or html_body (HTML).");
    expect(calls).toHaveLength(0);
  });

  it("gmail_forward with both body and html_body is rejected", async () => {
    const { client, calls } = fakeClient([]);
    await expect(
      handleGmail(client, "gmail_forward", {
        message_id: "m1",
        to: "b@example.com",
        body: "plain",
        html_body: "<p>html</p>",
      })
    ).rejects.toThrow("gmail_forward: provide body or html_body, not both");
    expect(calls).toHaveLength(0);
  });
});

/* SCRUM-249: a header is ASCII or it is not a header. The raw builder used to
 * write the subject and the address display names as given, so an em-dash, an
 * accented letter or a CJK character went out as raw UTF-8 bytes and arrived
 * as mojibake. Encoded per RFC 2047 now, and a plain-text send whose headers
 * need it takes the raw path too, so the encoding is ours on every route. */
describe("non-ASCII headers are RFC 2047 encoded (SCRUM-249)", () => {
  function decodeHeader(value: string): string {
    return value
      .replace(/\r\n[ \t]/g, "")
      .replace(/(\?=)\s+(=\?)/g, "$1$2")
      .replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=/g, (_m, b64: string) =>
        Buffer.from(b64, "base64").toString("utf-8")
      );
  }
  /** The Subject header line of a raw MIME string, folded continuation included. */
  function subjectLine(mime: string): string {
    const head = mime.split("\r\n\r\n")[0];
    const m = /^Subject: ((?:.*)(?:\r\n[ \t].*)*)/m.exec(head);
    if (!m) throw new Error("no Subject header");
    return m[1];
  }

  it.each([
    ["an em-dash", "Launch — tomorrow"],
    ["an accented letter", "Résumé attached"],
    ["a CJK character", "会議のメモ"],
  ])("html send: a subject with %s goes out ASCII-only and reads back exactly", async (_l, subject) => {
    const { client, calls } = fakeClient([NO_SIG, { data: { id: "m1" } }]);
    await handleGmail(client, "gmail_send", {
      to: "a@example.com",
      subject,
      html_body: "<p>hi</p>",
    });
    const mime = rawMime(calls[1]);
    const line = subjectLine(mime);
    expect(line).not.toMatch(/[^\x20-\x7e\r\n]/);
    expect(decodeHeader(line)).toBe(subject);
  });

  it("plain send with a non-ASCII subject takes the raw API path with the encoded header", async () => {
    const { client, calls } = fakeClient([NO_SIG, { data: { id: "m1" } }]);
    await handleGmail(client, "gmail_send", {
      to: "a@example.com",
      subject: "Café — 東京",
      body: "plain words",
    });
    expect(calls[1]).toMatchObject({ service: "gmail", resource: "users.messages", method: "send" });
    const mime = rawMime(calls[1]);
    expect(decodeHeader(subjectLine(mime))).toBe("Café — 東京");
    expect(mime).toContain("Content-Type: text/plain; charset=utf-8");
    expect(mime.split("\r\n\r\n").slice(1).join("\r\n\r\n")).toContain("plain words");
  });

  it("plain send with ASCII headers takes the SAME raw path as every other send", async () => {
    const { client, calls } = fakeClient([NO_SIG, { data: { id: "m1" } }]);
    await handleGmail(client, "gmail_send", { to: "a@example.com", subject: "Hi", body: "x" });
    expect(calls[1]).toMatchObject({ resource: "users.messages", method: "send" });
    expect(calls[1].command).toBeUndefined();
  });

  it("drafts encode the display name in To and leave the address bare", async () => {
    const { client, calls } = fakeClient([NO_SIG, { data: { id: "d1", message: { id: "m1" } } }]);
    await handleGmail(client, "gmail_create_draft", {
      to: "Jörg Müller <jorg@example.com>",
      subject: "Hi",
      body: "x",
    });
    const mime = rawMime(calls[1]);
    const to = /^To: (.*)$/m.exec(mime)![1];
    expect(to).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <jorg@example.com>$/);
    expect(decodeHeader(to)).toBe("Jörg Müller <jorg@example.com>");
  });
});

describe("the raw builder refuses a line break in a header (SCRUM-249)", () => {
  it.each(["subject", "to", "cc", "bcc"])("rejects a %s carrying CR or LF instead of emitting a second header", async (field) => {
    const { client, calls } = fakeClient([{ data: { id: "m1" } }]);
    const args: Record<string, unknown> = {
      to: "a@example.com",
      subject: "Hi",
      html_body: "<p>hi</p>",
      [field]: field === "subject" ? "Hi\r\nBcc: x@example.com" : "a@example.com\nBcc: x@example.com",
    };
    await expect(handleGmail(client, "gmail_send", args)).rejects.toThrow(/line break/);
    expect(calls).toHaveLength(0);
  });
});

/* SCRUM-278: the account's Gmail signature is appended when mail is SENT, and
 * it goes in the HTML PART ONLY. The plain part is built from the body alone,
 * exactly as before. These assert the EMITTED REQUEST and the reported state,
 * because the failure this feature exists to end was silent: a send that
 * looked fine and arrived without the sender's signature. */
describe("signature on send (SCRUM-278)", () => {
  const SIG = '<div dir="ltr">Regards,<div>Dana Rivers</div></div>';
  const withSig = (signature = SIG) => ({
    data: { sendAs: [{ sendAsEmail: "sender@example.com", isDefault: true, signature }] },
  });
  const sent = { data: { id: "m1", threadId: "t1" } };

  it("looks the signature up before it composes anything", async () => {
    const { client, calls } = fakeClient([withSig(), sent]);
    await handleGmail(client, "gmail_send", { to: "a@b.c", subject: "Hi", body: "Hi" });
    expect(calls[0]).toMatchObject({
      service: "gmail",
      resource: "users.settings.sendAs",
      method: "list",
      params: { userId: "me" },
    });
  });

  it("promotes a plain send to multipart, signing only the HTML part", async () => {
    const { client, calls } = fakeClient([withSig(), sent]);
    const res = await handleGmail(client, "gmail_send", {
      to: "a@b.c",
      subject: "Hi",
      body: "1 < 2 & 3 > 2\nsecond line",
    });

    // the CLI helper path is NOT used when a signature has to be applied
    expect(calls[1]).toMatchObject({ resource: "users.messages", method: "send" });
    const { parts } = parseMultipart(rawMime(calls[1]));
    expect(parts).toHaveLength(2);
    // plain part: the caller's body, untouched, no signature
    expect(parts[0]).toContain("1 < 2 & 3 > 2");
    expect(parts[0]).not.toContain("Dana Rivers");
    // html part: escaped body plus the stored markup, byte-identical
    expect(parts[1]).toContain("1 &lt; 2 &amp; 3 &gt; 2<br>second line");
    expect(parts[1]).toContain(SIG);
    expect(parts[1]).toContain('class="gmail_signature"');
    expect(payload(res).signature).toBe("applied");
  });

  it("signs only the html part when the caller gave body and html_body", async () => {
    const { client, calls } = fakeClient([withSig(), sent]);
    await handleGmail(client, "gmail_send", {
      to: "a@b.c",
      subject: "Hi",
      body: "plain",
      html_body: "<p>rich</p>",
    });
    const { parts } = parseMultipart(rawMime(calls[1]));
    expect(parts[0]).toContain("plain");
    expect(parts[0]).not.toContain("Dana Rivers");
    expect(parts[1]).toContain(SIG);
    expect(parts[1]).toContain("<p>rich</p>");
  });

  it("keeps the signature out of a plain fallback derived from html_body", async () => {
    const { client, calls } = fakeClient([withSig(), sent]);
    await handleGmail(client, "gmail_send", {
      to: "a@b.c",
      subject: "Hi",
      html_body: "<p>rich</p>",
    });
    const { parts } = parseMultipart(rawMime(calls[1]));
    expect(parts[0]).toContain("rich");
    expect(parts[0]).not.toContain("Dana Rivers");
    expect(parts[1]).toContain(SIG);
  });

  it("carries an image signature through byte-identical", async () => {
    const img =
      '<div dir="ltr">Dana Rivers<br><div><img width="96" height="96" ' +
      'src="https://img.example.com/mail-sig/abc123"></div></div>';
    const { client, calls } = fakeClient([withSig(img), sent]);
    await handleGmail(client, "gmail_send", { to: "a@b.c", subject: "Hi", body: "Hi" });
    const { parts } = parseMultipart(rawMime(calls[1]));
    expect(parts[1]).toContain(img);
    expect(parts[0]).not.toContain("img");
  });

  it("a plain send with NO signature is byte-identical to before", async () => {
    const { client, calls } = fakeClient([NO_SIG, sent]);
    const res = await handleGmail(client, "gmail_send", {
      to: "a@b.c",
      subject: "Hi",
      body: "plain words",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ service: "gmail", resource: "users.messages", method: "send" });
    const mime = rawMime(calls[1]);
    // Unsigned plain stays a SINGLE text/plain part: no signature means no
    // reason to promote it to multipart.
    expect(mime).not.toContain("multipart/alternative");
    expect(mime).toContain("plain words");
    expect(payload(res).signature).toBe("none_set");
  });

  it("signature: false makes NO sendAs call and sends the body untouched", async () => {
    const { client, calls } = fakeClient([sent]);
    const res = await handleGmail(client, "gmail_send", {
      to: "a@b.c",
      subject: "Hi",
      body: "plain words",
      signature: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ resource: "users.messages", method: "send" });
    const mime = rawMime(calls[0]);
    expect(mime).toContain("plain words");
    expect(mime).not.toContain("gmail_signature");
    expect(payload(res).signature).toBe("suppressed");
  });

  it("a failed lookup does not block the send", async () => {
    const { client, calls } = fakeClient([{ throws: "API error: 503" }, sent]);
    const res = await handleGmail(client, "gmail_send", {
      to: "a@b.c",
      subject: "Hi",
      body: "plain words",
    });
    expect(calls[1]).toMatchObject({ resource: "users.messages", method: "send" });
    expect(rawMime(calls[1])).toContain("plain words");
    expect(payload(res).signature).toBe("unavailable");
  });

  it("does not append a second copy to a body that already carries it", async () => {
    const { client, calls } = fakeClient([withSig(), sent]);
    const already = `<p>Hi</p><div class="gmail_signature">${SIG}</div>`;
    const res = await handleGmail(client, "gmail_send", {
      to: "a@b.c",
      subject: "Hi",
      html_body: already,
    });
    expect(rawMime(calls[1])).toContain(already);
    expect(rawMime(calls[1]).match(/gmail_signature/g)).toHaveLength(1);
    expect(payload(res).signature).toBe("already_present");
  });

  /* THE CACHE TEST. create-server.ts builds a new client per tool call with
   * that caller's token, so a signature remembered between calls would go out
   * on another customer's mail. Any cache, at any level, fails this. */
  it("two clients with different signatures never share one", async () => {
    const a = fakeClient([withSig("<div>Alpha Signature</div>"), { data: { id: "m1" } }]);
    await handleGmail(a.client, "gmail_send", { to: "a@b.c", subject: "Hi", body: "Hi" });
    const b = fakeClient([withSig("<div>Beta Signature</div>"), { data: { id: "m2" } }]);
    await handleGmail(b.client, "gmail_send", { to: "a@b.c", subject: "Hi", body: "Hi" });

    const mimeA = rawMime(a.calls[1]);
    const mimeB = rawMime(b.calls[1]);
    expect(mimeA).toContain("Alpha Signature");
    expect(mimeA).not.toContain("Beta Signature");
    expect(mimeB).toContain("Beta Signature");
    expect(mimeB).not.toContain("Alpha Signature");
    expect(a.calls[0]).toMatchObject({ resource: "users.settings.sendAs" });
    expect(b.calls[0]).toMatchObject({ resource: "users.settings.sendAs" });
  });

  it("a signed plain reply keeps its plain part AND signs only the HTML one", async () => {
    // This is the bug the live smoke found: the CLI helper turned this exact
    // call into single-part text/html and the plain alternative vanished.
    const { client, calls } = fakeClient([withSig(), ORIGINAL, sent]);
    const res = await handleGmail(client, "gmail_reply", { message_id: "m0", body: "my reply" });
    const mime = rawMime(calls[2]);
    expect(mime).toContain("multipart/alternative");
    const [plainPart, htmlPart] = mime.split("Content-Type: text/html");
    expect(plainPart).toContain("my reply");
    expect(plainPart).not.toContain("gmail_signature");
    expect(htmlPart).toContain('class="gmail_signature"');
    expect(payload(res).signature).toBe("applied");
  });

  it("the signature sits ABOVE the quote in a reply", async () => {
    const { client, calls } = fakeClient([withSig(), ORIGINAL, sent]);
    await handleGmail(client, "gmail_reply", { message_id: "m0", body: "my reply" });
    const mime = rawMime(calls[2]);
    expect(mime.indexOf("gmail_signature")).toBeLessThan(mime.indexOf("gmail_quote"));
  });

  it("gmail_reply keeps an html_body reply as HTML and appends the signature", async () => {
    const { client, calls } = fakeClient([withSig(), ORIGINAL, sent]);
    await handleGmail(client, "gmail_reply", { message_id: "m0", html_body: "<b>rich</b>" });
    const mime = rawMime(calls[2]);
    expect(mime).toContain("<b>rich</b>");
    expect(mime).toContain(SIG);
  });

  it("gmail_forward with no note sends the signature as the note", async () => {
    const { client, calls } = fakeClient([withSig(), ORIGINAL, sent]);
    await handleGmail(client, "gmail_forward", { message_id: "m0", to: "b@c.d" });
    expect(rawMime(calls[2])).toContain(SIG);
  });

});

/* SCRUM-291 reverses "drafts stay unsigned". Gmail's own Compose signs when
 * the draft is written, and a draft made here and then sent from Gmail never
 * passed through gmail_send_draft, so it never got a signature at all. The
 * draft tools now sign exactly as the send tools do. */
describe("the draft tools sign the draft (SCRUM-291)", () => {
  const SIG = '<div dir="ltr">Regards,<div>Dana Rivers</div></div>';
  const withSig = () => ({ data: { sendAs: [{ sendAsEmail: "sender@example.com", isDefault: true, signature: SIG }] } });
  const created = { data: { id: "d1", message: { id: "m1", threadId: "t1" } } };
  const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
  const draftArgs = { to: "a@b.c", subject: "Hi", body: "Hello there" };

  it("gmail_create_draft: one sendAs lookup, then a draft whose HTML part carries the stored markup in Gmail's wrapper", async () => {
    const { client, calls } = fakeClient([withSig(), created]);
    const res = await handleGmail(client, "gmail_create_draft", draftArgs);

    expect(calls.map((c) => `${c.resource}.${c.method}`)).toEqual(["users.settings.sendAs.list", "users.drafts.create"]);
    const { parts } = parseMultipart(rawMime(calls[1]));
    expect(parts).toHaveLength(2);
    // HTML part only: the plain part is the caller's body, untouched.
    expect(parts[0]).toContain("text/plain");
    expect(parts[0]).toContain("Hello there");
    expect(parts[0]).not.toContain("Dana Rivers");
    expect(parts[1]).toContain("text/html");
    expect(parts[1]).toContain(`<div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">${SIG}</div>`);
    expect(count(parts[1], "data-smartmail")).toBe(1);
    expect(payload(res).signature).toBe("applied");
    // the draft response keeps what it had
    expect(payload(res).id).toBe("d1");
    expect(payload(res).gmail_url).toContain("#drafts?compose=m1");
  });

  it("gmail_update_draft signs too, and still preserves the thread it looked up", async () => {
    const { client, calls } = fakeClient([withSig(), { data: { message: { threadId: "t9" } } }, created]);
    const res = await handleGmail(client, "gmail_update_draft", { draft_id: "d1", ...draftArgs });

    expect(calls.map((c) => `${c.resource}.${c.method}`)).toEqual([
      "users.settings.sendAs.list",
      "users.drafts.get",
      "users.drafts.update",
    ]);
    expect(rawMime(calls[2])).toContain(SIG);
    expect((calls[2].jsonBody as { message: { threadId?: string } }).message.threadId).toBe("t9");
    expect(payload(res).signature).toBe("applied");
  });

  it("an html_body draft is signed in place and its plain fallback stays unsigned", async () => {
    const { client, calls } = fakeClient([withSig(), created]);
    await handleGmail(client, "gmail_create_draft", { to: "a@b.c", subject: "Hi", html_body: "<p>rich</p>" });
    const { parts } = parseMultipart(rawMime(calls[1]));
    expect(parts[1]).toContain("<p>rich</p>");
    expect(parts[1]).toContain(SIG);
    expect(parts[0]).not.toContain("Dana Rivers");
  });

  it.each(["gmail_create_draft", "gmail_update_draft"])(
    "%s with signature: false makes no lookup and writes the draft exactly as before",
    async (tool) => {
      const { client, calls } = fakeClient([created]);
      const res = await handleGmail(client, tool, { draft_id: "d1", thread_id: "t1", ...draftArgs, signature: false });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ resource: "users.drafts" });
      const mime = rawMime(calls[0]);
      expect(mime).toContain("Content-Type: text/plain; charset=utf-8");
      expect(mime).not.toContain("multipart/alternative");
      expect(mime).not.toContain("gmail_signature");
      expect(payload(res).signature).toBe("suppressed");
    }
  );

  it("an account with no signature gets the plain draft it always got, and says none_set", async () => {
    const { client, calls } = fakeClient([NO_SIG, created]);
    const res = await handleGmail(client, "gmail_create_draft", draftArgs);
    const mime = rawMime(calls[1]);
    expect(mime).toContain("Content-Type: text/plain; charset=utf-8");
    expect(mime).not.toContain("multipart/alternative");
    expect(payload(res).signature).toBe("none_set");
  });

  it("a failed lookup still writes the draft, unsigned, and says unavailable", async () => {
    const { client, calls } = fakeClient([{ throws: "sendAs unavailable" }, created]);
    const res = await handleGmail(client, "gmail_create_draft", draftArgs);
    expect(calls.map((c) => c.method)).toEqual(["list", "create"]);
    expect(rawMime(calls[1])).not.toContain("gmail_signature");
    expect(payload(res).signature).toBe("unavailable");
  });

  it("a body that already ends with the signature is not signed twice", async () => {
    const { client, calls } = fakeClient([withSig(), created]);
    const res = await handleGmail(client, "gmail_create_draft", {
      to: "a@b.c",
      subject: "Hi",
      html_body: `<p>rich</p>${SIG}`,
    });
    expect(count(rawMime(calls[1]), "Dana Rivers</div>")).toBe(1);
    expect(payload(res).signature).toBe("already_present");
  });

  it("no cache: two drafts on two clients each read their own account's signature", async () => {
    const other = { data: { sendAs: [{ sendAsEmail: "o@example.com", isDefault: true, signature: "<div>Other Person</div>" }] } };
    const a = fakeClient([withSig(), created]);
    const b = fakeClient([other, created]);
    await handleGmail(a.client, "gmail_create_draft", draftArgs);
    await handleGmail(b.client, "gmail_create_draft", draftArgs);
    expect(rawMime(a.calls[1])).toContain("Dana Rivers");
    expect(rawMime(a.calls[1])).not.toContain("Other Person");
    expect(rawMime(b.calls[1])).toContain("Other Person");
    expect(rawMime(b.calls[1])).not.toContain("Dana Rivers");
  });

  it("a line break in a header is still refused before the lookup costs a call", async () => {
    const { client, calls } = fakeClient([withSig(), created]);
    await expect(
      handleGmail(client, "gmail_create_draft", { ...draftArgs, subject: "Hi\r\nBcc: x@evil.example" })
    ).rejects.toThrow(/must not contain a line break/);
    expect(calls).toHaveLength(0);
  });

  /* THE CHAINS. The draft this module writes is fed back as the stored MIME
   * the next tool reads, so "signed once" is a property of the real output,
   * not of a hand-written fixture. */
  const storedDraft = (call: Record<string, unknown>) => {
    const body = call.jsonBody as { message: { raw: string } };
    return { data: { id: "d1", message: { id: "m1", threadId: "t1", raw: body.message.raw } } };
  };

  it("create_draft then send_draft: exactly one signature block, and the send neither rewrites nor double-signs", async () => {
    const first = fakeClient([withSig(), created]);
    await handleGmail(first.client, "gmail_create_draft", draftArgs);

    const second = fakeClient([storedDraft(first.calls[1]), withSig(), { data: { id: "sent1" } }]);
    const res = await handleGmail(second.client, "gmail_send_draft", { draft_id: "d1" });
    // no drafts.update: the draft goes out as stored
    expect(second.calls.map((c) => `${c.resource}.${c.method}`)).toEqual([
      "users.drafts.get",
      "users.settings.sendAs.list",
      "users.drafts.send",
    ]);
    expect(payload(res).signature).toBe("already_present");
    expect(count(rawMime(first.calls[1]), "data-smartmail")).toBe(1);
  });

  it("create_draft then update_draft: the replacement carries exactly one signature block", async () => {
    const first = fakeClient([withSig(), created]);
    await handleGmail(first.client, "gmail_create_draft", draftArgs);
    const second = fakeClient([withSig(), created]);
    await handleGmail(second.client, "gmail_update_draft", { draft_id: "d1", thread_id: "t1", ...draftArgs, body: "Hello again" });
    const mime = rawMime(second.calls[1]);
    expect(count(mime, "data-smartmail")).toBe(1);
    expect(mime).toContain("Hello again");

    const third = fakeClient([storedDraft(second.calls[1]), withSig(), { data: { id: "sent1" } }]);
    const res = await handleGmail(third.client, "gmail_send_draft", { draft_id: "d1" });
    expect(third.calls.map((c) => c.method)).toEqual(["get", "list", "send"]);
    expect(payload(res).signature).toBe("already_present");
  });

  it("a draft written with signature: false is signed when gmail_send_draft sends it", async () => {
    const first = fakeClient([created]);
    await handleGmail(first.client, "gmail_create_draft", { ...draftArgs, signature: false });
    const second = fakeClient([storedDraft(first.calls[0]), withSig(), { data: { id: "d1" } }, { data: { id: "sent1" } }]);
    const res = await handleGmail(second.client, "gmail_send_draft", { draft_id: "d1" });
    expect(second.calls.map((c) => c.method)).toEqual(["get", "list", "update", "send"]);
    expect(payload(res).signature).toBe("applied");
  });
});

describe("gmail_send_draft signs the stored MIME (SCRUM-278)", () => {
  const SIG = '<div dir="ltr">Regards,<div>Dana Rivers</div></div>';
  const raw = (...lines: string[]) => Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
  const draftGet = (rawB64: string, threadId = "t1") => ({
    data: { id: "d1", message: { id: "m1", threadId, raw: rawB64 } },
  });
  const sendAs = (signature = SIG, email = "sender@example.com") => ({
    data: { sendAs: [{ sendAsEmail: email, isDefault: true, signature }] },
  });
  const PLAIN = raw(
    "From: Dana Rivers <sender@example.com>",
    "To: someone@example.com",
    "Subject: Hello",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    "Hi there"
  );
  const updatedRaw = (call: Record<string, unknown>) => {
    const body = call.jsonBody as { message: { raw: string } };
    return Buffer.from(body.message.raw, "base64url").toString("utf8");
  };
  /** The updated draft with every part decoded, since an HTML part this code
   * authors is written base64 and so is not literally present in the raw. */
  const updatedDecoded = (call: Record<string, unknown>) => {
    const out = updatedRaw(call);
    const boundary = /boundary="([^"]+)"/.exec(out)?.[1];
    if (!boundary) return out;
    return out
      .split(`--${boundary}`)
      .slice(1, -1)
      .map((p) => {
        const region = p.replace(/^\r\n/, "");
        const sep = region.indexOf("\r\n\r\n");
        const headers = region.slice(0, sep);
        const body = region.slice(sep + 4).replace(/\r\n$/, "");
        return /base64/i.test(headers)
          ? Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8")
          : body;
      })
      .join("\n----\n");
  };

  it("gets the draft, updates it with the signature, then sends it", async () => {
    const { client, calls } = fakeClient([
      draftGet(PLAIN),
      sendAs(),
      { data: { id: "d1" } },
      { data: { id: "m1" } },
    ]);
    const res = await handleGmail(client, "gmail_send_draft", { draft_id: "d1" });

    expect(calls.map((c) => `${c.resource}.${c.method}`)).toEqual([
      "users.drafts.get",
      "users.settings.sendAs.list",
      "users.drafts.update",
      "users.drafts.send",
    ]);
    expect(calls[0]).toMatchObject({ params: { userId: "me", id: "d1", format: "raw" } });
    expect(updatedRaw(calls[2])).toContain("multipart/alternative");
    expect(updatedDecoded(calls[2])).toContain(SIG);
    expect((calls[2].jsonBody as { message: { threadId?: string } }).message.threadId).toBe("t1");
    expect(payload(res).signature).toBe("applied");
  });

  it("uses the sendAs entry matching the draft's From, not the default", async () => {
    const aliasDraft = raw(
      "From: Alias <alias@example.com>",
      "To: a@b.c",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Hi"
    );
    const { client, calls } = fakeClient([
      draftGet(aliasDraft),
      {
        data: {
          sendAs: [
            { sendAsEmail: "sender@example.com", isDefault: true, signature: "<div>Default</div>" },
            { sendAsEmail: "alias@example.com", isDefault: false, signature: "<div>Alias sig</div>" },
          ],
        },
      },
      { data: { id: "d1" } },
      { data: { id: "m1" } },
    ]);
    await handleGmail(client, "gmail_send_draft", { draft_id: "d1" });
    expect(updatedDecoded(calls[2])).toContain("Alias sig");
    expect(updatedDecoded(calls[2])).not.toContain("Default");
  });

  it("signature: false sends the draft as-is, with no get and no lookup", async () => {
    const { client, calls } = fakeClient([{ data: { id: "m1" } }]);
    const res = await handleGmail(client, "gmail_send_draft", { draft_id: "d1", signature: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ resource: "users.drafts", method: "send" });
    expect(payload(res).signature).toBe("suppressed");
  });

  it("sends a draft carrying an attachment untouched", async () => {
    const mixed = raw(
      "From: a@b.c",
      'Content-Type: multipart/mixed; boundary="m1"',
      "",
      "--m1",
      "Content-Type: text/plain",
      "",
      "Hi",
      "--m1",
      "Content-Type: application/pdf; name=x.pdf",
      "Content-Transfer-Encoding: base64",
      "",
      "AAAA",
      "--m1--",
      ""
    );
    // SCRUM-279: a draft with files is signed in its text part, and the file
    // travels back byte for byte.
    const { client, calls } = fakeClient([draftGet(mixed), sendAs(), { data: {} }, { data: { id: "m1" } }]);
    const res = await handleGmail(client, "gmail_send_draft", { draft_id: "d1" });
    expect(calls.map((c) => c.method)).toEqual(["get", "list", "update", "send"]);
    expect(payload(res).signature).toBe("applied");
    const updated = Buffer.from((calls[2].jsonBody as { message: { raw: string } }).message.raw, "base64url").toString("utf8");
    expect(updated).toContain("--m1\r\nContent-Type: application/pdf; name=x.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nAAAA\r\n--m1--");
  });

  it("a signed draft too large for a JSON body goes back as an rfc822 upload", async () => {
    const big = raw(
      "From: a@b.c",
      'Content-Type: multipart/mixed; boundary="m1"',
      "",
      "--m1",
      "Content-Type: text/plain",
      "",
      "Hi",
      "--m1",
      "Content-Type: application/pdf; name=x.pdf",
      "Content-Transfer-Encoding: base64",
      "",
      "A".repeat(2 * 1024 * 1024),
      "--m1--",
      ""
    );
    const { client, calls } = fakeClient([draftGet(big), sendAs(), { data: {} }, { data: { id: "m1" } }]);
    const res = await handleGmail(client, "gmail_send_draft", { draft_id: "d1" });
    expect(payload(res).signature).toBe("applied");
    const up = calls[2];
    expect(up.upload).toBe(true);
    expect(`${up.resource}.${up.method}`).toBe("users.drafts.update");
    expect(up.contentType).toBe("message/rfc822");
    const { simpleParser } = await import("mailparser");
    const mail = await simpleParser(up.bytes as Buffer);
    expect(mail.html).toContain("Dana Rivers");
    expect(mail.attachments[0].content.equals(Buffer.from("A".repeat(2 * 1024 * 1024), "base64"))).toBe(true);
    expect(up.metadata).toEqual({ message: { threadId: "t1" } });
  });

  it("a retry after a failed send does not add a second signature", async () => {
    // The draft on the server now holds the signature the first attempt wrote.
    const signedDraft = raw(
      "From: Dana Rivers <sender@example.com>",
      "To: a@b.c",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain",
      "",
      "Hi there",
      "--b1",
      "Content-Type: text/html",
      "",
      `<div>Hi there</div><div class="gmail_signature">${SIG}</div>`,
      "--b1--",
      ""
    );
    const { client, calls } = fakeClient([draftGet(signedDraft), sendAs(), { data: { id: "m1" } }]);
    const res = await handleGmail(client, "gmail_send_draft", { draft_id: "d1" });
    expect(calls.map((c) => c.method)).toEqual(["get", "list", "send"]);
    expect(payload(res).signature).toBe("already_present");
  });

  it("sends the draft when the account has no signature", async () => {
    const { client, calls } = fakeClient([draftGet(PLAIN), NO_SIG, { data: { id: "m1" } }]);
    const res = await handleGmail(client, "gmail_send_draft", { draft_id: "d1" });
    expect(calls.map((c) => c.method)).toEqual(["get", "list", "send"]);
    expect(payload(res).signature).toBe("none_set");
  });

  it("sends the draft when the lookup fails", async () => {
    const { client, calls } = fakeClient([
      draftGet(PLAIN),
      { throws: "API error: 503" },
      { data: { id: "m1" } },
    ]);
    const res = await handleGmail(client, "gmail_send_draft", { draft_id: "d1" });
    expect(calls.map((c) => c.method)).toEqual(["get", "list", "send"]);
    expect(payload(res).signature).toBe("unavailable");
  });

  /* Nothing in the signature path may cost the user their send. */
  it("sends the draft when the get fails", async () => {
    const { client, calls } = fakeClient([{ throws: "API error: 500" }, { data: { id: "m1" } }]);
    const res = await handleGmail(client, "gmail_send_draft", { draft_id: "d1" });
    expect(calls.map((c) => c.method)).toEqual(["get", "send"]);
    expect(payload(res).signature).toBe("unavailable");
  });

  it("sends the draft when Gmail rejects our rewrite on update", async () => {
    const { client, calls } = fakeClient([
      draftGet(PLAIN),
      sendAs(),
      { throws: "API error: 400 invalid raw" },
      { data: { id: "m1" } },
    ]);
    const res = await handleGmail(client, "gmail_send_draft", { draft_id: "d1" });
    expect(calls.map((c) => c.method)).toEqual(["get", "list", "update", "send"]);
    expect(payload(res).signature).toBe("skipped_unsupported_draft");
  });

  it("signs a reply draft whose quoted thread already carries a signature", async () => {
    // Bug 1's real-world form: the quote holds an earlier signature block, and
    // reading the marker across the whole body would send this reply bare.
    const quoted = raw(
      "From: Dana Rivers <sender@example.com>",
      "To: a@b.c",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain",
      "",
      "my reply",
      "--b1",
      "Content-Type: text/html",
      "",
      `<div>my reply</div><div class="gmail_quote">earlier` +
        `<div class="gmail_signature">${SIG}</div></div>`,
      "--b1--",
      ""
    );
    const { client, calls } = fakeClient([
      draftGet(quoted),
      sendAs(),
      { data: { id: "d1" } },
      { data: { id: "m1" } },
    ]);
    const res = await handleGmail(client, "gmail_send_draft", { draft_id: "d1" });
    expect(payload(res).signature).toBe("applied");
    const out = updatedDecoded(calls[2]);
    expect(out.indexOf("gmail_signature")).toBeLessThan(out.indexOf("gmail_quote"));
  });

  /* SCRUM-289: the one-argv-string limit belonged to the CLI transport and
   * left with it, so a long text draft is signed like any other. What stays
   * is a bound on the rewrite itself, which is un-yielding work on a shared
   * event loop. */
  it("signs a text draft that the old transport's argv limit used to skip", async () => {
    const long = raw(
      "From: Dana Rivers <sender@example.com>",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "x".repeat(130_000)
    );
    const { client, calls } = fakeClient([draftGet(long), sendAs(), { data: {} }, { data: { id: "m1" } }]);
    const res = await handleGmail(client, "gmail_send_draft", { draft_id: "d1" });
    expect(calls.map((c) => c.method)).toEqual(["get", "list", "update", "send"]);
    expect(payload(res).signature).toBe("applied");
  });

  it("sends a draft past the rewrite bound untouched, without decoding it", async () => {
    const huge = raw(
      "From: Dana Rivers <sender@example.com>",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "x".repeat(800_000)
    );
    const { client, calls } = fakeClient([draftGet(huge), sendAs(), { data: { id: "m1" } }]);
    const res = await handleGmail(client, "gmail_send_draft", { draft_id: "d1" });
    expect(calls.map((c) => c.method)).toEqual(["get", "list", "send"]);
    expect(payload(res).signature).toBe("skipped_unsupported_draft");
  });
});

/* The plugin serves every session from one event loop, so work done on a
 * caller's html_body is every tenant's problem. Nothing caps an inbound body
 * any more: the old transport's one-argv-string limit used to, by accident,
 * and it left with that transport (SCRUM-289). So these are sized well past
 * it, at megabytes, which is what can now arrive. */
describe("a large adversarial html_body does not stall the loop", () => {
  const withSig = { data: { sendAs: [{ isDefault: true, signature: "<div>Sig</div>" }] } };
  // Markup with many '<' and no '>' is the shape that makes a tag-stripping
  // scan superlinear; the cost scales with the NUMBER of unclosed tag starts.
  const evil = "<div ".repeat(1_000_000);

  it("gmail_reply survives adversarial markup now that it derives a plain part", async () => {
    // Composing the reply here means the flattener is newly on this path, so
    // this guard matters MORE than it did when the CLI helper owned the send.
    const { client, calls } = fakeClient([withSig, ORIGINAL, { data: { id: "m1" } }]);
    const started = Date.now();
    await handleGmail(client, "gmail_reply", { message_id: "m0", html_body: evil });
    expect(Date.now() - started).toBeLessThan(1000);
    // the caller's markup still travels intact in the HTML part
    expect(rawMime(calls[2])).toContain("multipart/alternative");
  });

  it("gmail_forward survives adversarial markup too", async () => {
    const { client } = fakeClient([withSig, ORIGINAL, { data: { id: "m1" } }]);
    const started = Date.now();
    await handleGmail(client, "gmail_forward", {
      message_id: "m0",
      to: "b@c.d",
      html_body: evil,
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("header injection through the CALLER's arguments (gate finding)", () => {
  // gmail_send has always rejected a line break in to/subject/cc/bcc via
  // assertHeadersSingleLine. Composing reply and forward here put them on the
  // same raw path WITHOUT that guard, so input gmail_send refuses outright was
  // being injected into the header block by gmail_forward. encodeAddressHeader
  // is no defence: it returns a CRLF value verbatim.
  const evilTo = "victim@example.com\r\nBcc: attacker@example.com";

  it("gmail_forward REFUSES a line break in to, as gmail_send does", async () => {
    const { client, calls } = fakeClient([]);
    await expect(
      handleGmail(client, "gmail_forward", { message_id: "m1", to: evilTo })
    ).rejects.toThrow("to must not contain a line break");
    // and it costs no API call, so a malformed argument never reaches Google
    expect(calls).toHaveLength(0);
  });

  it("gmail_reply REFUSES a line break in its arguments too", async () => {
    const { client, calls } = fakeClient([]);
    await expect(
      handleGmail(client, "gmail_reply", { message_id: "m1", body: "x", subject: evilTo })
    ).rejects.toThrow("must not contain a line break");
    expect(calls).toHaveLength(0);
  });

  it("gmail_send still refuses it, the control for the two above", async () => {
    const { client } = fakeClient([]);
    await expect(
      handleGmail(client, "gmail_send", { to: evilTo, subject: "Hi", body: "x" })
    ).rejects.toThrow("to must not contain a line break");
  });
});

describe("header rendering folds injections but keeps legal continuations", () => {
  it("keeps a long non-ASCII subject FOLDED in the rendered headers", () => {
    // encodeHeaderValue wraps long encoded subjects with CRLF + space. That is
    // legal folding, not an injection, and a blanket fold destroys it — the
    // header then runs past the 998-octet line limit as one line.
    const { client, calls } = fakeClient([NO_SIG, { data: { id: "m1" } }]);
    return handleGmail(client, "gmail_send", {
      to: "a@example.com",
      subject: "ü".repeat(200),
      body: "x",
    }).then(() => {
      const mime = rawMime(calls[1]);
      const headerBlock = mime.split("\r\n\r\n")[0];
      expect(headerBlock).toMatch(/\r\n /);
      for (const line of headerBlock.split("\r\n")) {
        expect(line.length).toBeLessThan(998);
      }
    });
  });

  it("STILL folds a line break that is not a continuation", () => {
    // The control: without it the test above passes on a renderer that folds
    // nothing at all.
    const { client, calls } = fakeClient([NO_SIG, { data: { id: "m1" } }]);
    return handleGmail(client, "gmail_send", {
      to: "a@example.com",
      subject: "Hi",
      body: "x",
    }).then(() => {
      const mime = rawMime(calls[1]);
      const headerBlock = mime.split("\r\n\r\n")[0];
      // every header line is a real header, none injected
      for (const line of headerBlock.split("\r\n")) {
        expect(line.startsWith(" ") || /^[A-Za-z-]+:/.test(line)).toBe(true);
      }
    });
  });
});


describe("renderHeaders is the last line of defence, tested directly", () => {
  // It is unreachable through handleGmail today: every producer already folds,
  // so removing this guard leaves the whole suite green. That is exactly why it
  // needs its own test -- an untested guard is one a later refactor deletes.
  // Asserted as "no stray CR or LF survives anywhere", not as "no line starts
  // with Bcc:". Splitting on CRLF and checking line starts cannot see a BARE
  // LF injection at all -- the whole string stays one "line" and the assertion
  // passes while the injection survives.
  const strayBreaks = (rendered: string) =>
    rendered.split(/\r\n(?=[ \t])/).join("").replace(/\r\n/g, "").match(/[\r\n]/g) ?? [];

  it("folds an injected header out of a value", () => {
    const out = renderHeaders(["To: victim@example.com\r\nBcc: attacker@example.com"]);
    expect(strayBreaks(out)).toHaveLength(0);
    expect(out).toContain("victim@example.com");
  });

  it("folds a BARE LF too, which still starts a line for most parsers", () => {
    const out = renderHeaders(["Subject: a\nBcc: attacker@example.com"]);
    expect(strayBreaks(out)).toHaveLength(0);
  });

  it("joins separate headers with CRLF, which is the job", () => {
    expect(renderHeaders(["A: 1", "B: 2"])).toBe("A: 1\r\nB: 2");
  });

  it("PRESERVES a legal continuation, the one CRLF that must survive", () => {
    const folded = "Subject: =?UTF-8?B?AAAA?=\r\n =?UTF-8?B?BBBB?=";
    expect(renderHeaders([folded])).toBe(folded);
  });
});
