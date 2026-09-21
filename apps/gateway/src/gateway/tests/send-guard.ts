import { AddressParseError, parseAddressList } from "./address-list";

/**
 * The send guard (SCRUM-303): the one place that decides whether a case may
 * put a message in front of a person.
 *
 * It lives in `ctx.call`, not in each case, because a rule repeated in fifty
 * cases is a rule that holds in forty-nine. A case cannot name an account at
 * all (the runner injects it from the role map), and it cannot reach a send
 * except through this function.
 *
 * THE RULE: every recipient is the `reader` mailbox, and the subject carries
 * the `[smoke]` prefix. Anything else is refused before dispatch.
 *
 * WHAT IT CANNOT SEE, stated because a guard whose limits are undocumented
 * gets trusted past them: it inspects arguments and, for the two tools whose
 * recipients are not in their arguments, the stored object. It cannot reason
 * about a document's contents, so a Docs comment body that @-mentions
 * someone is outside it. The mitigation there is that no case creates such a
 * comment, not that this function would stop one.
 */

export const SUBJECT_PREFIX = "[smoke]";

export type SendCheck = { ok: true } | { ok: false; reason: string };

/** Headers of a stored object, read at the moment of the send. */
export type StoredRecipients = {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  from?: string;
  replyTo?: string;
};

export interface GuardLookups {
  /** The stored draft, read at SEND time. The arguments a draft was created
   * with are not trusted: a draft can be edited between the two calls. */
  readDraft(draftId: string): Promise<StoredRecipients | null>;
  /** The message a reply would answer, since a reply carries no recipient
   * argument of its own. */
  readMessage(messageId: string): Promise<StoredRecipients | null>;
}

/**
 * The addresses a given tool may reach.
 *
 * The reader always. The configured SENDER as well, for `gmail_reply` and
 * `gmail_forward` only, ruled by HQ on 2026-09-20: D12 proves a reply lands
 * in the same thread, which needs a message to travel back to us, and no
 * restructuring avoids that. It is an allowlist of two configured
 * addresses, never a relaxation — `gmail_send`, the drafts and everything
 * else still reach the reader and nothing else.
 */
const SENDER_REACHABLE = new Set(["gmail_reply", "gmail_forward"]);

function permittedFor(name: string, reader: string, sender: string | null): Set<string> {
  const permitted = new Set([reader]);
  if (sender && SENDER_REACHABLE.has(name)) permitted.add(sender);
  return permitted;
}

/** Tools whose arguments carry the recipients directly. */
const ARG_RECIPIENT_TOOLS = new Set([
  "gmail_send",
  "gmail_forward",
  "gmail_create_draft",
  "gmail_update_draft",
]);

/** `gws_run` is the generic escape hatch, so it is guarded by SERVICE and
 * METHOD rather than by tool name. Sending is the obvious half; the settings
 * half matters just as much, because a forwarding address or a filter with a
 * forward action sends every future message to a stranger without ever
 * looking like a send. */
const GWS_RUN_FORBIDDEN: Record<string, RegExp> = {
  gmail: /(^|\.)(send|import|insert)$|(^|\.)settings\.|forwardingaddresses|sendas|delegates|filters/i,
  drive: /permissions\.(create|update)/i,
  calendar: /(^|\.)(insert|update|patch|import|delete)$/i,
};

/**
 * `gws_run` MAY ONLY READ. Every service, known or not.
 *
 * This started as a denylist of three services and that was the wrong shape
 * twice over. A denylist cannot cover a tool that reaches every Google API,
 * so Chat and Admin were unguarded; and even within a service it knew, a
 * method the pattern missed went straight through. `calendar events.move`
 * carries sendUpdates and mails an existing event's attendees, and it
 * matched nothing.
 *
 * So the rule is inverted: the verbs below fetch, and anything else is
 * refused. The denylist survives as the FIRST answer for the cases where a
 * specific refusal reads better than a generic one, and as a record of what
 * was known to be dangerous. It no longer carries the guarantee.
 *
 * The cost is that a case needing a non-read through `gws_run` has to be
 * allowed for deliberately. That is the right cost: every write these cases
 * actually perform has a dedicated tool, and `gws_run` is the fallback for
 * surfaces nobody has wrapped yet.
 */
/**
 * Verbs that are never a read, wherever they appear in a path.
 *
 * Deliberately a denylist HERE, unlike the read allowlist below, and the
 * difference matters: the allowlist decides whether a call proceeds and so
 * has to fail closed, while this one only catches a verb hiding in a
 * position the allowlist does not inspect. An unknown segment is still
 * refused by the allowlist on the method.
 */
