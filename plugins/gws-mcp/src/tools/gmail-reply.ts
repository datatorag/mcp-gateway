import { addressKey, distinctMailboxes, firstAddress, parseAddressList, type Mailbox } from "./address-list.js";
import { singleLine } from "./mime-headers.js";
import { stripHtml } from "./response.js";

/** Building a reply as multipart/alternative.
 *
 * The `gws` CLI's `+reply` helper takes ONE body and a boolean `--html`, so it
 * can emit `text/plain` OR a single `text/html` part and never both. A signed
 * reply needs the signature in an HTML part (SCRUM-278 note 2) while keeping
 * the plain alternative, so once a signature applies we compose the reply here
 * instead and send it on the raw path, exactly as `gmail_send` already does.
 *
 * The quote markup below is the CLI's own, taken verbatim from
 * `gws gmail +reply --dry-run` in both its plain and `--html` forms, so a
 * signed reply quotes identically to an unsigned one. An unsigned reply still
 * goes through the CLI untouched. */

/** How much markup is flattened when a plain alternative has to be DERIVED.
 *
 * Deriving one means running the shared flattener over caller- or
 * sender-supplied markup, so the input is bounded before it gets there rather
 * than after. THE single bound for that concern — it used to be stated twice,
 * with the larger of the two unable to ever bind. */
const PLAIN_DERIVE_MAX = 128 * 1024;

export function derivePlain(html: string): string {
  if (html.length <= PLAIN_DERIVE_MAX) return stripHtml(html);
  return `${stripHtml(html.slice(0, PLAIN_DERIVE_MAX))}\n…[truncated]`;
}

const QUOTE_STYLE =
  "margin:0 0 0 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex";

export interface OriginalMessage {
  /** Raw `From` header value, e.g. `Manuel Yang <m@x.com>`. */
  from: string;
  /** Raw `Date` header value, used VERBATIM in the plain attribution because
   * that is what the CLI does. */
  date: string;
  subject: string;
  messageId: string;
  references?: string;
  plain?: string;
  html?: string;
  /** Raw `Reply-To`, `To` and `Cc` header values, and whether the account
   * itself sent the message. What a reply is addressed from (SCRUM-368). */
  replyTo?: string;
  to?: string;
  cc?: string;
  selfSent?: boolean;
}

/** The most addresses one reply may carry. The list comes out of a message
 * somebody else wrote, so its length is theirs to choose until this says no. */
export const MAX_REPLY_RECIPIENTS = 100;

/** Whether the reply left out the person the original says it is from.
 * True when a Reply-To redirected it, with or without reply all: correct
 * mail behaviour, and also the way a message with a familiar sender has its
 * answers sent to someone else, so the caller is told. */
export function replyRedirected(
  original: Pick<OriginalMessage, "from" | "selfSent">,
  recipients: Mailbox[]
): boolean {
  if (original.selfSent) return false;
  const sender = addressKey(firstAddress(original.from));
  return !recipients.some((m) => addressKey(m.address) === sender);
}

/** Hold a reply to the recipients the caller named (`expected_to`).
 *
 * Who a reply goes to is decided by headers the SENDER of the original wrote:
 * a Reply-To redirects it, and under reply all so do that message's To and
 * Cc. A caller that knows who it means to answer says so, and the reply is
 * refused before anything is sent unless it would go to exactly those
 * addresses.
 *
 * EXACTLY, and counting everyone who would receive it: the To and, under
 * reply all, the Cc. One address the caller did not name is a refusal, and
 * so is a named address the reply would not reach, since a caller who named
 * three people and reaches two has not sent what it meant to. Order and case
 * do not matter. With several addresses, name them all.
 *
 * Throws; returns nothing. The message names both sets and the difference,
 * so the caller can see the redirect it was protected from. */
