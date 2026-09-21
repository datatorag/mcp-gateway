/**
 * The send guard (SCRUM-303). Every rule gets a case that it refuses and,
 * where the rule could be satisfied trivially, a control it allows.
 *
 * The addresses here are invented. A real mailbox must never appear in this
 * repo, and a mangled prefix of a real one is still evidence of it.
 */

import { describe, expect, it, vi } from "vitest";
import { checkSend, SUBJECT_PREFIX, type GuardLookups } from "./send-guard";
import { parseAddressList, AddressParseError } from "./address-list";

const READER = "reader@example.test";
const STRANGER = "someone.else@example.test";
const SUBJECT = `${SUBJECT_PREFIX} round trip`;

/** A readable original, so the branches that read one are exercised rather
 * than refused for want of a message. `from` is the reader, which is the
 * permitted address in the default configuration. */
const ORIGINAL = {
  to: READER,
  from: READER,
  subject: SUBJECT,
  cc: undefined,
  bcc: undefined,
  replyTo: undefined,
};

const lookups = (over: Partial<GuardLookups> = {}): GuardLookups => ({
  readDraft: vi.fn().mockResolvedValue(null),
  readMessage: vi.fn().mockResolvedValue(ORIGINAL),
  ...over,
});

const check = (tool: string, args: Record<string, unknown>, over?: Partial<GuardLookups>, reader: string | null = READER) =>
  checkSend(tool, args, { readerEmail: reader, lookups: lookups(over) });

describe("a tool that is not a send is not this guard's business", () => {
  it.each(["gws-mcp__gmail_search", "gws-mcp__sheets_read", "atlassian-mcp__jira_search"])(
    "%s passes straight through",
    async (tool) => {
      expect(await check(tool, {})).toEqual({ ok: true });
    }
  );
});

describe("the tools that carry recipients in their arguments", () => {
  const tools = [
    "gws-mcp__gmail_send",
    "gws-mcp__gmail_forward",
    "gws-mcp__gmail_create_draft",
    "gws-mcp__gmail_update_draft",
  ];

  it.each(tools)("%s allows the reader with the prefix", async (tool) => {
    // `gmail_forward` takes no subject of its own — it derives one from the
    // message it forwards — so its prefix check reads the ORIGINAL. Giving
    // it `message_id` here is not a workaround; it is what the tool takes.
    const args =
      tool === "gws-mcp__gmail_forward"
        ? { to: READER, message_id: "m-smoke" }
        : { to: READER, subject: SUBJECT };
    expect(await check(tool, args)).toEqual({ ok: true });
  });

  it.each(tools)("%s refuses a stranger in to", async (tool) => {
    const args =
      tool === "gws-mcp__gmail_forward"
        ? { to: STRANGER, message_id: "m-smoke" }
        : { to: STRANGER, subject: SUBJECT };
    const res = await check(tool, args);
    expect(res).toMatchObject({ ok: false });
    expect((res as { reason: string }).reason).toContain("to holds an address");
  });

  it.each(["cc", "bcc"])("refuses a stranger hiding in %s", async (field) => {
    const res = await check("gws-mcp__gmail_send", { to: READER, [field]: STRANGER, subject: SUBJECT });
    expect(res).toMatchObject({ ok: false });
    expect((res as { reason: string }).reason).toContain(field);
  });

  it("allows the reader repeated across to, cc and bcc", async () => {
    expect(
      await check("gws-mcp__gmail_send", { to: READER, cc: READER, bcc: READER, subject: SUBJECT })
    ).toEqual({ ok: true });
  });

  it("refuses a subject with no prefix", async () => {
    const res = await check("gws-mcp__gmail_send", { to: READER, subject: "hello" });
    expect((res as { reason: string }).reason).toContain(SUBJECT_PREFIX);
  });

  it("refuses an empty recipient list, which would otherwise pass vacuously", async () => {
    // Every address in an empty list is the reader, so a loop-only check
    // says yes. This is the case that catches that.
    const res = await check("gws-mcp__gmail_send", { to: "", subject: SUBJECT });
    expect((res as { reason: string }).reason).toContain("no recipient");
  });

  it("refuses when no reader is mapped at all", async () => {
    const res = await check("gws-mcp__gmail_send", { to: READER, subject: SUBJECT }, {}, null);
    expect((res as { reason: string }).reason).toContain("no reader mailbox is mapped");
  });

  it("accepts a display name and compares only the address", async () => {
    expect(
      await check("gws-mcp__gmail_send", { to: `Smoke Reader <${READER}>`, subject: SUBJECT })
    ).toEqual({ ok: true });
  });

  it("is not fooled by a quoted display name containing a comma", async () => {
    // The reason this parses rather than splits: a naive split makes two
    // entries out of one address, and the first parses as nothing.
    const res = await check("gws-mcp__gmail_send", {
      to: `"Reader, Smoke" <${READER}>, ${STRANGER}`,
      subject: SUBJECT,
    });
    expect(res).toMatchObject({ ok: false });
    expect((res as { reason: string }).reason).toContain("to holds an address");
  });

  it("refuses a recipient field it cannot parse rather than skipping it", async () => {
    const res = await check("gws-mcp__gmail_send", { to: `"unterminated <${READER}>`, subject: SUBJECT });
    expect((res as { reason: string }).reason).toContain("could not be parsed");
  });
});