/**
 * The address the REPLY TOOL will actually use, extracted the way the tool
 * extracts it.
 *
 * The guard parses `From` as RFC 5322 and takes the first address, ignoring
 * comments. The tool takes the LAST angle pair and does not know what a
 * comment is. Those disagree on a header somebody else can write:
 * `From: <reader@ours.test> (<stranger@evil.test>)` parses as ours and
 * composes to the stranger.
 *
 * Rather than argue about which reading is correct, the guard now computes
 * BOTH and requires them to agree. RFC parsing catches malformed input;
 * this catches the case where the tool and the standard differ, which is
 * the one an attacker gets to choose. If the tool's extraction ever
 * changes, this mirror has to change with it — a comment in the tool's repo
 * says so too.
 */
export function addressAsTheToolReadsIt(from: string): string {
  const safe = from.replace(/[\r\n]+/g, " ");
  const open = safe.lastIndexOf("<");
  if (open === -1) return safe.trim().toLowerCase();
  const close = safe.indexOf(">", open);
  if (close === -1) return safe.trim().toLowerCase();
  return safe.slice(open + 1, close).trim().toLowerCase();
}

const WRITE_VERBS = new Set([
  "send",
  "delete",
  "batchdelete",
  "trash",
  "untrash",
  "insert",
  "create",
  "update",
  "patch",
  "modify",
  "batchmodify",
  "import",
  "move",
  "copy",
  "stop",
  "watch",
  "setup",
  "enable",
  "disable",
]);

const READ_METHODS = new Set([
  "get",
  "list",
  "search",
  "query",
  "export",
  "batchget",
  "aboutget",
  "getprofile",
]);

function toolSuffix(tool: string): string {
  const i = tool.indexOf("__");
  return i === -1 ? tool : tool.slice(i + 2);
}

/** Tools that mail every attendee unless told not to. `delete` is in here
 * because a cancellation is a message too, and it carries no attendee
 * argument to check. */
const CALENDAR_NOTIFYING_TOOLS = new Set([
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event",
]);

/**
 * Attendee addresses, lowercased, or null if the field cannot be read.
 *
 * The tool's own shape is a comma-separated STRING, so that is the case that
 * matters; an array is accepted too rather than refused, because refusing a
 * shape the tool might grow would be a guard that fails open the day it
 * changes. Anything unparseable is null, which refuses.
 */