export function assertExpectedRecipients(
  recipients: { to: Mailbox[]; cc: Mailbox[] },
  expectedTo: unknown
): void {
  if (expectedTo === undefined || expectedTo === null) return;
  if (typeof expectedTo !== "string") {
    throw new Error("gmail_reply: expected_to must be a string of one or more email addresses, comma separated.");
  }
  const expected = distinctMailboxes(parseAddressList(expectedTo)).map((m) => m.address);
  if (expected.length === 0) {
    throw new Error(
      "gmail_reply: expected_to holds no email address. Name the address or addresses the reply should go to, or leave it out."
    );
  }
  const actual = [...recipients.to, ...recipients.cc].map((m) => m.address);
  const keys = (list: string[]) => new Set(list.map(addressKey));
  const expectedSet = keys(expected);
  const actualSet = keys(actual);
  const unexpected = actual.filter((a) => !expectedSet.has(addressKey(a)));
  const unreached = expected.filter((a) => !actualSet.has(addressKey(a)));
  if (unexpected.length === 0 && unreached.length === 0) return;
  const cc = recipients.cc.length > 0 ? `, Cc: ${recipients.cc.map((m) => m.address).join(", ")}` : "";
  throw new Error(
    "gmail_reply: nothing was sent. This reply would go to " +
      `To: ${recipients.to.map((m) => m.address).join(", ")}${cc}, ` +
      `which is not what expected_to names (${expected.join(", ")}).` +
      (unexpected.length > 0 ? ` Not expected: ${unexpected.join(", ")}.` : "") +
      (unreached.length > 0 ? ` Named but not addressed: ${unreached.join(", ")}.` : "") +
      " The recipients come from the original message's Reply-To, From, To and Cc. If they are right, call again with expected_to listing all of them or without it; if they are not, send a new message to the people you mean."
  );
}

/** Who a reply goes to, the way Gmail's own Reply and Reply all decide it.
 *
 * REPLY: the original's Reply-To when it has one, otherwise its From. When
 * the account itself sent the original, replying to "the sender" would mail
 * yourself, so the reply goes to the people the original was sent to.
 *
 * REPLY ALL adds the rest of the conversation: the original's other To
 * recipients join To and its Cc stays Cc, with the account's own addresses
 * taken out and nobody listed twice.
 *
 * Every value here comes out of a message somebody else wrote, so the headers
 * are parsed (address-list.ts), not split, and an entry without a usable
 * address is dropped. Throws when nothing is left to address: a reply with no
 * recipient is refused by Gmail with a message that explains nothing. */
export function replyRecipients(
  original: Pick<OriginalMessage, "from" | "replyTo" | "to" | "cc" | "selfSent">,
  opts: { replyAll?: boolean; ownAddresses?: string[] } = {}
): { to: Mailbox[]; cc: Mailbox[] } {
  const originalTo = parseAddressList(original.to);
  const replyTo = parseAddressList(original.replyTo);
  const primary = original.selfSent
    ? originalTo
    : replyTo.length > 0
      ? replyTo
      : parseAddressList(original.from);

  let to = distinctMailboxes(primary);
  let cc: Mailbox[] = [];
  if (opts.replyAll) {
    const own = opts.ownAddresses ?? [];
    const widened = distinctMailboxes([...primary, ...originalTo], own);
    // Taking the account's own addresses out must not empty the reply: a
    // note sent only to yourself is still answered to yourself.
    if (widened.length > 0) to = widened;
    cc = distinctMailboxes(parseAddressList(original.cc), [...own, ...to.map((m) => m.address)]);
  }
  if (to.length + cc.length > MAX_REPLY_RECIPIENTS) {
    throw new Error(
      `This reply would go to ${to.length + cc.length} addresses; one reply takes at most ${MAX_REPLY_RECIPIENTS}. ` +
        (opts.replyAll ? "Reply without reply_all, or send a new message to the people you mean." : "Send a new message to the people you mean.")
    );
  }
  if (to.length === 0) {
    throw new Error(
      original.selfSent
        ? "This message was sent from this account and names no recipient in To, so there is nobody to reply to."
        : "This message has no usable From or Reply-To address, so there is nobody to reply to."
    );
  }
  return { to, cc };
}

/** The bare address out of a `From` header: the first mailbox it names.
 * A header with no usable address comes back folded onto one line, so the
 * attribution line still says something. */
export function addressOnly(from: string): string {
  return firstAddress(from) || singleLine(from);
}