describe("gmail_send_draft reads the STORED draft", () => {
  it("allows a stored draft addressed to the reader", async () => {
    const readDraft = vi.fn().mockResolvedValue({ to: READER, subject: SUBJECT });
    expect(await check("gws-mcp__gmail_send_draft", { draft_id: "d1" }, { readDraft })).toEqual({ ok: true });
    expect(readDraft).toHaveBeenCalledWith("d1");
  });

  it("refuses a draft that was edited to a stranger after it was created", async () => {
    // The whole reason this reads the stored object: the arguments the draft
    // was CREATED with passed the guard, and are not what will be sent.
    const readDraft = vi.fn().mockResolvedValue({ to: STRANGER, subject: SUBJECT });
    const res = await check("gws-mcp__gmail_send_draft", { draft_id: "d1" }, { readDraft });
    expect(res).toMatchObject({ ok: false });
  });

  it("refuses a stranger added to the stored bcc", async () => {
    const readDraft = vi.fn().mockResolvedValue({ to: READER, bcc: STRANGER, subject: SUBJECT });
    expect(await check("gws-mcp__gmail_send_draft", { draft_id: "d1" }, { readDraft })).toMatchObject({ ok: false });
  });

  it("refuses when the draft cannot be read, rather than assuming it is fine", async () => {
    const res = await check("gws-mcp__gmail_send_draft", { draft_id: "gone" });
    expect((res as { reason: string }).reason).toContain("could not be read");
  });
});

describe("gmail_reply reads the message being answered", () => {
  it("allows a reply to a message from the reader", async () => {
    const readMessage = vi.fn().mockResolvedValue({ from: READER, subject: `Re: ${SUBJECT}` });
    expect(await check("gws-mcp__gmail_reply", { message_id: "m1" }, { readMessage })).toEqual({ ok: true });
  });

  it("prefers Reply-To over From, because that is where a reply goes", async () => {
    const readMessage = vi.fn().mockResolvedValue({ from: READER, replyTo: STRANGER, subject: SUBJECT });
    expect(await check("gws-mcp__gmail_reply", { message_id: "m1" }, { readMessage })).toMatchObject({ ok: false });
  });

  it("refuses a reply to a message from a stranger", async () => {
    const readMessage = vi.fn().mockResolvedValue({ from: STRANGER, subject: SUBJECT });
    expect(await check("gws-mcp__gmail_reply", { message_id: "m1" }, { readMessage })).toMatchObject({ ok: false });
  });

  it("refuses when the original's subject does not carry the prefix", async () => {
    const readMessage = vi.fn().mockResolvedValue({ from: READER, subject: "unrelated thread" });
    const res = await check("gws-mcp__gmail_reply", { message_id: "m1" }, { readMessage });
    expect((res as { reason: string }).reason).toContain(SUBJECT_PREFIX);
  });

  it("refuses when the original cannot be read", async () => {
    const res = await check("gws-mcp__gmail_reply", { message_id: "m1" }, {
      readMessage: vi.fn().mockResolvedValue(null),
    });
    expect((res as { reason: string }).reason).toContain("could not be read");
  });
});

