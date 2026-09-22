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
  return [...html.matchAll(/class\s*=\s*["'][^"']*\bgmail_signature\b/gi)].length;
}

/** True when the top level is a multipart/alternative, which is what a
 * plain-body send is promoted to once a signature is applied. */
export function isMultipartAlternative(payload: MailPart | undefined): boolean {
  return (payload?.mimeType ?? "").toLowerCase() === "multipart/alternative";
}

/**
 * The ids of the search hits that were DELIVERED: labelled INBOX, and not
 * DRAFT.
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
    .filter((h) => h.labelIds.includes("INBOX") && !h.labelIds.includes("DRAFT"))
    .map((h) => h.id);
}