export function replySubject(subject: string): string {
  const safe = singleLine(subject);
  return /^re:/i.test(safe) ? safe : `Re: ${safe}`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `On <raw Date header>, <address> wrote:` — the CLI's plain form. */
export function plainAttribution(date: string, from: string): string {
  return `On ${date}, ${addressOnly(from)} wrote:`;
}

/** `On Thu, Jan 1, 2026 at 12:00 AM` — the CLI's HTML form, which is Gmail's.
 * Formatted in UTC so the same message quotes the same way wherever this runs;
 * an unparseable Date falls back to the raw header rather than to `Invalid
 * Date`. */
export function htmlAttributionDate(date: string): string {
  const at = new Date(date);
  if (Number.isNaN(at.getTime())) return date;
  const formatted = at.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
  // Intl writes `Thu, Jan 1, 2026, 12:00 AM`; the CLI (and Gmail) write `at`
  // in place of that LAST comma. Anchored to the time so the date's own commas
  // are untouched.
  return formatted
    .replace(/,(\s\d{1,2}:\d{2})/, " at$1")
    // The CLI and Gmail both use a NARROW NO-BREAK SPACE before AM/PM. Node's
    // ICU emits a plain space on some versions and U+202F on others, so
    // normalise rather than inherit whichever the host happens to have —
    // otherwise the same reply quotes differently on two machines.
    .replace(/[\s\u202f]+(AM|PM)\b/, "\u202f$1");
}

export function quotePlain(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

export function htmlQuoteBlock(original: OriginalMessage, originalHtml: string): string {
  const addr = addressOnly(original.from);
  const when = htmlAttributionDate(original.date);
  return (
    '<div class="gmail_quote gmail_quote_container">' +
    `<div dir="ltr" class="gmail_attr">On ${when}, ` +
    `<a href="mailto:${escapeHtml(addr)}">${escapeHtml(addr)}</a> wrote:<br></div>` +
    `<blockquote class="gmail_quote" style="${QUOTE_STYLE}">` +
    `<div dir="ltr">${originalHtml}</div>` +
    "</blockquote></div>"
  );
}

/** The plain text quoted, preferring the original's own text/plain part and
 * flattening its HTML only when there is none.
 *
 * `derivePlain` owns the bound. This used to take the flattener as a parameter
 * and pre-slice at its own larger constant first, which could never bind and
 * read as live protection. One cap, one owner. */
export function originalPlainText(original: OriginalMessage): string {
  if (original.plain !== undefined) return original.plain;
  if (original.html === undefined) return "";
  return derivePlain(original.html);
}

/** The original rendered as HTML for quoting: its own markup when it has any,
 * otherwise its plain text escaped. Shared by the reply and forward paths so
 * the two cannot drift. */
export function originalHtmlBody(original: OriginalMessage): string {
  return (
    original.html ??
    `<div dir="ltr">${escapeHtml(original.plain ?? "").replace(/\r\n|\r|\n/g, "<br>")}</div>`
  );
}

/** The two alternative bodies of a signed reply.
 *
 * `signedHtml` already carries the signature, so appending the quote after it
 * is what puts the signature ABOVE the quote. The plain body is the caller's
 * text and never the signature. */
export function buildReplyBodies(
  original: OriginalMessage,
  plainBody: string,
  signedHtml: string
): { plain: string; html: string } {
  const quotedSource = originalHtmlBody(original);
  return {
    plain: [
      plainBody,
      "",
      plainAttribution(original.date, original.from),
      quotePlain(originalPlainText(original)),
    ].join("\n"),
    html: `${signedHtml}<br>\n${htmlQuoteBlock(original, quotedSource)}`,
  };
}

/** The forwarded-message header block, the CLI's own text form. */
export function forwardPlainBlock(o: OriginalMessage, to: string, text: string): string {
  return [
    "---------- Forwarded message ---------",
    `From: ${o.from}`,
    `Date: ${o.date}`,
    `Subject: ${o.subject}`,
    `To: ${to}`,
    "",
    text,
  ].join("\n");
}

export function forwardHtmlBlock(o: OriginalMessage, to: string, html: string): string {
  const rows = [
    ["From", escapeHtml(o.from)],
    ["Date", escapeHtml(o.date)],
    ["Subject", escapeHtml(o.subject)],
    ["To", escapeHtml(to)],
  ]
    .map(([k, v]) => `<b>${k}:</b> ${v}<br>`)
    .join("");
  return (
    '<div class="gmail_quote gmail_quote_container">' +
    '<div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>' +
    `${rows}</div><br><div dir="ltr">${html}</div></div>`
  );
}

export function forwardSubject(subject: string): string {
  const safe = singleLine(subject);
  return /^fwd:/i.test(safe) ? safe : `Fwd: ${safe}`;
}

/** `References` accumulates the thread; `In-Reply-To` is the immediate parent.
 * Both are dropped when the original carried no `Message-ID`, which is legal
 * and must not produce an empty header. */
export function threadHeaders(o: OriginalMessage): string[] {
  const id = singleLine(o.messageId);
  if (!id) return [];
  const prior = o.references ? singleLine(o.references) : "";
  const refs = prior ? `${prior} ${id}` : id;
  return [`In-Reply-To: ${id}`, `References: ${refs}`];
}