describe("gws_run, the generic escape hatch", () => {
  it.each([
    ["gmail", "users.messages", "send"],
    ["gmail", "users.drafts", "send"],
    ["gmail", "users.messages", "import"],
    ["gmail", "users.messages", "insert"],
    ["gmail", "users.settings.forwardingAddresses", "create"],
    ["gmail", "users.settings.filters", "create"],
    ["gmail", "users.settings.sendAs", "create"],
    ["gmail", "users.settings.delegates", "create"],
    ["drive", "permissions", "create"],
    ["calendar", "events", "delete"],
    ["calendar", "events", "insert"],
  ])("refuses %s %s.%s", async (service, resource, method) => {
    const res = await check("gws-mcp__gws_run", { service, resource, method });
    expect(res).toMatchObject({ ok: false });
  });

  it.each([
    ["gmail", "users.messages", "list"],
    ["gmail", "users.messages", "get"],
    ["sheets", "spreadsheets", "get"],
    ["drive", "files", "list"],
  ])("allows the read %s %s.%s, so the refusals above are not blanket", async (service, resource, method) => {
    expect(await check("gws-mcp__gws_run", { service, resource, method })).toEqual({ ok: true });
  });

  it.each(["Gmail", "GMAIL", " gmail ", "gMaIl"])(
    "refuses a send through %j, because a caller chooses the spelling",
    async (service) => {
      // An exact-string lookup is a guard that any other case walks straight
      // past, and nothing promises the plugin normalises this for us.
      expect(
        await check("gws-mcp__gws_run", { service, resource: "users.messages", method: "send" })
      ).toMatchObject({ ok: false });
    }
  );

  it.each([
    ["chat", "spaces.messages", "create"],
    ["admin", "users", "insert"],
    ["groupssettings", "groups", "update"],
    ["people", "people", "createContact"],
  ])("refuses %s %s.%s, a service the denylist has never heard of", async (service, resource, method) => {
    // A denylist that does not know a service allows everything in it, and
    // gws_run reaches every Google API. Unknown services may only read.
    const res = await check("gws-mcp__gws_run", { service, resource, method });
    expect(res).toMatchObject({ ok: false });
    expect((res as { reason: string }).reason).toContain("may only read");
  });

  it.each([
    ["chat", "spaces", "list"],
    ["admin", "users", "get"],
    ["tasks", "tasks", "list"],
  ])("still allows the read %s %s.%s", async (service, resource, method) => {
    expect(await check("gws-mcp__gws_run", { service, resource, method })).toEqual({ ok: true });
  });

  it.each(["gmail", "Gmail", " GMAIL "])(
    "names the hazard for %j, rather than giving the generic read refusal",
    async (service) => {
      // What the normalisation is for now that every service is read-only:
      // a send gets the specific refusal naming the service and method, not
      // the catch-all. Both refuse, so this is about the message a failing
      // case shows a person.
      const res = await check("gws-mcp__gws_run", {
        service,
        resource: "users.messages",
        method: "send",
      });
      expect((res as { reason: string }).reason).toContain("may not reach gmail");
    }
  );

  it.each([
    ["calendar", "events", "move"],
    ["calendar", "events", "quickAdd"],
    ["gmail", "users.labels", "create"],
    ["sheets", "spreadsheets", "batchUpdate"],
    ["drive", "files", "create"],
  ])("refuses the write %s %s.%s even in a service the denylist knows", async (service, resource, method) => {
    // The hole this closes: a known service whose method missed the pattern
    // went straight through. events.move carries sendUpdates and mails an
    // existing event's attendees, and it matched nothing.
    const res = await check("gws-mcp__gws_run", { service, resource, method });
    expect(res).toMatchObject({ ok: false });
    expect((res as { reason: string }).reason).toContain("may only read");
  });

  it("refuses a gws_run with no service named at all", async () => {
    expect(await check("gws-mcp__gws_run", { resource: "x", method: "create" })).toMatchObject({ ok: false });
  });
});

