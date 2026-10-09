import { describe, expect, it } from "vitest";
import { fakeClient } from "./fake-client.test-helper.js";
import { handleGmail } from "./gmail.js";
import { replyRecipients } from "./gmail-reply.js";

/**
 * Who a reply goes to, and what gmail_mark_read changes (SCRUM-368).
 *
 * A reply used to go to the original's From and nowhere else: a Reply-To was
 * never read, and answering your own sent message mailed yourself. Both sent
 * mail to the wrong person with a success response.
 */

const NO_SIG = { data: { sendAs: [{ sendAsEmail: "me@example.com", isDefault: true, signature: "" }] } };
const OWN = { data: { sendAs: [{ sendAsEmail: "me@example.com", isDefault: true }, { sendAsEmail: "alias@example.com" }] } };

function original(headers: Record<string, string>, labelIds: string[] = ["INBOX"]) {
  return {
    data: {
      id: "m1",
      threadId: "t1",
      labelIds,
      payload: {
        headers: [
          { name: "Date", value: "Thu, 1 Jan 2026 00:00:00 +0000" },
          { name: "Subject", value: "Original subject" },
          { name: "Message-ID", value: "<ABC@example.com>" },
          ...Object.entries(headers).map(([name, value]) => ({ name, value })),
        ],
        mimeType: "text/plain",
        body: { data: Buffer.from("Original message body").toString("base64url") },
      },
    },
  };
}

function rawMime(call: Record<string, unknown>): string {
  return Buffer.from((call.jsonBody as { raw: string }).raw, "base64url").toString("utf-8");
}
const headerOf = (mime: string, name: string) =>
  mime.split("\r\n\r\n")[0].split("\r\n").find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
const payload = (result: { content: { text: string }[] }) => JSON.parse(result.content[0].text) as Record<string, unknown>;

async function reply(headers: Record<string, string>, args: Record<string, unknown> = {}, labelIds?: string[]) {
  const plan = [NO_SIG, original(headers, labelIds), ...(args.reply_all ? [OWN] : []), { data: { id: "sent" } }];
  const { client, calls } = fakeClient(plan);
  const result = await handleGmail(client, "gmail_reply", { message_id: "m1", body: "x", ...args });
  const mime = rawMime(calls[calls.length - 1]);
  return { mime, to: headerOf(mime, "To"), cc: headerOf(mime, "Cc"), result: payload(result), calls };
}

