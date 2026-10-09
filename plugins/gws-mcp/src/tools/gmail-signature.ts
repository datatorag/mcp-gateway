import type { GwsClient } from "../gws-client.js";
import { stripHtml } from "./response.js";

/** What the `signature` field on a send response reports.
 *
 * `applied` the account's signature was appended; `none_set` the account has
 * no signature; `suppressed` the caller passed `signature: false`;
 * `already_present` the body already ended with it; `unavailable` the lookup
 * failed and the mail went out unsigned; `skipped_unsupported_draft` the
 * draft's MIME shape is one we will not rewrite, so it was sent untouched. */
export type SignatureState =
  | "applied"
  | "none_set"
  | "suppressed"
  | "already_present"
  | "unavailable"
  | "skipped_unsupported_draft";

/** Gmail's own marker on a signature block, as both a class and a data
 * attribute. Web writes both, older messages and the phone app write one or
 * neither, which is why the text check below exists as well. */
const SIGNATURE_MARKER = /gmail_signature/i;

/** Index of the tag opening Gmail's quoted-original block, or -1.
 *
 * NOT a regex, deliberately. The natural pattern for this is
 * `<(?:div|blockquote)\b[^>]*\bgmail_quote\b[^>]*>`, whose two overlapping
 * open-ended runs are quadratic on a body holding unclosed tags — measured at
 * over two minutes of blocked event loop on a 1MB body, on a process that
 * serves every session from one loop, so it is other tenants' outage and not
 * just this caller's. Nothing caps an inbound body, so this has to be linear
 * on its own.
 *
 * This walks each tag exactly once instead. Both scans advance monotonically,
 * and the per-tag tests are anchored or bounded by that tag, so the whole
 * thing is linear in the body's length. */
function findHtmlQuoteIndex(html: string): number {
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf("<", at);
    if (open === -1) return -1;
    const close = html.indexOf(">", open);
    if (close === -1) return -1;
    const tag = html.slice(open, close + 1);
    if (/^<(?:div|blockquote)\b/i.test(tag) && /\bgmail_quote\b/.test(tag)) return open;
    at = close + 1;
  }
  return -1;
}

/** Escape a plain-text body into HTML, preserving its line breaks. Used when
 * a plain-only send is promoted to multipart so the signature's markup has an
 * HTML part to live in. */
export function plainToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r\n|\r|\n/g, "<br>");
}

/** The signature as Gmail web writes it: two spacer breaks, then the stored
 * markup inside the marked container, UNCHANGED. No `--` line, and nothing
 * converts or rewrites the markup — an image signature is a hosted URL that
 * simply passes through. */
export function signatureHtmlBlock(sigHtml: string): string {
  return (
    '<br clear="all"><br clear="all">' +
    '<div><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">' +
    sigHtml +
    "</div></div>"
  );
}

export function appendHtmlSignature(html: string, sigHtml: string): string {
  return appendToHtml(html, signatureHtmlBlock(sigHtml));
}

/** Put a block at the end of an HTML body: inside a closing `</body>` when
 * the body has one, otherwise after the last byte. */
export function appendToHtml(html: string, block: string): string {
  // Only the tail can hold the closing tag, and lowercasing the whole body to
  // find a 7-character token allocates a full UTF-16 copy of it — GC pressure
  // every other tenant on this loop pays for.
  const tailFrom = Math.max(0, html.length - 1024);
  const inTail = html.slice(tailFrom).toLowerCase().lastIndexOf("</body>");
  const close = inTail === -1 ? -1 : tailFrom + inTail;
  if (close !== -1) return html.slice(0, close) + block + html.slice(close);
  return html + block;
}

/** Insert the signature above the quoted original. `undefined` means there is
 * no quote here, which the caller must treat as "append at the end" or "do not
 * guess" as its own case requires. */
export function insertBeforeHtmlQuote(html: string, sigHtml: string): string | undefined {
  const quote = findHtmlQuoteIndex(html);
  if (quote === -1) return undefined;
  return html.slice(0, quote) + signatureHtmlBlock(sigHtml) + html.slice(quote);
}

const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

/** How much of the HTML body's tail the presence check reads.
 *
 * The check asks whether the body ENDS with the signature, so only the end can
 * decide it, and a signature is never anywhere near this long. Bounding it
 * keeps the cost flat however much markup a caller sends. */
const PRESENCE_TAIL_CHARS = 4096;

/** Has this HTML body already got the signature on it?
 *
 * The marker, or the signature's text at the END of the body before any
 * quoted original — a signature inside the quote belongs to the message being
 * replied to. End only: a signature reading one word would otherwise match
 * every message that happens to use it.
 *
 * Both sides are flattened with `stripHtml`, which is the right tool HERE
 * even though it cannot render a signature faithfully: this is a comparison
 * between two strings put through the SAME flattening, so line-break fidelity
 * does not matter and only needs to be consistent. */
export function signaturePresentInHtml(html: string, sigText: string): boolean {
  // BOTH checks run on the part ABOVE the quote. A quoted earlier message
  // routinely carries a gmail_signature block of its own, so testing the
  // marker against the whole body would read every reply to a signed thread
  // as already signed and send it bare — the most common send_draft there is.
  const quote = findHtmlQuoteIndex(html);
  const head = quote === -1 ? html : html.slice(0, quote);
  if (SIGNATURE_MARKER.test(head)) return true;
  if (!sigText) return false;
  const tail = head.length > PRESENCE_TAIL_CHARS ? head.slice(-PRESENCE_TAIL_CHARS) : head;
  return normalise(stripHtml(tail)).endsWith(normalise(sigText));
}