describe("calendar invitations, updates and cancellations are sends", () => {
  it("allows an event with no attendees and no notifications", async () => {
    expect(
      await check("gws-mcp__calendar_create_event", { summary: SUBJECT, send_updates: "none" })
    ).toEqual({ ok: true });
  });

  it("reads the attendee list as the COMMA-SEPARATED STRING the tool takes", async () => {
    // The shape that matters. An earlier version tested Array.isArray, so a
    // real call skipped the check entirely and the guard was inert against
    // the only shape it would ever see.
    expect(
      await check("gws-mcp__calendar_create_event", { attendees: READER, send_updates: "none" })
    ).toEqual({ ok: true });
  });

  it("refuses a stranger given as a bare string, the real argument shape", async () => {
    expect(
      await check("gws-mcp__calendar_create_event", { attendees: STRANGER, send_updates: "none" })
    ).toMatchObject({ ok: false });
  });

  it("refuses a stranger hiding in a comma-separated list", async () => {
    expect(
      await check("gws-mcp__calendar_create_event", {
        attendees: `${READER}, ${STRANGER}`,
        send_updates: "none",
      })
    ).toMatchObject({ ok: false });
  });

  it.each([
    ["a string entry holding two addresses", [`${READER}, ${STRANGER}`]],
    ["an object entry holding two addresses", [{ email: `${READER}, ${STRANGER}` }]],
    ["a stranger in the second entry", [READER, STRANGER]],
  ])("refuses %s, rather than reading only the first", async (_label, attendees) => {
    // Keeping only the first parsed address is exactly how the string
    // branch's bug got reintroduced in the array branch: the entry reported
    // one address, matched the reader, and passed with a stranger on it.
    expect(
      await check("gws-mcp__calendar_create_event", { attendees, send_updates: "none" })
    ).toMatchObject({ ok: false });
  });

  it.each([
    ["a quoted comma hiding a second address", `"Doe, ${STRANGER}" <${READER}>`],
    ["a comment hiding one", `${READER}(${STRANGER})`],
  ])("refuses %s, because the tool splits on commas and would read it differently", async (_label, attendees) => {
    // The guard parses RFC 5322 and the tool does a plain split, so these
    // two disagree about how many addresses are present. Refusing is the
    // only answer that does not depend on which one is right.
    expect(
      await check("gws-mcp__calendar_create_event", { attendees, send_updates: "none" })
    ).toMatchObject({ ok: false });
  });

  it("accepts an array shape too, without requiring one", async () => {
    expect(
      await check("gws-mcp__calendar_create_event", {
        attendees: [{ email: READER }],
        send_updates: "none",
      })
    ).toEqual({ ok: true });
  });

  it("refuses an attendee list it cannot parse", async () => {
    const res = await check("gws-mcp__calendar_create_event", {
      attendees: `"unterminated <${READER}>`,
      send_updates: "none",
    });
    expect((res as { reason: string }).reason).toContain("could not be parsed");
  });

  it.each([
    "gws-mcp__calendar_create_event",
    "gws-mcp__calendar_update_event",
    "gws-mcp__calendar_delete_event",
  ])("%s refuses to notify, because the tool defaults send_updates to all", async (tool) => {
    // Verified against the plugin's own handler: send_updates arrives through
    // a spread and defaults to "all", so omitting it mails every attendee.
    const res = await check(tool, { attendees: READER });
    expect((res as { reason: string }).reason).toContain("send_updates none");
  });

  it.each(["all", "externalOnly", ""])("refuses send_updates %j", async (value) => {
    expect(
      await check("gws-mcp__calendar_create_event", { attendees: READER, send_updates: value })
    ).toMatchObject({ ok: false });
  });

  it("guards a cancellation, which has no attendee argument to check at all", async () => {
    expect(
      await check("gws-mcp__calendar_delete_event", { event_id: "e1", send_updates: "none" })
    ).toEqual({ ok: true });
    expect(await check("gws-mcp__calendar_delete_event", { event_id: "e1" })).toMatchObject({ ok: false });
  });
});