describe("gmail_reply: a plain reply goes to one party", () => {
  it("the sender, when there is no Reply-To", async () => {
    const r = await reply({ From: "Sender Name <sender@example.com>", To: "me@example.com" });
    expect(r.to).toBe("To: sender@example.com");
    expect(r.cc).toBeUndefined();
  });

  it("the Reply-To when the original has one, not the From", async () => {
    const r = await reply({
      From: "Newsletter <noreply@example.com>",
      "Reply-To": "Support Desk <support@example.com>",
      To: "me@example.com",
    });
    expect(r.to).toBe("To: support@example.com");
    expect(r.mime).not.toMatch(/^To:.*noreply@example\.com/m);
  });

  it("the original's recipients when the account sent the original itself", async () => {
    const r = await reply(
      { From: "Me <me@example.com>", To: "Dana <dana@example.com>", Cc: "other@example.com" },
      {},
      ["SENT"]
    );
    expect(r.to).toBe("To: dana@example.com");
    // Not reply all: the Cc is not carried.
    expect(r.cc).toBeUndefined();
  });

  it("a display name holding a comma is one sender, addressed by its address", async () => {
    const r = await reply({ From: '"Doe, Jane" <jane@example.com>', To: "me@example.com" });
    expect(r.to).toBe("To: jane@example.com");
  });

  it("several Reply-To addresses are all addressed", async () => {
    const r = await reply({ From: "a@example.com", "Reply-To": '"List, The" <list@example.com>, owner@example.com' });
    expect(r.to).toBe("To: list@example.com, owner@example.com");
  });

  it("the others on the original are NOT added without reply_all", async () => {
    const r = await reply({ From: "sender@example.com", To: "me@example.com, third@example.com", Cc: "cc@example.com" });
    expect(r.to).toBe("To: sender@example.com");
    expect(r.mime).not.toContain("third@example.com");
    expect(r.mime).not.toContain("cc@example.com");
    // And the account's send-as list is not read for a plain reply.
    expect(r.calls.filter((c) => c.resource === "users.settings.sendAs")).toHaveLength(1);
  });

  it("reports where it went, and says when a Reply-To sent it away from the sender", async () => {
    const r = await reply({ From: "Boss <boss@example.com>", "Reply-To": "support@elsewhere.example" });
    expect(r.result).toMatchObject({
      id: "sent",
      to: "support@elsewhere.example",
      reply_to_used: true,
      original_from: "boss@example.com",
    });
    expect(r.result).not.toHaveProperty("cc");
  });

  it("carries no redirect flag when the reply went to the sender, or to a Reply-To that is the sender", async () => {
    const plain = await reply({ From: "sender@example.com" });
    expect(plain.result).not.toHaveProperty("reply_to_used");
    const same = await reply({ From: "Sender <sender@example.com>", "Reply-To": "SENDER@example.com" });
    expect(same.result).not.toHaveProperty("reply_to_used");
    const own = await reply({ From: "me@example.com", To: "dana@example.com" }, {}, ["SENT"]);
    expect(own.result).not.toHaveProperty("reply_to_used");
  });

  it("the redirect flag holds under reply_all too, and is absent when the sender is among the recipients", async () => {
    const away = await reply(
      { From: "boss@example.com", "Reply-To": "support@elsewhere.example", To: "me@example.com, third@example.com" },
      { reply_all: true }
    );
    expect(away.to).toBe("To: support@elsewhere.example, third@example.com");
    expect(away.result).toMatchObject({ reply_to_used: true, original_from: "boss@example.com" });

    const included = await reply(
      { From: "boss@example.com", "Reply-To": "boss@example.com, list@example.com", To: "me@example.com" },
      { reply_all: true }
    );
    expect(included.result).not.toHaveProperty("reply_to_used");
  });

  it("refuses a reply that would go to more than 100 addresses", async () => {
    const many = Array.from({ length: 101 }, (_, i) => `u${i}@example.com`).join(", ");
    const { client, calls } = fakeClient([NO_SIG, original({ From: "sender@example.com", "Reply-To": many })]);
    await expect(handleGmail(client, "gmail_reply", { message_id: "m1", body: "x" })).rejects.toThrow(/at most 100/);
    expect(calls.some((c) => c.method === "send")).toBe(false);
  });

  it("refuses when there is nobody to address, before anything is sent", async () => {
    const { client, calls } = fakeClient([NO_SIG, original({ From: "Me <me@example.com>" }, ["SENT"])]);
    await expect(handleGmail(client, "gmail_reply", { message_id: "m1", body: "x" })).rejects.toThrow(/nobody to reply to/);
    expect(calls.some((c) => c.method === "send")).toBe(false);
  });
});

describe("gmail_reply: reply_all adds the rest of the conversation", () => {
  it("the other To recipients join To and the Cc stays Cc, without the account's own addresses", async () => {
    const r = await reply(
      {
        From: "Sender <sender@example.com>",
        To: 'Me <me@example.com>, "Third, The" <third@example.com>, alias@example.com',
        Cc: "cc@example.com, ME@example.com",
      },
      { reply_all: true }
    );
    expect(r.to).toBe("To: sender@example.com, third@example.com");
    expect(r.cc).toBe("Cc: cc@example.com");
    expect(r.result).toMatchObject({ to: "sender@example.com, third@example.com", cc: "cc@example.com" });
  });

  it("nobody is listed twice, across To and Cc", async () => {
    const r = await reply(
      { From: "sender@example.com", To: "me@example.com, Sender@example.com, x@example.com", Cc: "x@example.com, y@example.com" },
      { reply_all: true }
    );
    expect(r.to).toBe("To: sender@example.com, x@example.com");
    expect(r.cc).toBe("Cc: y@example.com");
  });

  it("on a message the account sent: its To and its Cc", async () => {
    const r = await reply(
      { From: "me@example.com", To: "dana@example.com, eli@example.com", Cc: "boss@example.com, me@example.com" },
      { reply_all: true },
      ["SENT"]
    );
    expect(r.to).toBe("To: dana@example.com, eli@example.com");
    expect(r.cc).toBe("Cc: boss@example.com");
  });

  it("still answers when the send-as list cannot be read: nobody is left out, and the reply goes", async () => {
    const { client, calls } = fakeClient([
      NO_SIG,
      original({ From: "sender@example.com", To: "me@example.com, third@example.com" }),
      { throws: "sendAs unavailable" },
      { data: { id: "sent" } },
    ]);
    await handleGmail(client, "gmail_reply", { message_id: "m1", body: "x", reply_all: true });
    expect(headerOf(rawMime(calls[calls.length - 1]), "To")).toBe("To: sender@example.com, me@example.com, third@example.com");
  });
});

