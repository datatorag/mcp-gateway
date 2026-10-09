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

/** `{ type: "gmail_attachment", message_id, part_id }`: one attachment of a
 * Gmail message, as the bytes the sender attached (SCRUM-395).
 *
 * THE PART ID NAMES THE ATTACHMENT, NOT THE ATTACHMENT ID. Gmail issues a
 * new attachmentId for the same part on every read of the message, so an id
 * a caller copied out of one read never equals the id in the next and cannot
 * be looked up. The partId ("1", "0.1") is the part's place in the message
 * and does not change. The attachmentId used for the bytes is the one this
 * resolver's own read returned a moment earlier. */

const PART_ID = /^\d+(\.\d+)*$/;

/** A type/subtype pair and nothing else: the value comes from the sender's
 * message and goes into a response header. */
const MIME_TYPE = /^[\w.+-]+\/[\w.+-]+$/;

const PART_FIELDS = "partId,filename,mimeType,body(attachmentId,size)";

/** Parts nest and a field mask cannot recurse, so the mask is written out
 * level by level. Below the last level a part comes back whole, which costs
 * memory and loses nothing. */
const partsMask = (depth: number): string =>
  depth === 0 ? "parts" : `parts(${PART_FIELDS},${partsMask(depth - 1)})`;
export const ATTACHMENT_FIELDS = `payload(${PART_FIELDS},${partsMask(8)})`;

/** The extension for an attachment that arrived with no file name. */
const EXTENSIONS: Record<string, string> = {
  "application/json": ".json",
  "application/msword": ".doc",
  "application/pdf": ".pdf",
  "application/rtf": ".rtf",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/xml": ".xml",
  "application/zip": ".zip",
  "audio/mpeg": ".mp3",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
  "message/rfc822": ".eml",
  "text/calendar": ".ics",
  "text/csv": ".csv",
  "text/html": ".html",
  "text/plain": ".txt",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};

/** The longest ending treated as an extension, dot included. */
const MAX_EXTENSION = 16;

/** The sender chooses these and Gmail is not known to bound them, so they
 * are bounded here before any work is done on them. */
const MAX_FILENAME_INPUT = 1000;
const MAX_MIME_TYPE = 255;

/** Characters that reorder the text around them when shown. In a file name
 * they make one extension read as another, and they are never part of one. */
const DIRECTION_MARKS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** The sender's file name, at most MAX_NAME_LENGTH long with its extension
 * kept whole. The name is the user's own, so nothing is added to it. A part
 * with no usable name is `attachment-<part id>` plus an extension when the
 * type has a well known one. */
export function attachmentName(filename: string | undefined, partId: string, mimeType: string | undefined): string {
  const clean = sanitiseNamePart((filename ?? "").slice(0, MAX_FILENAME_INPUT).replace(DIRECTION_MARKS, ""));
  // Only dots is not a name: it is a directory to whatever stores the file.
  if (!clean || /^\.+$/.test(clean)) {
    const type = (mimeType ?? "").toLowerCase();
    return `attachment-${partId}${Object.hasOwn(EXTENSIONS, type) ? EXTENSIONS[type] : ""}`;
  }
  const dot = clean.lastIndexOf(".");
  const ending = dot > 0 ? clean.slice(dot) : "";
  const extension = ending.length > 1 && ending.length <= MAX_EXTENSION && !ending.includes(" ") ? ending : "";
  return fitName(clean.slice(0, clean.length - extension.length), extension);
}

interface Part {
  partId?: string;
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: Part[];
}

/** The part at `partId`, wherever it nests: the first in the message's own
 * order, which is the order gmail_read lists attachments in. A loop and not
 * recursion, and one push per child, so no message is too deep or too wide. */
function findPart(root: Part | undefined, partId: string): Part | undefined {
  const open: unknown[] = [root];
  while (open.length > 0) {
    const part = open.pop() as Part | null | undefined;
    if (!part || typeof part !== "object") continue;
    if (part.partId === partId) return part;
    if (Array.isArray(part.parts)) {
      for (let i = part.parts.length - 1; i >= 0; i--) open.push(part.parts[i]);
    }
  }
  return undefined;
}

export const gmailAttachment: Resolver = {
  validate(ref) {
    const { message_id: messageId, part_id: partId } = ref;
    if (typeof messageId !== "string" || !GMAIL_ID.test(messageId)) {
      return "ref.message_id must be a non-empty string of letters, digits, _ and -.";
    }
    if (typeof partId !== "string" || !PART_ID.test(partId)) {
      return 'ref.part_id must be a part id of digits and dots, such as "1" or "0.1".';
    }
    return undefined;
  },

  async resolve(ref, maxBytes, client) {
    const messageId = ref.message_id as string;
    const partId = ref.part_id as string;

    // SIZE BEFORE BYTES: the part says how large the attachment is and what
    // it is called, so one over the cap is refused without being fetched.
    let part: Part | undefined;
    try {
      const result = await client.api("gmail", "users.messages", "get", {
        params: { userId: "me", id: messageId, format: "full", fields: ATTACHMENT_FIELDS },
      });
      part = findPart((result.data as { payload?: Part } | undefined)?.payload, partId);
    } catch (err) {
      return upstreamFailure("attachment", err);
    }
    const attachmentId = part?.body?.attachmentId;
    // A part with no attachmentId is the message's own text, or a container.
    if (!part || typeof attachmentId !== "string" || !GMAIL_ID.test(attachmentId)) {
      return refuse(404, "not_found", "The message has no attachment at that part.");
    }
    const declared = part.body?.size;
    if (typeof declared === "number" && declared > maxBytes) return tooLarge("attachment", declared, maxBytes);

    // The capped read still stops at the first byte past the cap: the size
    // above is what Gmail said, not what it sends.
    let read: Awaited<ReturnType<typeof readCapped>>;
    try {
      const data = await client.download("gmail", "users.messages.attachments", "get", {
        userId: "me",
        messageId,
        id: attachmentId,
        fields: "data",
      });
      read = await readCapped(data.stream, "data", "Gmail returned no data for the attachment.", maxBytes);
    } catch (err) {
      return upstreamFailure("attachment", err);
    }
    if ("over" in read) return tooLarge("attachment", read.over, maxBytes);
    if (read.body.length === 0) return refuse(502, "upstream", "Gmail could not return the attachment: it came back empty.");

    const typed = typeof part.mimeType === "string" && part.mimeType.length <= MAX_MIME_TYPE && MIME_TYPE.test(part.mimeType);
    const mimeType = typed ? part.mimeType : undefined;
    const filename = typeof part.filename === "string" ? part.filename : undefined;
    return found(read.body, mimeType ?? "application/octet-stream", attachmentName(filename, partId, mimeType));
  },
};
