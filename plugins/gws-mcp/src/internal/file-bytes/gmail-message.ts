import {
  GMAIL_ID,
  fitName,
  found,
  readCapped,
  refuse,
  sanitiseNamePart,
  tooLarge,
  upstreamFailure,
  type Resolver,
} from "./shared.js";

/** `{ type: "gmail_message", message_id }`: a Gmail message as its original
 * (.eml) (SCRUM-384). */

/** A subject as a file name part, `message` when nothing usable is left. */
export function sanitiseSubject(subject: string | undefined): string {
  return sanitiseNamePart(subject) || "message";
}

/** `<subject> <YYYY-MM-DD> <message id>.eml`, at most MAX_NAME_LENGTH long.
 *
 * The id is what tells two messages with one subject apart and the
 * extension is what makes the file open, so a long name loses subject text
 * first, then the date, and the ` <id>.eml` end survives whole. */
export function fileNameFor(subject: string | undefined, internalDate: unknown, messageId: string): string {
  const ms = Number(internalDate);
  const hasDate = internalDate !== undefined && internalDate !== null && internalDate !== "" && Number.isFinite(ms);
  let date = "";
  if (hasDate) {
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
  }
  return fitName(sanitiseSubject(subject) + (date ? ` ${date}` : ""), ` ${messageId}.eml`);
}

interface GmailMetadata {
  sizeEstimate?: number;
  internalDate?: string;
  payload?: { headers?: Array<{ name?: string; value?: string }> };
}

export const gmailMessage: Resolver = {
  validate(ref) {
    const id = ref.message_id;
    if (typeof id !== "string" || !GMAIL_ID.test(id)) {
      return "ref.message_id must be a non-empty string of letters, digits, _ and -.";
    }
    return undefined;
  },

  async resolve(ref, maxBytes, client) {
    const messageId = ref.message_id as string;

    // SIZE BEFORE BYTES: the metadata read says how large the message is, so
    // one over the cap is refused without its body ever being fetched.
    // metadataHeaders is an array: the direct transport sends a repeated key,
    // where a comma-joined string matches no header at all.
    let meta: GmailMetadata;
    try {
      const result = await client.api("gmail", "users.messages", "get", {
        params: { userId: "me", id: messageId, format: "metadata", metadataHeaders: ["Subject", "Date"] },
      });
      meta = (result.data ?? {}) as GmailMetadata;
    } catch (err) {
      return upstreamFailure("message", err);
    }
    if (typeof meta.sizeEstimate === "number" && meta.sizeEstimate > maxBytes) {
      return tooLarge("message", meta.sizeEstimate, maxBytes);
    }

    // The raw message arrives as one base64url field inside JSON. `fields:
    // raw` leaves nothing else in the answer, and the capped read stops at
    // the first byte past the cap: sizeEstimate is an estimate.
    let read: Awaited<ReturnType<typeof readCapped>>;
    try {
      const raw = await client.download("gmail", "users.messages", "get", {
        userId: "me",
        id: messageId,
        format: "raw",
        fields: "raw",
      });
      read = await readCapped(raw.stream, "raw", "Gmail returned no raw content for the message.", maxBytes);
    } catch (err) {
      return upstreamFailure("message", err);
    }
    if ("over" in read) return tooLarge("message", read.over, maxBytes);
    if (read.body.length === 0) return refuse(502, "upstream", "Gmail could not return the message: it came back empty.");

    const subject = meta.payload?.headers?.find((h) => h.name?.toLowerCase() === "subject")?.value;
    return found(read.body, "message/rfc822", fileNameFor(subject, meta.internalDate, messageId));
  },
};