describe("gmail_reply: expected_to holds the reply to the people the caller named", () => {
  async function refused(headers: Record<string, string>, args: Record<string, unknown>, labelIds?: string[]) {
    const plan = [NO_SIG, original(headers, labelIds), ...(args.reply_all ? [OWN] : [])];
    const { client, calls } = fakeClient(plan);
    const error = await handleGmail(client, "gmail_reply", { message_id: "m1", body: "x", ...args }).then(
      () => null,
      (e: Error) => e
    );
    return { error, sent: calls.some((c) => c.method === "send") };
  }

  it("sends when the reply goes exactly where the caller said, whatever the case or the display name", async () => {
    const r = await reply({ From: "Sender <sender@example.com>" }, { expected_to: "SENDER@example.com" });
    expect(r.to).toBe("To: sender@example.com");
    const named = await reply({ From: "sender@example.com" }, { expected_to: '"Sender, The" <sender@example.com>' });
    expect(named.to).toBe("To: sender@example.com");
  });

  it("refuses, before anything is sent, a reply that a Reply-To would send elsewhere", async () => {
    const r = await refused(
      { From: "Boss <boss@example.com>", "Reply-To": "support@elsewhere.example" },
      { expected_to: "boss@example.com" }
    );
    expect(r.sent).toBe(false);
    expect(r.error?.message).toMatch(/nothing was sent/);
    expect(r.error?.message).toContain("To: support@elsewhere.example");
    expect(r.error?.message).toContain("Not expected: support@elsewhere.example.");
    expect(r.error?.message).toContain("Named but not addressed: boss@example.com.");
  });

  it("several addresses: all of them must be named, in any order", async () => {
    const headers = { From: "a@example.com", "Reply-To": "list@example.com, owner@example.com" };
    const ok = await reply(headers, { expected_to: "owner@example.com, list@example.com" });
    expect(ok.to).toBe("To: list@example.com, owner@example.com");
    const partial = await refused(headers, { expected_to: "list@example.com" });
    expect(partial.sent).toBe(false);
    expect(partial.error?.message).toContain("Not expected: owner@example.com.");
  });

  it("naming someone the reply would not reach is a refusal too", async () => {
    const r = await refused({ From: "sender@example.com" }, { expected_to: "sender@example.com, third@example.com" });
    expect(r.sent).toBe(false);
    expect(r.error?.message).toContain("Named but not addressed: third@example.com.");
    expect(r.error?.message).not.toContain("Not expected:");
  });

  it("reply_all: the Cc counts, so everyone who would receive it must be named", async () => {
    const headers = { From: "sender@example.com", To: "me@example.com, third@example.com", Cc: "cc@example.com" };
    const ok = await reply(headers, {
      reply_all: true,
      expected_to: "sender@example.com, third@example.com, cc@example.com",
    });
    expect(ok.to).toBe("To: sender@example.com, third@example.com");
    expect(ok.cc).toBe("Cc: cc@example.com");
    // Naming the To alone is not enough: the Cc is a recipient the original's
    // sender chose.
    const toOnly = await refused(headers, { reply_all: true, expected_to: "sender@example.com, third@example.com" });
    expect(toOnly.sent).toBe(false);
    expect(toOnly.error?.message).toContain("Cc: cc@example.com");
    expect(toOnly.error?.message).toContain("Not expected: cc@example.com.");
  });

  it("a message the account sent: expected_to names the original's recipients", async () => {
    const ok = await reply({ From: "me@example.com", To: "dana@example.com" }, { expected_to: "dana@example.com" }, ["SENT"]);
    expect(ok.to).toBe("To: dana@example.com");
    const wrong = await refused({ From: "me@example.com", To: "dana@example.com" }, { expected_to: "me@example.com" }, ["SENT"]);
    expect(wrong.sent).toBe(false);
  });

  it("an expected_to with no address in it, or that is not a string, is refused rather than ignored", async () => {
    const empty = await refused({ From: "sender@example.com" }, { expected_to: "the sender" });
    expect(empty.sent).toBe(false);
    expect(empty.error?.message).toMatch(/expected_to holds no email address/);
    const blank = await refused({ From: "sender@example.com" }, { expected_to: "" });
    expect(blank.sent).toBe(false);
    const wrongType = await refused({ From: "sender@example.com" }, { expected_to: ["sender@example.com"] });
    expect(wrongType.sent).toBe(false);
  });

  it("a look-alike letter outside ASCII is a different address, not a case variant", async () => {
    // U+212A, the Kelvin sign, lower-cases to an ASCII "k" under toLowerCase.
    const r = await refused({ From: "mar\u212A@example.com" }, { expected_to: "mark@example.com" });
    expect(r.sent).toBe(false);
    expect(r.error?.message).toContain("Named but not addressed: mark@example.com.");
  });

  it("without expected_to nothing changes: the reply is sent and the redirect is only reported", async () => {
    const r = await reply({ From: "boss@example.com", "Reply-To": "support@elsewhere.example" });
    expect(r.result).toMatchObject({ to: "support@elsewhere.example", reply_to_used: true });
  });
});