export type SignatureLookup =
  | { ok: true; html: string; text: string }
  | { ok: false; state: "none_set" | "unavailable" };

interface SendAsEntry {
  sendAsEmail?: string;
  isDefault?: boolean;
  signature?: string;
}

const addressOf = (header: string) =>
  (/<([^>]+)>/.exec(header)?.[1] ?? header).trim().toLowerCase();

/** The addresses this account sends as: its own address and its aliases.
 * What Reply all leaves out, so a reply to everyone does not mail the account
 * itself (SCRUM-368). Empty when the list cannot be read: leaving nobody out
 * costs a copy to yourself, where failing would cost the reply. Not cached,
 * for the reason given below. */
export async function ownAddresses(client: GwsClient): Promise<string[]> {
  try {
    const result = await client.api("gmail", "users.settings.sendAs", "list", {
      params: { userId: "me" },
    });
    const entries = (result.data as { sendAs?: SendAsEntry[] } | undefined)?.sendAs ?? [];
    return entries.map((e) => e.sendAsEmail).filter((e): e is string => typeof e === "string" && e !== "");
  } catch {
    return [];
  }
}

/** Read the account's signature.
 *
 * NO CACHE, AT ANY LEVEL. `create-server.ts` builds a new GwsClient per tool
 * call carrying THAT caller's token, so a value remembered between calls
 * would go out on another customer's mail. One `sendAs.list` per send is the
 * cost of that guarantee; the test "two clients return different signatures"
 * fails the moment anyone adds one.
 *
 * The API exposes only the NEW-EMAIL signature — there is no reply/forward
 * default to read (verified against the live discovery document) — so this
 * one value is what replies and forwards get too.
 *
 * `text` is ONLY for the already-present comparison. It is never sent. */
export async function lookupSignature(
  client: GwsClient,
  fromHeader?: string
): Promise<SignatureLookup> {
  let entries: SendAsEntry[];
  try {
    const result = await client.api("gmail", "users.settings.sendAs", "list", {
      params: { userId: "me" },
    });
    entries = (result.data as { sendAs?: SendAsEntry[] } | undefined)?.sendAs ?? [];
  } catch {
    // A signature is not worth failing a send over.
    return { ok: false, state: "unavailable" };
  }
  if (entries.length === 0) return { ok: false, state: "unavailable" };

  const wanted = fromHeader ? addressOf(fromHeader) : undefined;
  const entry =
    (wanted && entries.find((e) => e.sendAsEmail?.toLowerCase() === wanted)) ||
    entries.find((e) => e.isDefault) ||
    entries[0];

  const html = entry.signature ?? "";
  if (html.trim() === "") return { ok: false, state: "none_set" };
  return { ok: true, html, text: stripHtml(html) };
}

export interface SignedBodies {
  body?: string;
  html?: string;
  /** The markup this send's HTML part was built from, BEFORE the signature
   * went in — the caller's own `html_body`, or the escaped plain body when a
   * plain send was promoted.
   *
   * The plain part must never carry the signature, so a plain fallback
   * derived from the HTML has to come from this rather than from `html`. It
   * is carried instead of derived here because deriving costs a full HTML
   * flatten, and the paths with a single body slot (reply, forward) have no
   * plain part to put it in and would throw that work away. Flattening is
   * superlinear on adversarial markup, so work that is merely wasted on one
   * path is a stall for every session sharing the loop.
   *
   * ALWAYS set when a signature was applied, including on the promotion path
   * where a plain body is guaranteed and this is never read. Leaving it unset
   * there would make the plain part's safety depend on `resolveBody` two
   * functions away always producing a body — true today, silent if it ever
   * stops being true. */
  unsignedHtml?: string;
  state: SignatureState;
}

export function suppressionRequested(value: unknown): boolean {
  return value === false || value === "false";
}

/** Resolve and apply the signature to a send's bodies.
 *
 * Every send tool goes through this one function, so the injection cannot be
 * forgotten on a path that branches later (a plain ASCII `gmail_send` never
 * reaches `buildRawMessage`, which is exactly how this would have been
 * missed).
 *
 * THE SIGNATURE GOES IN THE HTML PART ONLY. The plain part is built from the
 * body alone, exactly as before. A plain-only send with a signature is still
 * promoted to two parts so the stored markup has somewhere to live, but the
 * plain half of it is the caller's body untouched. With no signature, a plain
 * send is byte-identical to before. */
/** The schema says boolean, but a loose client can send the string "false",
 * and the two failure directions are not equal: a signature the caller asked
 * to suppress cannot be recalled once the mail is out, while a missing one is
 * harmless. So suppression is read generously and everything else defaults to
 * applying, which is what the design asks for. */
export async function applySignature(
  client: GwsClient,
  args: Record<string, unknown>,
  bodies: { body?: string; html?: string },
  opts?: { fromHeader?: string }
): Promise<SignedBodies> {
  if (suppressionRequested(args.signature)) return { ...bodies, state: "suppressed" };

  const sig = await lookupSignature(client, opts?.fromHeader);
  if (!sig.ok) return { ...bodies, state: sig.state };

  const given = bodies.html;
  const candidate = given !== undefined ? given : plainToHtml(bodies.body ?? "");
  if (signaturePresentInHtml(candidate, sig.text)) {
    return { ...bodies, state: "already_present" };
  }

  return {
    body: bodies.body,
    html: appendHtmlSignature(candidate, sig.html),
    // The plain part never carries the signature: whoever builds a plain
    // fallback derives it from THIS, not from the signed markup above.
    unsignedHtml: candidate,
    state: "applied",
  };
}