describe("the denylist lookup cannot be steered by a prototype key", () => {
  it.each(["constructor", "__proto__", "toString"])("refuses a write through %j", async (service) => {
    // A bare lookup on an object literal returns something truthy and not a
    // regex for these, and `.test` then throws where a refusal belongs.
    const res = await check("gws-mcp__gws_run", { service, resource: "x", method: "create" });
    expect(res).toMatchObject({ ok: false });
  });
});

describe("the address parser on its own", () => {
  it("keeps a comma inside a quoted display name", () => {
    const parsed = parseAddressList(`"Reader, Smoke" <${READER}>`);
    expect(parsed.map((p) => p.address)).toEqual([READER]);
  });

  it("reads several addresses", () => {
    expect(parseAddressList(`${READER}, Smoke <${STRANGER}>`).map((p) => p.address)).toEqual([READER, STRANGER]);
  });

  it("treats an absent header as no addresses, not as an error", () => {
    expect(parseAddressList(undefined)).toEqual([]);
    expect(parseAddressList("")).toEqual([]);
  });

  it.each([
    ["an unterminated quote", `"Reader <${READER}>`],
    ["a group syntax with no address", "undisclosed-recipients:;"],
    ["a bare word", "nobody"],
    ["two @ signs", "a@b@example.test"],
    ["a domain with no dot", "reader@localhost"],
    ["trailing text after the angle brackets", `<${READER}> and friends`],
    ["an empty entry between commas", `${READER}, , ${READER}`],
  ])("refuses %s", (_label, input) => {
    expect(() => parseAddressList(input)).toThrow(AddressParseError);
  });
});

/**
 * THE TWO WIDENINGS, ruled by HQ on 2026-09-20, each pinned in both
 * directions. A widening nobody can see the edge of is not a widening, it
 * is a hole.
 */
