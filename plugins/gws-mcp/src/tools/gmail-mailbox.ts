import type { GwsClient } from "../gws-client.js";
import { CREATE, MUTATE, READ, ToolDef } from "./annotations.js";
import { jsonResponse, truncate } from "./response.js";
import {
  ATTACHMENT_FIELDS,
  MAX_MIME_TYPE,
  MIME_TYPE,
  PART_ID,
  attachmentName,
  findPart,
  type Part,
} from "../internal/file-bytes/gmail-attachment.js";
import { GMAIL_ID, readCapped } from "../internal/file-bytes/shared.js";
import { mb } from "../attachments/fetch.js";

/**
 * Four mailbox calls that had no tool of their own (SCRUM-419): moving a
 * message to Trash and back, listing drafts, and reading one attachment.
 * Then the rest of what Claude's built-in Gmail connector does to a mailbox
 * (SCRUM-428): a whole thread to Trash and back, and spam and not spam.
 * Each was being reached through the raw API tool, where the caller has to
 * know Gmail's resource paths and the `userId` every one of them takes.
 */

/** The most an attachment's text may weigh, as bytes fetched from Gmail. */
export const ATTACHMENT_TEXT_MAX_BYTES = 512 * 1024;
/** The most of that text one response carries, in characters. */
export const ATTACHMENT_TEXT_MAX_CHARS = 200_000;

/** Types whose bytes are text a reader can use as they are. Everything under
 * `text/` counts as well. Anything else (a PDF, an image, an archive, an
 * Office file) is bytes, and bytes are not returned by this tool. */
const TEXT_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/x-ndjson",
  "application/xml",
  "application/csv",
  "application/x-yaml",
  "application/yaml",
  "application/sql",
]);

function isTextType(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  const type = mimeType.toLowerCase();
  return type.startsWith("text/") || TEXT_TYPES.has(type) || type.endsWith("+json") || type.endsWith("+xml");
}

/** Control characters other than tab and line breaks, which a text file has
 * no use for and which would each cost six characters once escaped. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Characters a reader cannot see: zero-width and joining marks, the marks
 * that reorder the text around them, the byte order mark and the Unicode
 * tag block. The text is the sender's, and what it says to a person reading
 * it and to a model reading it has to be the same thing. */
const INVISIBLE = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]|\udb40[\udc00-\udc7f]/g;

/** Said in every response that carries text, because that text was written
 * by whoever sent the message and not by the mailbox's owner. */
export const ATTACHMENT_TEXT_ORIGIN = "attachment content, supplied by the sender of the message";

