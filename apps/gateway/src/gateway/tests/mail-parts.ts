import type { ToolResult } from "./types";
import { firstArray, resultJson } from "./result-json";

/**
 * Reading a Gmail message's actual MIME parts (SCRUM-303).
 *
 * The signature cases are the only ones that need this, and they need it
 * because their claims are ABOUT THE PARTS: a signature that belongs in the
 * HTML alternative and not the plain-text one, appearing exactly once. A
 * tool's flattened view cannot answer that — it has already chosen a part
 * for you — so these go to `format=full` and decode.
 *
 * Nothing here reaches a mailbox. It is given a payload and returns text,
 * which keeps every assertion testable without a network.
 */

export type MailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name?: string; value?: string }[];
  body?: { data?: string; size?: number };
  parts?: MailPart[];
};

/** base64url, as Gmail encodes part bodies. */
export function decodePart(data: string | undefined): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** Every part in the tree, parents included, depth first. */
export function flattenParts(payload: MailPart | undefined): MailPart[] {
  if (!payload) return [];
  return [payload, ...(payload.parts ?? []).flatMap(flattenParts)];
}

/** The decoded text of the first part with this mime type, or "". */
export function partText(payload: MailPart | undefined, mimeType: string): string {
  const part = flattenParts(payload).find((p) => (p.mimeType ?? "").toLowerCase() === mimeType);
  return decodePart(part?.body?.data);
}

/**
 * How many signature blocks a part carries.
 *
 * Counted by the marker Gmail itself uses, `class="gmail_signature"`, and
 * counted rather than tested for presence: "signed twice" is a real failure
 * mode of appending on both draft and send, and it looks identical to
 * "signed once" to anything that only asks whether a signature is there.
 */
export function countSignatureBlocks(html: string): number {
  return [...html.matchAll(new RegExp(SIGNATURE_BLOCK.source, "gi"))].length;
}

/** Where the first signature block starts, or -1. The same marker the
 * count uses, so "where" and "how many" cannot disagree. */
export function firstSignatureBlock(html: string): number {
  return html.search(SIGNATURE_BLOCK);
}

/* The class Gmail puts on its signature wrapper. The character class is
 * `[^'"]` rather than `[^"']` so the quotes PAIR for the argument scanner,
 * which cannot tell a regex from a string; see E13. */
const SIGNATURE_BLOCK = /class\s*=\s*["'][^'"]*\bgmail_signature\b/i;

/** True when the top level is a multipart/alternative, which is what a
 * plain-body send is promoted to once a signature is applied. */
export function isMultipartAlternative(payload: MailPart | undefined): boolean {
  return (payload?.mimeType ?? "").toLowerCase() === "multipart/alternative";
}

/**
 * Where a case looks for a message to arrive: everywhere but Trash
 * (SCRUM-428). Gmail's search leaves Spam out by default, and with two
 * fixture accounts on different domains the receiving Gmail filed first
 * contact as Spam: in run 103bb1d2 D12's reply and E15's unsigned draft both
 * arrived, in Spam, and both cases timed out waiting. How a recipient files
 * a message is that mailbox's call, not something the product did; the
 * message arrived. Trash stays out, because a case trashes what it is done
 * with and an old copy must not read as a new arrival.
 */
export const ARRIVAL_SCOPE = "in:anywhere -in:trash";

export function arrivalQuery(query: string): string {
  return `${ARRIVAL_SCOPE} ${query}`;
}

/**
 * The ids of the search hits that were DELIVERED: labelled INBOX or SPAM
 * (where the recipient filed it, see ARRIVAL_SCOPE), and not DRAFT.
 *
 * ONE MAILBOX NOW SITS BEHIND BOTH ROLES, and that changes what a search
 * of "the reader mailbox" can find. Gmail's message search includes drafts,
 * so a case waiting for its second message to arrive could pick up a draft
 * it has not sent yet; and a message sent to oneself is one message
 * carrying SENT and INBOX, so the sent copy is no longer a different id
 * from the received one. INBOX is what delivery adds, whichever account
 * sent it, so that is the test, and a hit that carries no label list at
 * all is not taken as delivered.
 */
export function deliveredIds(hits: unknown): string[] {
  if (!Array.isArray(hits)) return [];
  return hits
    .filter(
      (h): h is { id: string; labelIds: string[] } =>
        !!h &&
        typeof h === "object" &&
        typeof (h as { id?: unknown }).id === "string" &&
        Array.isArray((h as { labelIds?: unknown }).labelIds)
    )
    .filter((h) => (h.labelIds.includes("INBOX") || h.labelIds.includes("SPAM")) && !h.labelIds.includes("DRAFT"))
    .map((h) => h.id);
}

/** The delivered ids in a `gmail_search` answer. A search that found
 * nothing answers a JSON string, not a list, and reads as none. */
export function deliveredFromSearch(res: ToolResult): string[] {
  return deliveredIds(firstArray(resultJson("gmail_search", res)));
}

/** The plugin's own answer to a search that matched nothing. */
export const NO_MESSAGES = "No messages found.";

/** The hits of a `gmail_search` answer: the list, an empty list for the
 * plugin's no-match answer, or null when the answer is neither, so a
 * cleanup can tell "nothing to sweep" from "could not read the search"
 * (SCRUM-428: the D12 sweep threw on an empty search and reported residue
 * that was really a reply filed somewhere the search did not look). */
export function searchHits(res: ToolResult): unknown[] | null {
  const parsed = resultJson<unknown>("gmail_search", res);
  if (parsed === NO_MESSAGES) return [];
  return firstArray(parsed);
}