describe("replyRecipients", () => {
  it("a note the account sent only to itself is still answered to itself under reply all", () => {
    const r = replyRecipients({ from: "me@example.com", to: "me@example.com", selfSent: true }, { replyAll: true, ownAddresses: ["me@example.com"] });
    expect(r.to.map((m) => m.address)).toEqual(["me@example.com"]);
  });

  it("an address smuggled into a display name is never the recipient", () => {
    const r = replyRecipients({ from: '"ceo@victim.example" <attacker@evil.example>' });
    expect(r.to.map((m) => m.address)).toEqual(["attacker@evil.example"]);
  });

  it("a header that tries to add a recipient on a second line adds none", () => {
    const r = replyRecipients({ from: "sender@example.com\r\nBcc: evil@attacker.example" });
    expect(r.to.map((m) => m.address)).toEqual(["sender@example.com"]);
  });
});

describe("gmail_mark_read: the UNREAD default is only a default", () => {
  async function markRead(args: Record<string, unknown>) {
    const { client, calls } = fakeClient([{ data: { id: "m1" } }]);
    await handleGmail(client, "gmail_mark_read", { message_id: "m1", ...args });
    return calls[0].jsonBody;
  }

  it("neither list: marks read", async () => {
    expect(await markRead({})).toEqual({ removeLabelIds: ["UNREAD"] });
    expect(await markRead({ add_labels: [], remove_labels: [] })).toEqual({ removeLabelIds: ["UNREAD"] });
  });

  it("add_labels alone: adds them and does NOT mark read", async () => {
    expect(await markRead({ add_labels: ["STARRED"] })).toEqual({ addLabelIds: ["STARRED"] });
  });

  it("remove_labels alone: removes exactly those", async () => {
    expect(await markRead({ remove_labels: ["INBOX"] })).toEqual({ removeLabelIds: ["INBOX"] });
  });

  it("both: exactly what was asked", async () => {
    expect(await markRead({ add_labels: ["Label_1"], remove_labels: ["INBOX", "UNREAD"] })).toEqual({
      addLabelIds: ["Label_1"],
      removeLabelIds: ["INBOX", "UNREAD"],
    });
  });

  it("add_labels UNREAD marks unread, and is not undone in the same request", async () => {
    expect(await markRead({ add_labels: ["UNREAD"] })).toEqual({ addLabelIds: ["UNREAD"] });
  });

  it("the batch form follows the same rule", async () => {
    const { client, calls } = fakeClient([{ data: "" }]);
    await handleGmail(client, "gmail_mark_read", { message_ids: ["a", "b"], add_labels: ["STARRED"] });
    expect(calls[0].jsonBody).toEqual({ ids: ["a", "b"], addLabelIds: ["STARRED"] });
  });
});
