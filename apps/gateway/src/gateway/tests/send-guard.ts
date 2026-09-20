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
  readerEmail: string
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
      if (address !== readerEmail) {
        return {
          ok: false,
          reason: `send refused: ${field} holds an address that is not the reader mailbox`,
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
  opts: { readerEmail: string | null; lookups: GuardLookups }
): Promise<SendCheck> {
  const name = toolSuffix(tool);
  const reader = opts.readerEmail?.trim().toLowerCase() ?? null;

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

  if (ARG_RECIPIENT_TOOLS.has(name)) {
    const recipients = checkRecipients(args, reader);
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
    const recipients = checkRecipients(stored, reader);
    if (!recipients.ok) return recipients;
    if (!subjectOk(stored.subject)) {
      return { ok: false, reason: `send refused: the stored draft's subject must carry ${SUBJECT_PREFIX}` };
    }
    return { ok: true };
  }

  // gmail_reply. The reply goes wherever the original says, so the original
  // is what has to be checked.
  const original = await opts.lookups.readMessage(String(args.message_id ?? ""));
  if (!original) return { ok: false, reason: "send refused: the message being replied to could not be read" };
  const target = (original.replyTo ?? original.from ?? "").trim();
  let parsed;
  try {
    parsed = parseAddressList(target);
  } catch (err) {
    const why = err instanceof AddressParseError ? err.message : String(err);
    return { ok: false, reason: `send refused: the original's reply address could not be parsed (${why})` };
  }
  if (parsed.length !== 1 || parsed[0].address !== reader) {
    return { ok: false, reason: "send refused: a reply would not go to the reader mailbox" };
  }
  if (!subjectOk(original.subject)) {
    return { ok: false, reason: `send refused: the original's subject does not carry ${SUBJECT_PREFIX}` };
  }
  return { ok: true };
}