describe("the sender mailbox, for reply and forward only", () => {
  const reader = "reader@example.test";
  const sender = "sender@example.test";
  const lookups = {
    readDraft: async () => null,
    readMessage: async () => ({
      to: reader,
      from: sender,
      subject: "[smoke] original",
      replyTo: undefined,
      cc: undefined,
      bcc: undefined,
    }),
  };

  it("ALLOWS a reply that goes back to the configured sender", async () => {
    // D12 cannot exist otherwise: proving a reply lands in the same thread
    // needs a message to travel back to us.
    const verdict = await checkSend(
      "gws-mcp__gmail_reply",
      { message_id: "m1", body: "x" },
      { readerEmail: reader, senderEmail: sender, lookups }
    );
    expect(verdict.ok).toBe(true);
  });

  it("REFUSES that same reply when no sender is configured", async () => {
    const verdict = await checkSend(
      "gws-mcp__gmail_reply",
      { message_id: "m1", body: "x" },
      { readerEmail: reader, senderEmail: null, lookups }
    );
    expect(verdict.ok).toBe(false);
  });

  it("ALLOWS a forward to the configured sender", async () => {
    const verdict = await checkSend(
      "gws-mcp__gmail_forward",
      { message_id: "m1", to: sender, subject: "[smoke] fwd" },
      { readerEmail: reader, senderEmail: sender, lookups }
    );
    expect(verdict.ok).toBe(true);
  });

  it("STILL REFUSES gmail_send to the sender, because the widening is reply and forward only", async () => {
    const verdict = await checkSend(
      "gws-mcp__gmail_send",
      { to: sender, subject: "[smoke] x" },
      { readerEmail: reader, senderEmail: sender, lookups }
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("not the reader mailbox");
  });

  it("STILL REFUSES a stored draft addressed to the sender", async () => {
    const verdict = await checkSend(
      "gws-mcp__gmail_send_draft",
      { draft_id: "d1" },
      {
        readerEmail: reader,
        senderEmail: sender,
        lookups: {
          readDraft: async () => ({
            to: sender,
            subject: "[smoke] x",
            cc: undefined,
            bcc: undefined,
            from: undefined,
            replyTo: undefined,
          }),
          readMessage: async () => null,
        },
      }
    );
    expect(verdict.ok).toBe(false);
  });

  it("STILL REFUSES a forward to a stranger", async () => {
    const verdict = await checkSend(
      "gws-mcp__gmail_forward",
      { message_id: "m1", to: "stranger@elsewhere.test", subject: "[smoke] x" },
      { readerEmail: reader, senderEmail: sender, lookups }
    );
    expect(verdict.ok).toBe(false);
  });
});

describe("the one gws_run write", () => {
  const opts = {
    readerEmail: "reader@example.test",
    senderEmail: "sender@example.test",
    lookups: { readDraft: async () => null, readMessage: async () => null },
  };

  it("ALLOWS trashing a message the helper has stamp-verified", async () => {
    const verdict = await checkSend(
      "gws-mcp__gws_run",
      { service: "gmail", resource: "users.messages", method: "trash", params: { id: "m1" } },
      { ...opts, trashable: new Set(["m1"]) }
    );
    expect(verdict.ok).toBe(true);
  });

  it("REFUSES a trash the helper did not authorise, which is the whole point", async () => {
    /* The first version of this allowance said yes to any id, and the stamp
     * check lived in a helper nothing obliged a case to call. A case could
     * assemble the call itself and trash arbitrary mail in a real mailbox,
     * with a source grep as the only thing in the way. The guard enforces it
     * now, so this is the direction that matters. */
    for (const trashable of [undefined, new Set<string>(), new Set(["a-different-id"])]) {
      const verdict = await checkSend(
        "gws-mcp__gws_run",
        { service: "gmail", resource: "users.messages", method: "trash", params: { id: "m1" } },
        { ...opts, trashable }
      );
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toContain("trashOwnMessage");
    }
  });

  it("REFUSES a trash that names no message", async () => {
    const verdict = await checkSend(
      "gws-mcp__gws_run",
      { service: "gmail", resource: "users.messages", method: "trash", params: {} },
      { ...opts, trashable: new Set(["m1"]) }
    );
    expect(verdict.ok).toBe(false);
  });

  it("REFUSES every other gmail write, including delete", async () => {
    for (const method of ["delete", "send", "insert", "import", "batchDelete", "untrash"]) {
      const verdict = await checkSend(
        "gws-mcp__gws_run",
        { service: "gmail", resource: "users.messages", method },
        opts
      );
      expect(verdict.ok, `gmail users.messages.${method} must be refused`).toBe(false);
    }
  });

  it("REFUSES trash on another service and another resource", async () => {
    // The allowance is one service, one resource, one verb. Anything that
    // reads as "trash" elsewhere is still a write and still refused.
    for (const args of [
      { service: "drive", resource: "files", method: "trash" },
      { service: "gmail", resource: "users.threads", method: "trash" },
      { service: "gmail", resource: "users.settings", method: "trash" },
    ]) {
      const verdict = await checkSend("gws-mcp__gws_run", args, opts);
      expect(verdict.ok, `${args.service} ${args.resource}.${args.method} must be refused`).toBe(false);
    }
  });

  it("still lets reads through and still refuses the settings paths", async () => {
    expect((await checkSend("gws-mcp__gws_run", { service: "gmail", resource: "users.messages", method: "get" }, opts)).ok).toBe(true);
    expect((await checkSend("gws-mcp__gws_run", { service: "gmail", resource: "users.settings", method: "update" }, opts)).ok).toBe(false);
  });
});

/**
 * THE HOLE THE GATE FOUND, pinned in the direction that was missing.
 *
 * The guard resolved a reply's recipient as `replyTo ?? from`, reasoning
 * that a reply goes where Reply-To points. `gmail_reply` does not agree: it
 * composes `To:` from the original's `From` alone and never reads Reply-To.
 * So an original with `From: <stranger>`, `Reply-To: <our sender>` and a
 * smoke subject passed the guard and would have been replied to at the
 * stranger's address — and the reader mailbox takes outside mail, so both
 * headers are somebody else's to set.
 *
 * The old test pinned only the harmless direction and wrote the false
 * reasoning into a comment, which is how it survived review twice.
 */
describe("a reply is addressed by From, not by Reply-To", () => {
  const reader = "reader@example.test";
  const sender = "sender@example.test";
  const stranger = "stranger@elsewhere.test";

  const replyTo = (original: Record<string, unknown>) =>
    checkSend(
      "gws-mcp__gmail_reply",
      { message_id: "m1", body: "x" },
      {
        readerEmail: reader,
        senderEmail: sender,
        lookups: {
          readDraft: async () => null,
          readMessage: async () => original as never,
        },
      }
    );

  it("REFUSES a stranger's message that points Reply-To at us", async () => {
    const verdict = await replyTo({
      from: stranger,
      replyTo: sender,
      subject: `${SUBJECT_PREFIX} looks legitimate`,
    });
    expect(verdict.ok).toBe(false);
  });

  it("REFUSES our own message that points Reply-To at a stranger", async () => {
    // The mirror. A tool that ever starts honouring Reply-To must not
    // silently widen this, so both headers have to be permitted.
    const verdict = await replyTo({
      from: sender,
      replyTo: stranger,
      subject: `${SUBJECT_PREFIX} looks legitimate`,
    });
    expect(verdict.ok).toBe(false);
  });

  it("ALLOWS our own message with no Reply-To at all", async () => {
    const verdict = await replyTo({
      from: sender,
      replyTo: undefined,
      subject: `${SUBJECT_PREFIX} ordinary`,
    });
    expect(verdict.ok).toBe(true);
  });

  it("ALLOWS our own message whose Reply-To is also ours", async () => {
    const verdict = await replyTo({
      from: sender,
      replyTo: reader,
      subject: `${SUBJECT_PREFIX} ordinary`,
    });
    expect(verdict.ok).toBe(true);
  });
});

/**
 * THE ONE READ PERMITTED UNDER `settings`, ruled by HQ 2026-09-20 so E13 can
 * assert the signature a message carries is the ACCOUNT'S OWN rather than
 * merely present. The settings denylist guards against writes — a
 * forwarding address or a filter with a forward action sends every future
 * message to a stranger without looking like a send — and a read of which
 * addresses an account may send as cannot send anything.
 *
 * Both directions, because an allowance nobody can see the edge of is a
 * hole. The refusals below are the edge.
 */
describe("gws_run and the gmail settings tree", () => {
  const opts = {
    readerEmail: "reader@example.test",
    senderEmail: "sender@example.test",
    lookups: { readDraft: async () => null, readMessage: async () => null },
  };
  const run = (resource: string, method: string, service = "gmail") =>
    checkSend("gws-mcp__gws_run", { service, resource, method }, opts);

  it.each([
    ["users.settings.sendAs", "list"],
    ["users.settings.sendAs", "get"],
    ["users.settings.sendas", "LIST"],
  ])("ALLOWS reading %s.%s", async (resource, method) => {
    expect((await run(resource, method)).ok).toBe(true);
  });

  it.each(["update", "patch", "create", "delete", "insert"])(
    "REFUSES sendAs.%s, which is how an account is made to send as somebody else",
    async (method) => {
      expect((await run("users.settings.sendAs", method)).ok).toBe(false);
    }
  );

  it.each([
    ["users.settings.forwardingAddresses", "list"],
    ["users.settings.filters", "list"],
    ["users.settings", "get"],
    ["users.settings.delegates", "list"],
  ])("REFUSES %s.%s, because only sendAs was opened", async (resource, method) => {
    // The allowance is two exact paths. A pattern over `settings.sendas`
    // would have admitted its writes; a pattern over `settings` would have
    // admitted the forwarding tree, which is the original hazard.
    expect((await run(resource, method)).ok).toBe(false);
  });

  it("grants no WRITE on another service, which is the only thing it could have leaked", async () => {
    /* The first version of this asserted that the same READ is refused on
     * drive. That is false and it was testing the wrong thing: gws_run
     * already permits reads on every service, so a drive read passing says
     * nothing about this carve-out. What the carve-out must not do is
     * carry write permission anywhere, so that is what is asserted. */
    expect((await run("users.settings.sendAs", "update", "drive")).ok).toBe(false);
    expect((await run("files", "update", "drive")).ok).toBe(false);
  });
});

/**
 * THE THREE RESIDUALS THE SECOND GATE NAMED, closed. None was reachable by
 * any case in the batch; all three were the guard promising more than it
 * delivered, which is the shape of defect that gets believed.
 */
describe("the guard and the tool must agree", () => {
  const reader = "reader@example.test";
  const sender = "sender@example.test";
  const stranger = "stranger@evil.test";

  const replyTo = (from: string) =>
    checkSend(
      "gws-mcp__gmail_reply",
      { message_id: "m1", body: "x" },
      {
        readerEmail: reader,
        senderEmail: sender,
        lookups: {
          readDraft: async () => null,
          readMessage: async () =>
            ({ from, subject: `${SUBJECT_PREFIX} x`, replyTo: undefined }) as never,
        },
      }
    );

  it("REFUSES a From the tool reads differently than this guard does", async () => {
    /* The guard parses RFC 5322 and takes the first address, ignoring
     * comments; the tool takes the LAST angle pair and does not know what a
     * comment is. On this header they disagree, and the tool's reading is
     * the one that gets mailed. */
    for (const from of [
      `<${reader}> (<${stranger}>)`,
      `${reader} (<${stranger}>)`,
      `"${sender}" <${sender}> <${stranger}>`,
    ]) {
      const verdict = await replyTo(from);
      expect(verdict.ok, `${from} must be refused`).toBe(false);
    }
  });

  it("still ALLOWS the ordinary forms both read the same way", async () => {
    for (const from of [sender, `<${sender}>`, `Someone <${sender}>`]) {
      const verdict = await replyTo(from);
      expect(verdict.ok, `${from} must be allowed`).toBe(true);
    }
  });
});

describe("gws_run and a write verb hidden in the resource path", () => {
  const opts = {
    readerEmail: "reader@example.test",
    senderEmail: "sender@example.test",
    lookups: { readDraft: async () => null, readMessage: async () => null },
  };

  it("REFUSES a write verb anywhere in the path, not just as the method", async () => {
    /* The client builds its argv as [service, ...resource.split("."),
     * method], so the verb the CLI resolves need not be the one in
     * `method`. Checking only the method let `users.messages.send` with
     * method `get` read as a permitted READ while the argv carried `send`.
     * The comment promising gws_run may only read was wider than the code. */
    for (const resource of [
      "users.messages.send",
      "users.messages.delete",
      "users.settings.forwardingAddresses.create",
      "users.drafts.send",
    ]) {
      const verdict = await checkSend(
        "gws-mcp__gws_run",
        { service: "gmail", resource, method: "get" },
        opts
      );
      expect(verdict.ok, `${resource} must be refused`).toBe(false);
    }
  });

  it("still ALLOWS ordinary noun resources with a read method", async () => {
    for (const resource of ["users.messages", "users.drafts", "users.labels"]) {
      const verdict = await checkSend(
        "gws-mcp__gws_run",
        { service: "gmail", resource, method: "get" },
        opts
      );
      expect(verdict.ok, `${resource} must be allowed`).toBe(true);
    }
  });
});