function attendeeAddresses(value: unknown): string[] | null {
  if (value === undefined || value === null || value === "") return [];
  try {
    // The tool splits this field on commas and nothing else, so a quoted
    // comma or a comment means the guard and the tool disagree about how
    // many addresses are here. Refuse those outright rather than resolve the
    // disagreement in either direction: the tool cannot express them anyway.
    if (typeof value === "string") {
      if (/["'()]/.test(value)) throw new AddressParseError("quotes and comments are not allowed in an attendee list");
      return parseAddressList(value).map((a) => a.address);
    }
    if (Array.isArray(value)) {
      // EVERY address in each entry, not the first. Destructuring the first
      // one is how the string branch's own bug got reintroduced here: an
      // entry of "reader@x, stranger@y" reported one address and passed.
      return value.flatMap((entry) => {
        const raw =
          typeof entry === "string" ? entry : String((entry as Record<string, unknown>)?.email ?? "");
        if (/["'()]/.test(raw)) throw new AddressParseError("quotes and comments are not allowed in an attendee list");
        const parsed = parseAddressList(raw);
        if (parsed.length === 0) throw new AddressParseError("an empty attendee");
        return parsed.map((a) => a.address);
      });
    }
  } catch {
    return null;
  }
  return null;
}

function subjectOk(subject: unknown): boolean {
  if (typeof subject !== "string") return false;
  // A reply or forward arrives as "Re: [smoke] ..." or "Fwd: [smoke] ...",
  // so the prefix is required to be PRESENT rather than leading.
  return subject.includes(SUBJECT_PREFIX);
}

function checkRecipients(
  fields: { to?: unknown; cc?: unknown; bcc?: unknown },
  /** The addresses this call may reach. Almost always just the reader; a
   * reply or a forward may also reach the configured sender, because a
   * threading test needs a message to come BACK to us and there is no other
   * way to prove it. Never more than these two, and both are configured. */
  permitted: ReadonlySet<string>,
  /** For the refusal text, which must keep saying "reader mailbox" in the
   * common case rather than becoming vaguer for every caller. */
  describe = "the reader mailbox"
): SendCheck {
  for (const field of ["to", "cc", "bcc"] as const) {
    let parsed;
    try {
      parsed = parseAddressList(fields[field]);
    } catch (err) {
      const why = err instanceof AddressParseError ? err.message : String(err);
      return { ok: false, reason: `send refused: ${field} could not be parsed (${why})` };
    }
    for (const { address } of parsed) {
      if (!permitted.has(address)) {
        return {
          ok: false,
          reason: `send refused: ${field} holds an address that is not ${describe}`,
        };
      }
    }
  }
  const to = (() => {
    try {
      return parseAddressList(fields.to);
    } catch {
      return [];
    }
  })();
  if (to.length === 0) return { ok: false, reason: "send refused: no recipient in to" };
  return { ok: true };
}

/**
 * Refuse, or allow. `readerEmail` of null refuses every send: a run with no
 * reader mapping must not fall back to anything, and a case needing one
 * should have been skipped before it got here.
 */
export async function checkSend(
  tool: string,
  args: Record<string, unknown>,
  opts: {
    readerEmail: string | null;
    senderEmail?: string | null;
    lookups: GuardLookups;
    /** Message ids the trash helper has JUST stamp-verified. See the trash
     * branch below: the guard will not permit a trash for anything else. */
    trashable?: ReadonlySet<string>;
  }
): Promise<SendCheck> {
  const name = toolSuffix(tool);
  const reader = opts.readerEmail?.trim().toLowerCase() ?? null;
  const sender = opts.senderEmail?.trim().toLowerCase() ?? null;

  const needsGuard =
    ARG_RECIPIENT_TOOLS.has(name) ||
    name === "gmail_reply" ||
    name === "gmail_send_draft" ||
    name === "gws_run" ||
    CALENDAR_NOTIFYING_TOOLS.has(name);

  if (!needsGuard) return { ok: true };

  if (name === "gws_run") {
    // Normalised before the lookup. An exact-string lookup against a value a
    // caller supplies is a guard that "Gmail" walks past, and the plugin
    // does not promise a case.
    const service = String(args.service ?? "").trim().toLowerCase();
    const verb = String(args.method ?? "").trim().toLowerCase();
    const path = `${String(args.resource ?? "").trim().toLowerCase()}.${verb}`;

    /* THE ONE READ PERMITTED UNDER `settings`, ruled by HQ 2026-09-20.
     *
     * The settings denylist exists because a forwarding address, or a
     * filter with a forward action, sends every future message to a
     * stranger without ever looking like a send. That hazard is about
     * WRITES. Reading which addresses the account can send as cannot send
     * anything, and E13 needs it to assert that the signature a message
     * carries is the account's own rather than merely present.
     *
     * TWO EXACT PATHS, not a pattern. `users.settings.sendas` with a
     * pattern would also admit `.update`, `.create`, `.patch` and
     * `.delete`, which are the writes that let an account send as somebody
     * else. Listing the two readable verbs by name means a new verb on
     * that resource is refused by default and has to be added
     * deliberately. Everything else under `settings` is untouched. */
    const SETTINGS_READS = new Set(["users.settings.sendas.list", "users.settings.sendas.get"]);
    if (service === "gmail" && SETTINGS_READS.has(path)) {
      return { ok: true };
    }

    // Object.hasOwn, not a bare lookup: `constructor` and `__proto__` are
    // truthy on an object literal and are not regexes, so `forbidden.test`
    // would throw a TypeError where a refusal belongs.
    const forbidden = Object.hasOwn(GWS_RUN_FORBIDDEN, service)
      ? GWS_RUN_FORBIDDEN[service]
      : undefined;
    if (forbidden?.test(path)) {
      // A specific refusal where we have one. The read rule below would
      // refuse this too; this just says why in words that name the hazard.
      return {
        ok: false,
        reason: `send refused: gws_run may not reach ${service} ${path} from a test run`,
      };
    }

    /* THE ONE WRITE `gws_run` MAY MAKE, and it is this narrow on purpose.
     *
     * We ship no tool that trashes a message, so without this every mail
     * case leaves its evidence in two mailboxes for ever: roughly ten
     * messages a run, which is why the smoke sheet runs them weekly and
     * asks for a residue count. HQ ruled the runner may clean up after
     * itself the same way the agent smoke does.
     *
     * It is ONE service, ONE resource and ONE verb. Everything else about
     * `gws_run` is unchanged, including the read allowlist that carries the
     * real guarantee. And it is only reachable through
     * `ctx.trashOwnMessage`, which refuses any message whose subject does
     * not carry this run's own stamp and the smoke prefix — so the blast
     * radius is mail this run sent. A test refuses any case that calls it
     * directly, because that check lives in the source, not here. */
    if (service === "gmail" && path === "users.messages.trash") {
      /* THE GUARD ENFORCES THIS, NOT A COMMENT ABOUT THE HELPER.
       *
       * The first version returned ok for ANY trash with ANY id, and the
       * stamp check that made it safe lived in `ctx.trashOwnMessage` —
       * which nothing obliged a case to use. A case could assemble the call
       * itself and trash arbitrary mail in a real mailbox, with a source
       * grep as the only thing in the way, and any spelling that grep did
       * not anticipate walked past it.
       *
       * So the helper hands the guard the id it has just verified, for that
       * one call. An id the helper did not verify is refused here, where
       * the decision is made, and the guard and the check can no longer
       * drift apart. The grep test stays as belt and braces. */
      const id = String((args.params as Record<string, unknown> | undefined)?.id ?? "").trim();
      if (id === "") return { ok: false, reason: "send refused: a trash call names no message" };
      if (!opts.trashable?.has(id)) {
        return {
          ok: false,
          reason:
            "send refused: a message may only be trashed through trashOwnMessage, which checks it carries this run's stamp",
        };
      }
      return { ok: true };
    }

    /* EVERY SEGMENT, NOT JUST THE LAST ONE.
     *
     * The client builds its argument vector as
     * `[service, ...resource.split("."), method]`, so the verb the CLI ends
     * up resolving does not have to be the one in `method`. Checking only
     * `method` let a write ride in the resource: `users.messages.send` with
     * method `get` read as a permitted read here, while the argv carried
     * `send`. Nothing in this suite does that, and the comment above
     * promising `gws_run` MAY ONLY READ was still wider than the code.
     *
     * A write verb anywhere in the path is now refused, whichever position
     * the CLI resolves. Real resources are nouns — `users.messages`,
     * `users.settings.sendAs` — so a segment that is a write verb has no
     * legitimate reason to be there. */
    const segments = String(args.resource ?? "")
      .trim()
      .toLowerCase()
      .split(".")
      .filter(Boolean);
    const smuggled = segments.find((segment) => WRITE_VERBS.has(segment));
    if (smuggled) {
      return {
        ok: false,
        reason: `send refused: gws_run may only read, and ${smuggled} in the resource path is not a read`,
      };
    }

    if (!READ_METHODS.has(verb)) {
      return {
        ok: false,
        reason: `send refused: gws_run may only read, and ${verb || "that method"} through ${service || "an unnamed service"} is not a read`,
      };
    }
    return { ok: true };
  }

  if (reader === null) {
    return { ok: false, reason: "send refused: no reader mailbox is mapped for this run" };
  }

  if (CALENDAR_NOTIFYING_TOOLS.has(name)) {
    /**
     * AN INVITATION, AN UPDATE AND A CANCELLATION ARE ALL SENDS, and all
     * three default to notifying EVERY attendee.
     *
     * This block was briefly wrong in both halves and both mistakes are
     * worth recording, because each looked like diligence.
     *
     * I checked the plugin's schema for `send_updates`, did not find it, and
     * removed the rule that required it. It is there: it arrives through a
     * spread (`...sendUpdatesParam("invite")`), which the property listing I
     * grepped could not show. The handler defaults it to `"all"`. So the
     * rule I deleted was the only thing stopping Google mailing the
     * invitation, and the comment I left told the next person not to restore
     * it.
     *
     * And the attendee check itself was inert: the tool takes `attendees` as
     * a COMMA-SEPARATED STRING, while the guard tested `Array.isArray`. The
     * array shape existed only in my tests, so a real call skipped the loop
     * and returned ok. A guard that only its own tests can trigger is worse
     * than none, because it is believed.
     */
    const attendees = attendeeAddresses(args.attendees);
    if (attendees === null) {
      return { ok: false, reason: "send refused: the attendee list could not be parsed" };
    }
    for (const address of attendees) {
      if (address !== reader) {
        return { ok: false, reason: "send refused: an attendee is not the reader mailbox" };
      }
    }
    // Belt and braces, and the braces are load-bearing: a cancellation has no
    // attendee argument at all, so suppression is its ONLY protection.
    if (args.send_updates !== "none") {
      return {
        ok: false,
        reason: "send refused: a calendar tool that notifies must pass send_updates none",
      };
    }
    return { ok: true };
  }

  /* FORWARD CARRIES NO SUBJECT OF ITS OWN. It derives one from the message
   * it forwards, so requiring `[smoke]` in `args.subject` asked for an
   * argument the tool does not accept and refused every forward there could
   * ever be. The subject that matters is the ORIGINAL's, which is the same
   * thing the reply branch checks and for the same reason. */
  if (name === "gmail_forward") {
    const permitted = permittedFor(name, reader, sender);
    const recipients = checkRecipients(args, permitted, "the reader or sender mailbox");
    if (!recipients.ok) return recipients;

    const original = await opts.lookups.readMessage(String(args.message_id ?? ""));
    if (!original) {
      return { ok: false, reason: "send refused: the message being forwarded could not be read" };
    }
    if (!subjectOk(original.subject)) {
      return {
        ok: false,
        reason: `send refused: the forwarded message's subject does not carry ${SUBJECT_PREFIX}`,
      };
    }
    return { ok: true };
  }

  if (ARG_RECIPIENT_TOOLS.has(name)) {
    // `gmail_forward` may also reach the configured sender; every other
    // tool in this set is reader-only and the refusal text says so.
    const permitted = permittedFor(name, reader, sender);
    const recipients = checkRecipients(
      args,
      permitted,
      permitted.size > 1 ? "the reader or sender mailbox" : "the reader mailbox"
    );
    if (!recipients.ok) return recipients;
    if (!subjectOk(args.subject)) {
      return { ok: false, reason: `send refused: the subject must carry ${SUBJECT_PREFIX}` };
    }
    return { ok: true };
  }

  if (name === "gmail_send_draft") {
    const draftId = String(args.draft_id ?? "");
    const stored = await opts.lookups.readDraft(draftId);
    if (!stored) return { ok: false, reason: "send refused: the draft could not be read before sending" };
    // A STORED DRAFT IS READER-ONLY, whatever the tool that sends it. The
    // widening is for reply and forward, which is where the threading
    // evidence has to come back to us; a draft chooses its own recipients
    // at creation and has no such need.
    const recipients = checkRecipients(stored, new Set([reader]));
    if (!recipients.ok) return recipients;
    if (!subjectOk(stored.subject)) {
      return { ok: false, reason: `send refused: the stored draft's subject must carry ${SUBJECT_PREFIX}` };
    }
    return { ok: true };
  }

  /* gmail_reply. The reply goes wherever the ORIGINAL says, so the original
   * is what has to be checked — and the header that decides is `From`.
   *
   * THIS GUARD CHECKED THE WRONG HEADER AND IT WAS A REAL HOLE. It resolved
   * the recipient as `replyTo ?? from`, reasoning that a reply goes where
   * Reply-To points. The tool does not agree: it composes `To:` from the
   * original's `From` alone and never reads Reply-To. So a message with
   * `From: <a stranger>`, `Reply-To: <our configured sender>` and a
   * `[smoke]` subject passed the guard and would have been replied to at
   * the stranger's address. The reader mailbox receives outside mail, so
   * both headers are things somebody else can set. The old test pinned only
   * the harmless direction and recorded the false reasoning as if it were a
   * fact.
   *
   * BOTH headers are now required to be permitted: `From`, because that is
   * where the reply is actually addressed, and `Reply-To` when present,
   * because a tool that started honouring it must not silently widen this.
   * If the tool changes, this refuses rather than permits. */
  const original = await opts.lookups.readMessage(String(args.message_id ?? ""));
  if (!original) return { ok: false, reason: "send refused: the message being replied to could not be read" };
  const replyPermitted = permittedFor(name, reader, sender);

  const headerOk = (raw: string | undefined, which: string): SendCheck => {
    let parsed;
    try {
      parsed = parseAddressList(raw);
    } catch (err) {
      const why = err instanceof AddressParseError ? err.message : String(err);
      return { ok: false, reason: `send refused: the original's ${which} could not be parsed (${why})` };
    }
    if (parsed.length !== 1 || !replyPermitted.has(parsed[0].address)) {
      return { ok: false, reason: "send refused: a reply would not go to the reader mailbox" };
    }
    return { ok: true };
  };

  const fromOk = headerOk(original.from, "From");
  if (!fromOk.ok) return fromOk;

  // AND the same header as the TOOL reads it, which is not always the same
  // address. See `addressAsTheToolReadsIt`.
  if (!replyPermitted.has(addressAsTheToolReadsIt(original.from ?? ""))) {
    return {
      ok: false,
      reason: "send refused: the original's From reads as a different address to the tool than to this guard",
    };
  }
  if ((original.replyTo ?? "").trim() !== "") {
    const replyToOk = headerOk(original.replyTo, "Reply-To");
    if (!replyToOk.ok) return replyToOk;
  }
  if (!subjectOk(original.subject)) {
    return { ok: false, reason: `send refused: the original's subject does not carry ${SUBJECT_PREFIX}` };
  }
  return { ok: true };
}