export const gmailMailboxTools: ToolDef[] = [
  {
    name: "gmail_trash",
    description:
      "Moves one Gmail message to Trash. Takes the message ID. The message leaves the inbox and every other label view and stays in Trash, where Gmail deletes it for good after 30 days; gmail_untrash restores it before then. Returns the message ID and the labels the message carries afterwards. Acts on the one message named, not on the rest of its thread.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "The ID of the message to move to Trash, as gmail_search, gmail_list and gmail_read return it.",
        },
      },
      required: ["message_id"],
    },
    annotations: MUTATE("Move email to Trash"),
  },
  {
    name: "gmail_untrash",
    description:
      "Takes one Gmail message out of Trash. Takes the message ID. Returns the message ID and the labels the message carries afterwards. A message Gmail has already deleted from Trash is gone and answers as not found.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "The ID of the message to take out of Trash.",
        },
      },
      required: ["message_id"],
    },
    // Restores; removes nothing and overwrites nothing.
    annotations: CREATE("Restore email from Trash"),
  },
  {
    name: "gmail_trash_thread",
    description:
      "Moves a whole Gmail conversation to Trash: every message in the thread, in one call. Takes the thread ID. The messages leave the inbox and every other label view and stay in Trash, where Gmail deletes them for good after 30 days; gmail_untrash_thread restores them before then. Returns the thread ID and, for each message in it, the message ID and whether it is now in Trash.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: {
          type: "string",
          description: "The ID of the thread to move to Trash, as gmail_search, gmail_list and gmail_read return it (threadId).",
        },
      },
      required: ["thread_id"],
    },
    annotations: MUTATE("Move a whole email conversation to Trash"),
  },
  {
    name: "gmail_untrash_thread",
    description:
      "Takes a whole Gmail conversation out of Trash: every message in the thread, in one call. Takes the thread ID. Returns the thread ID and, for each message in it, the message ID and whether it is still in Trash. Messages Gmail has already deleted from Trash are gone and are not in the answer.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: {
          type: "string",
          description: "The ID of the thread to take out of Trash.",
        },
      },
      required: ["thread_id"],
    },
    annotations: CREATE("Restore an email conversation from Trash"),
  },
  {
    name: "gmail_mark_spam",
    description:
      "Reports one Gmail message as spam. Takes the message ID. The message gets Gmail's SPAM label and leaves the inbox, as the Report spam button does, and Gmail deletes spam for good after 30 days; gmail_unmark_spam moves it back before then. Returns the message ID, whether it is now in spam, and the labels it carries afterwards. Acts on the one message named, not on the rest of its thread.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "The ID of the message to report as spam.",
        },
      },
      required: ["message_id"],
    },
    annotations: MUTATE("Report email as spam"),
  },
  {
    name: "gmail_unmark_spam",
    description:
      "Moves one Gmail message out of spam and back to the inbox, as the Not spam button does. Takes the message ID. Returns the message ID, whether it is still in spam, and the labels it carries afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "The ID of the message to move out of spam.",
        },
      },
      required: ["message_id"],
    },
    // Restores to the inbox; removes nothing a person would miss.
    annotations: CREATE("Move email out of spam"),
  },
  {
    name: "gmail_list_drafts",
    description:
      "Lists the drafts in a Gmail mailbox. Returns one entry per draft with its draft ID, the ID of the message it holds and that message's thread ID, plus a count and a page token when more drafts remain. The draft ID is what gmail_update_draft, gmail_send_draft and gmail_delete_draft take; the message ID is what gmail_read takes to show the draft's content. A mailbox with no drafts answers with a count of 0 and an empty list.",
    inputSchema: {
      type: "object",
      properties: {
        max_results: {
          type: "number",
          description: "The most drafts to return in one page (default: 20, at most 500).",
        },
        query: {
          type: "string",
          description:
            'Narrows the list to drafts matching a Gmail search query, in the same syntax as gmail_search (for example "subject:invoice" or "to:someone@example.com").',
        },
        page_token: {
          type: "string",
          description: "The nextPageToken from an earlier call, to read the page after it.",
        },
      },
      required: [],
    },
    annotations: READ("List email drafts"),
  },
  {
    name: "gmail_get_attachment",
    description:
      `Gets one attachment of a Gmail message by the message ID and the attachment's part ID, both of which gmail_read lists for each attachment. Describes the attachment and, when it is text, returns that text. Every response carries the file name, MIME type, size in bytes and a current attachment ID. For a text attachment (plain text, CSV, JSON, XML, HTML, calendar files and similar) of up to ${mb(
        ATTACHMENT_TEXT_MAX_BYTES
      )}, the response also carries the content as text, cut at ${ATTACHMENT_TEXT_MAX_CHARS.toLocaleString(
        "en-US"
      )} characters with a marker saying how much was left out, and with characters that cannot be seen removed. For any other type, or a larger file, no content is returned: the response states the size and the reason, and the attachment ID it carries is the one gmail_save_attachment_to_drive takes to put the file in Drive, where drive_read_file reads Word, Excel and PowerPoint files. File bytes are not returned as base64 for any type.`,
    inputSchema: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "The ID of the message the attachment is on.",
        },
        part_id: {
          type: "string",
          description:
            'The attachment\'s part ID from gmail_read, such as "1" or "0.1". It is the attachment\'s place in the message and is the same on every read, where an attachment ID is issued new each time.',
        },
      },
      required: ["message_id", "part_id"],
    },
    annotations: READ("Read an email attachment"),
  },
];

interface LabelledMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
}

function requireId(tool: string, name: string, value: unknown): string {
  if (typeof value !== "string" || !GMAIL_ID.test(value)) {
    throw new Error(`${tool}: ${name} must be a Gmail ID of letters, digits, _ and -.`);
  }
  return value;
}

async function setTrashed(client: GwsClient, tool: string, args: Record<string, unknown>, method: "trash" | "untrash") {
  const id = requireId(tool, "message_id", args.message_id);
  const params = { userId: "me", id };
  // Two literal calls and not one with a variable method: the request test
  // reads this source for the methods it must hold a recording for.
  const result =
    method === "trash"
      ? await client.api("gmail", "users.messages", "trash", { params })
      : await client.api("gmail", "users.messages", "untrash", { params });
  const message = (result.data ?? {}) as LabelledMessage;
  const labelIds = Array.isArray(message.labelIds) ? message.labelIds : [];
  return jsonResponse({
    message_id: message.id ?? id,
    thread_id: message.threadId,
    // Read from what Gmail answered, not from which method was called.
    in_trash: labelIds.includes("TRASH"),
    labelIds,
  });
}

async function setThreadTrashed(
  client: GwsClient,
  tool: string,
  args: Record<string, unknown>,
  method: "trash" | "untrash"
) {
  const id = requireId(tool, "thread_id", args.thread_id);
  const params = { userId: "me", id };
  // Two literal calls, as in setTrashed: the request test reads this source.
  const result =
    method === "trash"
      ? await client.api("gmail", "users.threads", "trash", { params })
      : await client.api("gmail", "users.threads", "untrash", { params });
  const thread = (result.data ?? {}) as { id?: string; messages?: LabelledMessage[] };
  const messages = (Array.isArray(thread.messages) ? thread.messages : []).map((m) => {
    const labelIds = Array.isArray(m.labelIds) ? m.labelIds : [];
    return { message_id: m.id, in_trash: labelIds.includes("TRASH") };
  });
  return jsonResponse({ thread_id: thread.id ?? id, message_count: messages.length, messages });
}

async function setSpam(client: GwsClient, tool: string, args: Record<string, unknown>, spam: boolean) {
  const id = requireId(tool, "message_id", args.message_id);
  // What Gmail's own buttons do: Report spam adds SPAM and takes the message
  // out of the inbox; Not spam does the reverse.
  const result = await client.api("gmail", "users.messages", "modify", {
    params: { userId: "me", id },
    jsonBody: spam
      ? { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] }
      : { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] },
  });
  const message = (result.data ?? {}) as LabelledMessage;
  const labelIds = Array.isArray(message.labelIds) ? message.labelIds : [];
  return jsonResponse({
    message_id: message.id ?? id,
    thread_id: message.threadId,
    in_spam: labelIds.includes("SPAM"),
    labelIds,
  });
}

async function listDrafts(client: GwsClient, args: Record<string, unknown>) {
  const params: Record<string, unknown> = {
    userId: "me",
    // Gmail's own ceiling for one page of drafts.
    maxResults: Math.min(Math.max(1, Math.floor(Number(args.max_results) || 20)), 500),
  };
  if (args.query) params.q = args.query;
  if (args.page_token) params.pageToken = args.page_token;
  const result = await client.api("gmail", "users.drafts", "list", { params });
  // A mailbox with no drafts answers without a `drafts` key at all.
  const data = (result.data && typeof result.data === "object" ? result.data : {}) as {
    drafts?: { id?: string; message?: { id?: string; threadId?: string } }[];
    nextPageToken?: string;
  };
  const drafts = (Array.isArray(data.drafts) ? data.drafts : []).map((d) => ({
    draft_id: d.id,
    message_id: d.message?.id,
    thread_id: d.message?.threadId,
  }));
  return jsonResponse({
    count: drafts.length,
    drafts,
    ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
  });
}

async function getAttachment(client: GwsClient, tool: string, args: Record<string, unknown>) {
  const messageId = requireId(tool, "message_id", args.message_id);
  const partId = args.part_id;
  if (typeof partId !== "string" || !PART_ID.test(partId)) {
    throw new Error(`${tool}: part_id must be a part ID of digits and dots, such as "1" or "0.1", as gmail_read lists it.`);
  }

  // SIZE AND TYPE BEFORE BYTES: the message says what the attachment is and
  // how large, so the decision to fetch is made before anything is fetched.
  const read = await client.api("gmail", "users.messages", "get", {
    params: { userId: "me", id: messageId, format: "full", fields: ATTACHMENT_FIELDS },
  });
  const part: Part | undefined = findPart((read.data as { payload?: Part } | undefined)?.payload, partId);
  const attachmentId = part?.body?.attachmentId;
  if (!part || typeof attachmentId !== "string" || !GMAIL_ID.test(attachmentId)) {
    throw new Error(
      `${tool}: message ${messageId} has no attachment at part ${partId}. gmail_read lists each attachment's part ID.`
    );
  }

  // The name and type are the sender's. They are bounded and cleaned the same
  // way the file route cleans them before they go anywhere.
  const typed =
    typeof part.mimeType === "string" && part.mimeType.length <= MAX_MIME_TYPE && MIME_TYPE.test(part.mimeType);
  const mimeType = typed ? (part.mimeType as string).toLowerCase() : "application/octet-stream";
  const filename = attachmentName(typeof part.filename === "string" ? part.filename : undefined, partId, typed ? mimeType : undefined);
  const size = typeof part.body?.size === "number" ? part.body.size : undefined;

  const described = {
    message_id: messageId,
    part_id: partId,
    filename,
    mimeType,
    size,
    attachment_id: attachmentId,
  };
  const withheld = (reason: string) =>
    jsonResponse({
      ...described,
      content_returned: false,
      reason,
      save_to_drive: { tool: "gmail_save_attachment_to_drive", message_id: messageId, attachment_id: attachmentId, filename },
    });

  if (!isTextType(mimeType)) {
    return withheld(
      `This attachment is ${mimeType}${size === undefined ? "" : `, ${size.toLocaleString("en-US")} bytes`}. Content is returned for text types only; file bytes are not returned.`
    );
  }
  const tooBig = (bytes: number) =>
    withheld(
      `This attachment is ${bytes.toLocaleString("en-US")} bytes (${mb(bytes)}), over the ${mb(
        ATTACHMENT_TEXT_MAX_BYTES
      )} this tool returns as text.`
    );
  if (size !== undefined && size > ATTACHMENT_TEXT_MAX_BYTES) return tooBig(size);

  // The capped read stops at the first byte past the cap: the size above is
  // what Gmail said, not what it sends.
  const download = await client.download("gmail", "users.messages.attachments", "get", {
    userId: "me",
    messageId,
    id: attachmentId,
    fields: "data",
  });
  const bytes = await readCapped(
    download.stream,
    "data",
    "Gmail returned no data for the attachment.",
    ATTACHMENT_TEXT_MAX_BYTES
  );
  if ("over" in bytes) return tooBig(bytes.over);

  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes.body).replace(CONTROL, " ").replace(INVISIBLE, "");
  return jsonResponse({
    ...described,
    size: bytes.body.length,
    content_returned: true,
    truncated: decoded.length > ATTACHMENT_TEXT_MAX_CHARS,
    text_origin: ATTACHMENT_TEXT_ORIGIN,
    text: truncate(decoded, ATTACHMENT_TEXT_MAX_CHARS),
  });
}

export async function handleGmailMailbox(client: GwsClient, toolName: string, args: Record<string, unknown>) {
  switch (toolName) {
    case "gmail_trash":
      return setTrashed(client, toolName, args, "trash");
    case "gmail_untrash":
      return setTrashed(client, toolName, args, "untrash");
    case "gmail_trash_thread":
      return setThreadTrashed(client, toolName, args, "trash");
    case "gmail_untrash_thread":
      return setThreadTrashed(client, toolName, args, "untrash");
    case "gmail_mark_spam":
      return setSpam(client, toolName, args, true);
    case "gmail_unmark_spam":
      return setSpam(client, toolName, args, false);
    case "gmail_list_drafts":
      return listDrafts(client, args);
    case "gmail_get_attachment":
      return getAttachment(client, toolName, args);
    default:
      throw new Error(`Unknown Gmail tool: ${toolName}`);
  }
}
