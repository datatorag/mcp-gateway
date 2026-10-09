import { CREATE, MUTATE, READ, ToolDef } from "./annotations.js";
import { randomUUID } from "node:crypto";
import type { GwsClient } from "../gws-client.js";
import { deleteResponse, jsonResponse, stripHtml, truncate } from "./response.js";
import {
  appendToHtml,
  applySignature,
  plainToHtml,
  lookupSignature,
  ownAddresses,
  suppressionRequested,
  type SignatureState,
} from "./gmail-signature.js";
import { DRAFT_SIGN_MAX_CHARS, draftFromHeader, signDraftRaw } from "./gmail-draft-send.js";
import { encodeAddressHeader, encodeHeaderValue, renderHeaders } from "./mime-headers.js";
import { addressLine } from "./address-list.js";
export { renderHeaders };
import { buildMessage } from "../mime/build.js";
import {
  EXPORT_FORMATS,
  parseAttachments,
  placeFiles,
  resolveAttachments,
  type OriginalPart,
  type ParsedEntry,
  type PlannedFile,
  type ReportEntry,
  type Resolved,
} from "../attachments/resolve.js";
import {
  derivePlain,
  escapeHtml,
  buildReplyBodies,
  originalPlainText,
  originalHtmlBody,
  forwardHtmlBlock,
  forwardPlainBlock,
  forwardSubject,
  addressOnly,
  assertExpectedRecipients,
  replyRecipients,
  replyRedirected,
  replySubject,
  threadHeaders,
  type OriginalMessage,
} from "./gmail-reply.js";

// Shared to/subject/body/cc/bcc schema for gmail_send and the draft tools
const emailFields = {
  to: {
    type: "string",
    description: "Recipient email address(es), comma-separated",
  },
  subject: { type: "string", description: "Email subject line" },
  body: {
    type: "string",
    description:
      "Plain-text email body. When html_body is also given, this becomes the text/plain alternative part shown by plain-text clients. One of body or html_body is required.",
  },
  html_body: {
    type: "string",
    description:
      "HTML email body. The message is sent as multipart/alternative with a text/plain fallback part (body if provided, otherwise text derived from the HTML), so plain-text clients still render something readable.",
  },
  cc: {
    type: "string",
    description: "CC recipients, comma-separated",
  },
  bcc: {
    type: "string",
    description: "BCC recipients, comma-separated",
  },
};

/** SCRUM-279. Every tool that writes a message can carry files from Drive. */
const attachmentsField = {
  attachments: {
    type: "array",
    maxItems: 10,
    description:
      "Drive files to send with the message, at most 10, 25 MB in total. Each entry is a Drive file id as a string, or " +
      '{"file_id": "<id>", "as": "<format>"} to send a Google Doc, Sheet or Slides deck as a file. ' +
      "Formats: Docs pdf, docx, txt, html, md, rtf, odt, epub; Sheets pdf, xlsx, csv, tsv, html, ods; Slides pdf, pptx, txt, odp. " +
      'csv and tsv export one tab: add "tab": "<title>" to choose it, otherwise the first tab goes, and the response says which. ' +
      "A Sheet as html arrives as a .zip of pages, one per tab; Slides as txt is the slides' visible text only. " +
      "Google Docs, Sheets and Slides passed by id alone are sent as links in the message, the way Gmail does, not as files. " +
      "Other Drive files are attached as they are. Files come from Drive only: to send a file, put it in Drive and pass its id. " +
      "Two attachments may not share a filename. " +
      'To show an image in the body rather than at the bottom, reference it in html_body as <img src="cid:FILENAME">, where FILENAME is its Drive filename with any character other than letters, digits, dot, dash and underscore replaced by an underscore. ' +
      "Sharing a Drive link is the sender's responsibility; nothing here changes who can open a file. " +
      "The response's attachments field reports each file as attached, inline, linked or exported.",
    items: {
      anyOf: [
        { type: "string", description: "A Drive file id." },
        {
          type: "object",
          properties: {
            file_id: { type: "string", description: "A Drive file id." },
            as: {
              type: "string",
              enum: EXPORT_FORMATS,
              description: "Export a Google Doc, Sheet or Slides deck in this format.",
            },
            tab: { type: "string", description: "For a Sheet as csv or tsv: the tab to export, by title. Defaults to the first tab." },
          },
          required: ["file_id"],
        },
      ],
    },
  },
};

/** Every tool that writes or sends a message takes this. The draft tools
 * joined the send tools in SCRUM-291: Gmail's own Compose signs when the
 * draft is written, and a draft made here and then sent from Gmail's UI never
 * passes through gmail_send_draft, so signing only at send left it bare. */
const signatureField = {
  signature: {
    type: "boolean",
    description:
      "Set false to send without the account's Gmail signature, and to skip the lookup entirely. Defaults to true.",
  },
};

/** The same switch, worded for a tool that writes a draft rather than sends. */
const draftSignatureField = {
  signature: {
    type: "boolean",
    description:
      "Set false to write the draft without the account's Gmail signature, and to skip the lookup entirely. Defaults to true.",
  },
};

/** Appended to every send tool's description. The model must not write its
 * own sign-off: the already-present check only recognises the signature
 * itself, so a near miss (\"Cheers, Dana\" against \"Cheers, Dana Rivers\")
 * ships two sign-offs. */
const SIGNATURE_NOTE =
  " The account's Gmail signature is appended automatically, so do not write a sign-off or signature in the body yourself; pass signature: false to send without it. The signature goes in the message's HTML part, so a plain-text body is sent as multipart/alternative when the account has one. The response's signature field reports what happened.";

/** Appended to the draft tools' descriptions. Same warning as the send
 * tools, for the same reason: a near-miss sign-off ships two. */
const DRAFT_SIGNATURE_NOTE =
  " The account's Gmail signature is added to the draft automatically, as Gmail's own Compose does, so do not write a sign-off or signature in the body yourself; pass signature: false to leave it out. The signature goes in the draft's HTML part, so a plain-text body is stored as multipart/alternative when the account has one. The response's signature field reports what happened.";

/** gmail_send_draft's own wording. The draft tools sign when the draft is
 * written, so by the time a draft is sent it usually carries its signature
 * already; this tool adds one only to a draft that does not. */
const SEND_DRAFT_SIGNATURE_NOTE =
  " The account's Gmail signature is added only if the draft is not already signed: a draft written by gmail_create_draft or gmail_update_draft carries it already and is sent unchanged, reporting already_present. Pass signature: false to send a draft without adding one. The response's signature field reports what happened.";

export const gmailTools: ToolDef[] = [
  {
    name: "gmail_send",
    description:
      "Send a new email via Gmail. Composes and sends an email message to the specified recipients. Accepts a plain-text body, an HTML html_body, or both — HTML is sent as multipart/alternative with a plain-text fallback." +
      SIGNATURE_NOTE,
    inputSchema: {
      type: "object",
      properties: { ...emailFields, ...attachmentsField, ...signatureField },
      required: ["to", "subject"],
    },
    annotations: MUTATE("Send email"),
  },
  {
    name: "gmail_reply",
    description:
      "Reply to an existing email in its thread. The reply is addressed the way Gmail's own Reply does it: to the original's Reply-To when it has one, otherwise to its sender; when you sent the original yourself, to the people it was sent to. Pass reply_all: true to include everyone else on the original as well. The response reports the To and Cc the reply went to; when a Reply-To meant the original's sender was not among them, it also carries reply_to_used: true and original_from, so check to against who you meant to answer, or pass expected_to and the reply is refused instead of sent when it would go anywhere else. A body is required: pass body or html_body." +
      SIGNATURE_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "The Gmail message ID to reply to",
        },
        body: {
          type: "string",
          description: "Reply body text (plain). One of body or html_body is required.",
        },
        html_body: {
          type: "string",
          description:
            "HTML reply body. The reply goes out with both an HTML part and a plain-text part derived from it, and the original message is quoted beneath with Gmail styling. Provide body or html_body, not both; one of them is required.",
        },
        reply_all: {
          type: "boolean",
          description:
            "Default false: the reply goes to one party, the original's Reply-To or sender (or, for a message you sent, its recipients). Set true to reply to everyone: the original's other To recipients are added to To and its Cc recipients to Cc, without your own addresses.",
        },
        expected_to: {
          type: "string",
          description:
            "Optional guard: the address or addresses, comma separated, you mean this reply to reach. The reply is refused before anything is sent unless it would go to exactly these (every To address, and every Cc address under reply_all; order and case are ignored). Use it when it matters who receives the reply: the recipients come from the original message's headers, and a Reply-To can name someone other than the sender you see.",
        },
        ...attachmentsField,
        ...signatureField,
      },
      required: ["message_id"],
    },
    annotations: MUTATE("Reply to email"),
  },
  {
    name: "gmail_forward",
    description:
      "Forward an existing email to another recipient." + SIGNATURE_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "The Gmail message ID to forward",
        },
        to: {
          type: "string",
          description: "Recipient email address to forward to",
        },
        body: {
          type: "string",
          description:
            "Optional plain-text note included above the forwarded message",
        },
        html_body: {
          type: "string",
          description:
            "Optional HTML note included above the forwarded message. The forward goes out with both an HTML part and a plain-text part, and the forwarded block is formatted with Gmail styling. Provide body or html_body, not both.",
        },
        ...attachmentsField,
        include_original_attachments: {
          type: "boolean",
          description:
            "The original message's own attachments are forwarded with it, counted in the 25 MB limit. Set false to forward the text alone. Defaults to true.",
        },
        ...signatureField,
      },
      required: ["message_id", "to"],
    },
    annotations: MUTATE("Forward email"),
  },
  {
    name: "gmail_read",
    description:
      "Read a specific email message by its ID. By default returns the full message including headers, body, and metadata. Use text_only for a compact view (flattened headers, decoded text body, attachment metadata) that avoids large MIME/base64 payloads.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "The Gmail message ID to read",
        },
        text_only: {
          type: "boolean",
          description:
            "Return a compact view instead of the raw MIME payload: flattened from/to/cc/subject/date headers, the decoded text/plain body (falls back to tag-stripped text/html), and attachment metadata (partId, filename, mimeType, attachmentId). Recommended for triage: it avoids base64 attachment data overflowing the response.",
        },
        max_body_chars: {
          type: "number",
          description:
            "Truncate the returned body text to this many characters (adds a truncation marker). Implies text_only.",
        },
      },
      required: ["message_id"],
    },
    annotations: READ("Read email"),
  },
  {
    name: "gmail_search",
    description:
      "Search Gmail messages using Gmail search syntax. Returns matching messages with flattened from/to/subject/date fields plus snippet and labels. Supports queries like \"from:client@acme.com\", \"subject:proposal\", \"after:2024/01/01\", \"has:attachment\", \"label:important\".",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Gmail search query (e.g., \"from:john@example.com subject:Q4 proposal\", \"is:unread after:2024/06/01\")",
        },
        max_results: {
          type: "number",
          description: "Maximum number of messages to return (default: 10)",
        },
      },
      required: ["query"],
    },
    annotations: READ("Search email"),
  },
  {
    name: "gmail_list",
    description:
      "List recent emails from the inbox. Optionally filter by label. Returns message IDs with flattened from/to/subject/date fields plus snippet and labels.",
    inputSchema: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description:
            "Label to filter by (e.g., \"INBOX\", \"SENT\", \"STARRED\", \"IMPORTANT\", or custom label). Defaults to INBOX.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of messages to return (default: 10)",
        },
      },
      required: [],
    },
    annotations: READ("List emails"),
  },
  {
    name: "gmail_create_draft",
    description:
      "Create a draft email in Gmail without sending it. The draft can be reviewed and sent later from Gmail. Returns the draft ID and a link to open it in Gmail. Accepts a plain-text body, an HTML html_body, or both — HTML is stored as multipart/alternative with a plain-text fallback." +
      DRAFT_SIGNATURE_NOTE,
    inputSchema: {
      type: "object",
      properties: { ...emailFields, ...attachmentsField, ...draftSignatureField },
      required: ["to", "subject"],
    },
    annotations: CREATE("Create email draft"),
  },
  {
    name: "gmail_update_draft",
    description:
      "Update an existing draft email in Gmail. This fully replaces the draft's message content (Gmail API does not support partial edits), attachments included: files the draft held are dropped unless they are passed again in attachments. If thread_id is omitted, the tool preserves the existing thread automatically." +
      DRAFT_SIGNATURE_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        draft_id: {
          type: "string",
          description: "The Gmail draft ID to update",
        },
        ...emailFields,
        thread_id: {
          type: "string",
          description:
            "Thread ID to preserve threading. If omitted, the existing draft's thread is preserved automatically.",
        },
        ...attachmentsField,
        ...draftSignatureField,
      },
      required: ["draft_id", "to", "subject"],
    },
    annotations: MUTATE("Update email draft"),
  },
  {
    name: "gmail_send_draft",
    description:
      "Send an existing Gmail draft by its draft ID. Use this to send a draft that was previously created with gmail_create_draft and reviewed — it sends the draft as stored and removes it from the Drafts folder (no orphaned draft). Returns the sent message metadata." +
      SEND_DRAFT_SIGNATURE_NOTE +
      " A draft holding files is signed in its text part and its files are sent as they are. A draft in any other shape is sent untouched and reports skipped_unsupported_draft.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: {
          type: "string",
          description: "The Gmail draft ID to send",
        },
        ...signatureField,
      },
      required: ["draft_id"],
    },
    annotations: MUTATE("Send email draft"),
  },
  {
    name: "gmail_delete_draft",
    description:
      "Permanently delete a Gmail draft by its draft ID. This does not move the draft to Trash — it is removed immediately. Use gmail_send_draft to send a draft instead of deleting it.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: {
          type: "string",
          description: "The Gmail draft ID to delete",
        },
      },
      required: ["draft_id"],
    },
    annotations: MUTATE("Delete email draft"),
  },
  {
    name: "gmail_mark_read",
    description:
      "Mark one or more Gmail messages as read by removing the UNREAD label. With add_labels or remove_labels given, it applies exactly those and nothing else, so add_labels alone does not mark anything read and add_labels [\"UNREAD\"] marks unread. Pass message_id for a single message (returns the modified message) or message_ids for a batch (up to 1000, single API call via users.messages.batchModify).",
    inputSchema: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description:
            "A single Gmail message ID to modify. Provide either this or message_ids.",
        },
        message_ids: {
          type: "array",
          items: { type: "string" },
          description:
            "Multiple Gmail message IDs to modify in one batch call (max 1000). Provide either this or message_id.",
        },
        add_labels: {
          type: "array",
          items: { type: "string" },
          description:
            'Label IDs to add (e.g., ["STARRED", "IMPORTANT"]). Optional.',
        },
        remove_labels: {
          type: "array",
          items: { type: "string" },
          description:
            'Label IDs to remove (e.g., ["UNREAD", "INBOX"]). Defaults to ["UNREAD"] if neither add_labels nor remove_labels is provided.',
        },
      },
      required: [],
    },
    annotations: MUTATE("Change email read state and labels"),
  },
  {
    name: "gmail_list_filters",
    description:
      "List all Gmail filters (settings > filters) with their criteria and actions. Read-only: use it to see what automation a mailbox already applies to incoming mail, for example when triaging why a message was archived or labelled before it was seen. This connector cannot create or delete filters, and neither can a raw API call through gws_run — Google accepts only the gmail.settings.basic scope on those, which is not granted. Filters must be changed in Gmail's own settings.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    annotations: READ("List email filters"),
  },
  /* gmail_create_filter and gmail_delete_filter are withheld on purpose.
   *
   * Writing a filter goes through users.settings.filters.create/delete, and
   * Google accepts ONLY gmail.settings.basic there — gmail.modify does not
   * carry it, so both calls fail with insufficient scopes no matter what the
   * caller does. A tool that can only fail is worse than a missing one: it
   * advertises a capability, and the error arrives after someone has already
   * decided to rely on it.
   *
   * Reading filters is unaffected and stays: users.settings.filters.list
   * accepts gmail.modify, which is why gmail_list_filters works today.
   *
   * Restore both when gmail.settings.basic is granted. The implementations
   * are in this file's history; nothing else needs to change.
   */
  {
    name: "gmail_create_label",
    description:
      "Create a Gmail label, or find it if it already exists. Nested labels use '/' in the name (e.g. 'Alerts/Invoices'). Returns the label including its ID, which can be used with gmail_label_message; when a label with that name already exists the existing label is returned as found (existed: true), so it is safe to call once per run without listing labels first.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The label name to create",
        },
      },
      required: ["name"],
    },
    annotations: CREATE("Create email label"),
  },
  {
    name: "gmail_list_labels",
    description:
      "List every label in the mailbox, system and user-created, with each label's ID, name and type. Use this to find the label ID that gmail_label_message, gmail_update_label and gmail_delete_label need.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: READ("List email labels"),
  },
  {
    name: "gmail_update_label",
    description:
      "Rename an existing Gmail label, or change its visibility. Takes the label ID (from gmail_list_labels), not the label name. Renaming a label keeps it on every message already labelled with it.",
    inputSchema: {
      type: "object",
      properties: {
        label_id: {
          type: "string",
          description: "The label ID to update (from gmail_list_labels)",
        },
        name: {
          type: "string",
          description: "New label name. Nested labels use '/' (e.g. 'Alerts/Invoices')",
        },
        label_list_visibility: {
          type: "string",
          description:
            "Whether the label shows in the label list: labelShow, labelShowIfUnread, or labelHide",
        },
        message_list_visibility: {
          type: "string",
          description:
            "Whether the label shows on messages in the message list: show or hide",
        },
      },
      required: ["label_id"],
    },
    // Non-destructive by the same rule as sheets_rename_tab: it changes a
    // label, not data. Messages keep the label; only its name or visibility
    // moves.
    annotations: CREATE("Rename an email label or change its visibility"),
  },
  {
    name: "gmail_delete_label",
    description:
      "Delete a Gmail label. Takes the label ID (from gmail_list_labels), not the label name. This removes the label from every message that carries it; the messages themselves are not deleted. System labels (INBOX, UNREAD, SENT) cannot be deleted.",
    inputSchema: {
      type: "object",
      properties: {
        label_id: {
          type: "string",
          description: "The label ID to delete (from gmail_list_labels)",
        },
      },
      required: ["label_id"],
    },
    annotations: MUTATE("Delete email label and remove it from all mail"),
  },
  {
    name: "gmail_label_message",
    description:
      'Label many messages in ONE call: pass message_ids (up to 1000) with add_labels and/or remove_labels, and every message is modified by a single users.messages.batchModify request. Do not call this once per message. The label-and-mark-read pair is one call: add_labels: ["<label id>"], remove_labels: ["UNREAD"]. Removing INBOX archives; removing UNREAD marks read. Label IDs come from gmail_list_labels. Returns a per-message outcome (results[]: id, ok, error) so a partial batch is visible; if the batch request is refused, each id is retried on its own and reported. message_id is for a single message only.',
    inputSchema: {
      type: "object",
      properties: {
        message_ids: {
          type: "array",
          items: { type: "string" },
          description:
            "The message IDs to modify together in one call, up to 1000. Prefer this over message_id whenever there is more than one message.",
        },
        message_id: {
          type: "string",
          description: "A single message ID, for the one-message case only. Provide either this or message_ids.",
        },
        add_labels: {
          type: "array",
          items: { type: "string" },
          description: 'Label IDs to add, e.g. ["Label_12"]',
        },
        remove_labels: {
          type: "array",
          items: { type: "string" },
          description:
            'Label IDs to remove, e.g. ["INBOX"] to archive or ["UNREAD"] to mark read; combine with add_labels to label and mark read in the same call',
        },
      },
      required: [],
    },
    annotations: MUTATE("Add or remove labels on email"),
  },
  {
    name: "gmail_save_attachment_to_drive",
    description:
      "Save a Gmail attachment directly to Google Drive. Use gmail_read first to get attachment metadata (filename, mimeType, attachmentId) from the message parts. The file is fetched from Gmail and uploaded to Drive server-side — no base64 data flows through the conversation. Returns the Drive file metadata including a web link.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "The Gmail message ID that contains the attachment",
        },
        attachment_id: {
          type: "string",
          description:
            "The attachment ID from the message part's body.attachmentId field",
        },
        filename: {
          type: "string",
          description: "Filename to save as in Drive (e.g., 'report.xlsx')",
        },
        parent_folder_id: {
          type: "string",
          description:
            "Optional Drive folder ID to save into. If omitted, saves to the root of My Drive.",
        },
      },
      required: ["message_id", "attachment_id", "filename"],
    },
    annotations: CREATE("Save email attachment to Drive"),
  },
];

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailPart & { headers?: { name: string; value: string }[] };
}

function getHeader(msg: GmailMessage, name: string): string | undefined {
  const lower = name.toLowerCase();
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === lower)
    ?.value;
}

function flattenMessage(msg: GmailMessage) {
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(msg, "From"),
    to: getHeader(msg, "To"),
    subject: getHeader(msg, "Subject"),
    date: getHeader(msg, "Date"),
    snippet: msg.snippet,
    labelIds: msg.labelIds,
  };
}

function findPart(
  part: GmailPart | undefined,
  mimeType: string
): GmailPart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const p of part.parts ?? []) {
    const found = findPart(p, mimeType);
    if (found) return found;
  }
  return undefined;
}

/** How much of a message's HTML part is flattened for the text view.
 *
 * SCRUM-283: flattening is linear now, so this is defence in depth rather than
 * the primary control — but the input is an INBOUND message's markup, chosen
 * by whoever sent the mail, and the only other bound on it is Gmail's ~25MB
 * message limit. `max_body_chars` is no help here: it truncates the text
 * AFTER extraction, so it never reduces the work. Real HTML mail, marketing
 * included, sits far below this. */
const MAX_HTML_EXTRACT_CHARS = 512 * 1024;

function extractTextBody(payload: GmailPart | undefined): string {
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) {
    return Buffer.from(plain.body.data, "base64url").toString("utf-8");
  }
  const html = findPart(payload, "text/html");
  if (html?.body?.data) {
    const raw = Buffer.from(html.body.data, "base64url").toString("utf-8");
    if (raw.length <= MAX_HTML_EXTRACT_CHARS) return stripHtml(raw);
    // Said out loud rather than silently: a reader who cannot tell a short
    // email from a truncated one will read the absence of text as absence of
    // content.
    // Do not cut through a surrogate pair: half of one renders as a
    // replacement character, which reads as corrupted content rather than as
    // truncated content.
    let end = MAX_HTML_EXTRACT_CHARS;
    const last = raw.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    return `${stripHtml(raw.slice(0, end))}\n…[truncated ${
      raw.length - end
    } of ${raw.length} chars of HTML before text extraction]`;
  }
  return "";
}

function listAttachments(
  part: GmailPart | undefined,
  out: {
    partId?: string;
    filename?: string;
    mimeType?: string;
    attachmentId: string;
    size?: number;
  }[] = []
) {
  if (part?.body?.attachmentId) {
    out.push({
      // The part's place in the message. It is the same on every read, where
      // the attachmentId is issued new each time.
      partId: part.partId,
      filename: part.filename,
      mimeType: part.mimeType,
      attachmentId: part.body.attachmentId,
      size: part.body.size,
    });
  }
  for (const p of part?.parts ?? []) listAttachments(p, out);
  return out;
}

/** The body pair a compose tool was given, checked once so gmail_send and the
 * raw-MIME builder state the same contract. */
function resolveBody(
  toolName: string,
  args: Record<string, unknown>
): { body?: string; html?: string } {
  const body = args.body as string | undefined;
  const html = args.html_body as string | undefined;
  if (body === undefined && html === undefined) {
    throw new Error(
      `${toolName}: provide body (plain text), html_body (HTML), or both.`
    );
  }
  return { body, html };
}

/** `gmail_reply` and `gmail_forward` have ONE body slot: either plain or HTML,
 * never both. Both at once is refused rather than one silently dropped — a
 * message sent with half its content missing would be this ticket's silent
 * failure wearing a new hat.
 *
 * Was `htmlOrPlainBody`, which also returned CLI helper flags; nothing has
 * consumed those since the send paths stopped using the helper, so it is now
 * only the assertion its callers actually wanted. */
/** Every argument contract error for the single-body-slot tools, raised
 * SYNCHRONOUSLY so a caller can clear them before starting any request. That
 * property used to hold because signing ran first; now the signature lookup
 * and the original fetch are issued together, so it has to be asserted here
 * or a bad call would cost an API call. */
function assertBodyContract(
  toolName: string,
  args: Record<string, unknown>,
  opts?: { requireBody?: boolean }
): void {
  assertSingleBodySlot(toolName, args);
  if (opts?.requireBody && args.body === undefined && args.html_body === undefined) {
    throw new Error(`${toolName}: provide body (plain text) or html_body (HTML).`);
  }
}

function assertSingleBodySlot(
  toolName: string,
  args: Record<string, unknown>
): void {
  if (args.body !== undefined && args.html_body !== undefined) {
    throw new Error(
      `${toolName}: provide body or html_body, not both. This path has a ` +
        "single body slot; a separate plain-text fallback is only supported " +
        "on gmail_send and the draft tools."
    );
  }
}

/** A header is ASCII or it is not a header (SCRUM-249): the subject and any
 * display name go out RFC 2047 encoded when they need it, addresses never.
 * A line break in any of them is refused outright: encoded it would be
 * harmless, bare it would start a header the caller never asked for.
 *
 * Called before the signature lookup as well as inside the raw builder, so a
 * malformed header costs no API call at all. */
function assertHeadersSingleLine(args: Record<string, unknown>): void {
  for (const k of ["to", "subject", "cc", "bcc"]) {
    if (typeof args[k] === "string" && /[\r\n]/.test(args[k] as string)) {
      throw new Error(`${k} must not contain a line break`);
    }
  }
}

/** multipart/alternative, plain part FIRST: clients prefer the last part they
 * can render, so text/html must come after the fallback.
 *
 * The single owner of the wire shape — boundary token, part order, part
 * headers — for every send path. */
function renderMultipartAlternative(
  headers: string[],
  plain: string,
  html: string
): string {
  const boundary = `=_gws_${randomUUID()}`;
  const all = [
    ...headers,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const content = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    plain,
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    html,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return Buffer.from(`${renderHeaders(all)}\r\n\r\n${content}`).toString(
    "base64url"
  );
}

/** The message's own headers for gmail_send and the draft tools. */
function composeHeaders(args: Record<string, unknown>): string[] {
  assertHeadersSingleLine(args);
  const headers = [
    `To: ${encodeAddressHeader(args.to as string)}`,
    `Subject: ${encodeHeaderValue(args.subject as string)}`,
  ];
  if (args.cc) headers.push(`Cc: ${encodeAddressHeader(args.cc as string)}`);
  if (args.bcc) headers.push(`Bcc: ${encodeAddressHeader(args.bcc as string)}`);
  return headers;
}

/** The plain part, and the HTML part when there is one.
 *
 * The plain fallback is the caller's text when given, otherwise text derived
 * from the markup BEFORE the signature went in, so the plain part never
 * carries it. Derived HERE and nowhere earlier, because this is the only place
 * a plain part is actually built. */
function composeBodies(bodies: { body?: string; html?: string; unsignedHtml?: string }): {
  plain: string;
  html?: string;
} {
  if (bodies.html === undefined) return { plain: bodies.body as string };
  return { plain: bodies.body ?? derivePlain(bodies.unsignedHtml ?? bodies.html), html: bodies.html };
}

function renderPlainMessage(headers: string[], plain: string): string {
  return Buffer.from(
    `${renderHeaders([...headers, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8"])}\r\n\r\n${plain}`
  ).toString("base64url");
}

function renderRaw(headers: string[], composed: { plain: string; html?: string }): string {
  return composed.html !== undefined
    ? renderMultipartAlternative(headers, composed.plain, composed.html)
    : renderPlainMessage(headers, composed.plain);
}

/** `bodies` is passed in rather than read off `args` so the signature can be
 * applied to the RESOLVED body before any path branches (SCRUM-278). */
function buildRawMessage(
  toolName: string,
  args: Record<string, unknown>,
  bodies: { body?: string; html?: string; unsignedHtml?: string }
): string {
  return renderRaw(composeHeaders(args), composeBodies(bodies));
}

/** Google Docs, Sheets and Slides go in the note as links, the way Gmail
 * sends them: one line per file, in the plain part and the HTML part both,
 * placed before signing so the order is note, links, signature, quote.
 * With no links the bodies come back as they were given. */
function withLinks(
  bodies: { body?: string; html?: string },
  links: Resolved["links"]
): { body?: string; html?: string } {
  if (links.length === 0) return bodies;
  const plainBlock = links.map((l) => `${l.name}: ${l.link}`).join("\n");
  const htmlBlock =
    '<div class="gws_drive_links">' +
    links.map((l) => `<div><a href="${escapeHtml(l.link)}">${escapeHtml(l.name)}</a></div>`).join("") +
    "</div>";
  const plain = bodies.body ?? (bodies.html !== undefined ? derivePlain(bodies.html) : "");
  const html = bodies.html ?? plainToHtml(plain);
  return {
    body: plain === "" ? plainBlock : `${plain}\n\n${plainBlock}`,
    html: appendToHtml(html, `${html === "" ? "" : "<br>"}${htmlBlock}`),
  };
}

type Delivery =
  | { kind: "send"; threadId?: string }
  | { kind: "draft_create" }
  | { kind: "draft_update"; draftId: string; threadId?: string };

/** Hand a composed message with attachments to Gmail.
 *
 * Files go as one streamed message/rfc822 upload built as it is sent, so no
 * attachment is ever held whole. A message whose attachments all turned out
 * to be links has no bytes to stream and goes as raw MIME exactly as an
 * unattached one does. */
async function deliver(
  client: GwsClient,
  delivery: Delivery,
  headers: string[],
  composed: { plain: string; html?: string },
  files: PlannedFile[]
): Promise<unknown> {
  const params: Record<string, unknown> = { userId: "me" };
  if (delivery.kind === "draft_update") params.id = delivery.draftId;
  const threadId = delivery.kind === "draft_create" ? undefined : delivery.threadId;
  // Each call names its method literally: the oracle test reads these call
  // sites to know which methods the tools use.
  if (files.length === 0) {
    const message = { raw: renderRaw(headers, composed), ...(threadId ? { threadId } : {}) };
    const result =
      delivery.kind === "send"
        ? await client.api("gmail", "users.messages", "send", { params, jsonBody: message })
        : delivery.kind === "draft_create"
          ? await client.api("gmail", "users.drafts", "create", { params, jsonBody: { message } })
          : await client.api("gmail", "users.drafts", "update", { params, jsonBody: { message } });
    return result.data;
  }

  const thread = threadId ? { threadId } : {};
  const upload = {
    params,
    metadata: delivery.kind === "send" ? thread : threadId ? { message: thread } : {},
    contentType: "message/rfc822",
    source: buildMessage(headers, composed, placeFiles(files, composed.html)),
  };
  const result =
    delivery.kind === "send"
      ? await client.upload("gmail", "users.messages", "send", upload)
      : delivery.kind === "draft_create"
        ? await client.upload("gmail", "users.drafts", "create", upload)
        : await client.upload("gmail", "users.drafts", "update", upload);
  return result.data;
}

/** Every response that carried attachments says what became of each. A call
 * with none carries no `attachments` key at all, so its response is as it
 * always was. */
function withReport<T extends Record<string, unknown>>(body: T, report?: ReportEntry[]): T {
  return report && report.length > 0 ? { ...body, attachments: report } : body;
}

/** The draft tools report the signature outcome the way the send tools do. */
function draftResponse(data: unknown, signature: SignatureState, report?: ReportEntry[]) {
  const draft = data as { id?: string; message?: { id?: string; threadId?: string } };
  const messageId = draft?.message?.id || "";
  return jsonResponse(
    withReport(
      {
        ...draft,
        gmail_url: `https://mail.google.com/mail/u/0/#drafts?compose=${messageId}`,
        signature,
      },
      report
    )
  );
}

async function fetchMessageList(
  client: GwsClient,
  listParams: Record<string, unknown>
) {
  const result = await client.api("gmail", "users.messages", "list", {
    params: { userId: "me", ...listParams },
  });
  const messages = (result.data as { messages?: { id: string }[] })?.messages;
  if (!messages || messages.length === 0) {
    return jsonResponse("No messages found.");
  }
  const details = await Promise.all(
    messages.map((m) =>
      client.api("gmail", "users.messages", "get", {
        // NOTE: no metadataHeaders filter. A comma-joined value matches no
        // header name and silently returns zero headers; an array would be
        // sent as a repeated key by the pinned gws CLI (SCRUM-178), but plain
        // metadata format already returns every header, and we flatten to
        // the few we need below, so there is nothing to gain by filtering.
        params: {
          userId: "me",
          id: m.id,
          format: "metadata",
        },
      })
    )
  );
  return jsonResponse(
    details.map((d) => flattenMessage(d.data as GmailMessage))
  );
}

/** A Gmail label as the API returns it. */
export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

/** Find a label by its display name. Used to recover the label a create call
 * made when the API answers with an empty body. */
/** Gmail refuses a duplicate label name with a 409 whose reason reads
 * "Label name exists or conflicts"; the CLI surfaces that text, or the
 * status, or both. Anything else is a different refusal. */
function isLabelExistsError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /\b409\b|already exists|name exists|conflict/i.test(text);
}

async function findLabelByName(
  client: GwsClient,
  name: string
): Promise<GmailLabel | undefined> {
  const result = await client.api("gmail", "users.labels", "list", {
    params: { userId: "me" },
  });
  const data = result.data as { labels?: GmailLabel[] } | undefined;
  return (data?.labels ?? []).find((label) => label.name === name);
}

/** Apply a label modification to one message or a batch of them. Shared by
 * gmail_mark_read and gmail_label_message, which build different bodies (see
 * their cases) but issue the same call. */
/** One batchModify request carries at most this many ids (Google's limit). */
const BATCH_MODIFY_MAX = 1000;

async function modifyMessageLabels(
  client: GwsClient,
  args: Record<string, unknown>,
  body: Record<string, unknown>
) {
  const ids = args.message_ids as string[] | undefined;
  if (ids?.length) {
    if (ids.length > BATCH_MODIFY_MAX) {
      throw new Error(
        `message_ids carries ${ids.length} ids; one call takes at most ${BATCH_MODIFY_MAX}. Split the batch.`
      );
    }
    // SCRUM-233: one request for the whole batch, and a per-message outcome
    // either way. batchModify answers with an empty body on success and
    // refuses the WHOLE request when any id is bad, so on a refusal each id
    // is modified on its own and reported, which is what makes a partial
    // batch visible instead of a silent all-or-nothing.
    let results: Array<{ id: string; ok: boolean; error?: string }>;
    try {
      await client.api("gmail", "users.messages", "batchModify", {
        params: { userId: "me" },
        jsonBody: { ids, ...body },
      });
      results = ids.map((id) => ({ id, ok: true }));
    } catch {
      results = [];
      for (const id of ids) {
        try {
          await client.api("gmail", "users.messages", "modify", {
            params: { userId: "me", id },
            jsonBody: body,
          });
          results.push({ id, ok: true });
        } catch (err) {
          results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    const modified = results.filter((r) => r.ok).length;
    return jsonResponse({ modified, failed: results.length - modified, ids, results, ...body });
  }

  if (!args.message_id) {
    throw new Error("Provide either message_id or message_ids");
  }
  const result = await client.api("gmail", "users.messages", "modify", {
    params: { userId: "me", id: args.message_id },
    jsonBody: body,
  });
  const data = result.data as { id?: string } | undefined;
  // modify can also answer with an empty body; say what was applied rather
  // than returning nothing.
  return jsonResponse(data?.id ? data : { id: args.message_id, ...body });
}

/** Every send tool's response carries the signature outcome, so a caller can
 * tell an applied signature from a missing one from a failed lookup. */
function sentResponse(
  data: unknown,
  signature: SignatureState,
  report?: ReportEntry[],
  extra: Record<string, unknown> = {}
) {
  const base = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return jsonResponse(withReport({ ...base, signature, ...extra }, report));
}

/** Sign the body for the CLI helpers that have ONE body slot (+reply,
 * +forward). When a signature promotes a plain note to HTML, the HTML is what
 * goes out with --html and the CLI quotes the original beneath it, which is
 * how the signature lands above the quoted message rather than below it. */
/** Sign a reply/forward body and hand back the BODIES, not CLI flags.
 *
 * It used to return `{ body, html: true }` for the CLI helper, which forced a
 * signed reply down a single-part text/html composer and cost it its plain
 * alternative. The caller now builds multipart/alternative from both of these,
 * so `unsignedHtml` matters: it is what the plain part is derived from, so the
 * signature can never reach it. */
async function signSingleSlotBody(
  client: GwsClient,
  toolName: string,
  args: Record<string, unknown>,
  opts?: { requireBody?: boolean },
  links: Resolved["links"] = []
): Promise<{
  body?: string;
  html?: string;
  unsignedHtml?: string;
  state: SignatureState;
}> {
  assertBodyContract(toolName, args, opts);

  const body = args.body as string | undefined;
  const html = args.html_body as string | undefined;
  const signed = await applySignature(
    client,
    args,
    withLinks(html !== undefined ? { html } : { body: body ?? "" }, links)
  );
  return {
    body: signed.body,
    html: signed.html,
    unsignedHtml: signed.unsignedHtml,
    state: signed.state,
  };
}

/** Send a draft, signing the MIME Gmail already stored for it.
 *
 * Nothing here may cost the user their send. A shape we will not rewrite, a
 * signature we cannot read, or a draft too large to rewrite on a shared
 * event loop all fall through to sending the draft exactly as it stands, with the
 * reason in the response. If the update lands and the send then fails, a
 * retry finds the signature already there and does not add a second one. */
async function sendDraft(client: GwsClient, args: Record<string, unknown>) {
  const draftId = args.draft_id as string;
  const send = async (signature: SignatureState) => {
    const result = await client.api("gmail", "users.drafts", "send", {
      params: { userId: "me" },
      jsonBody: { id: draftId },
    });
    return sentResponse(result.data, signature);
  };

  if (suppressionRequested(args.signature)) return send("suppressed");

  // Nothing below may cost the user their send, so every failure falls
  // through to sending the draft as it stands. A get we cannot complete is
  // reported `unavailable` — we could not read what we needed, the same
  // family as a failed signature lookup — while a shape or a rewrite we
  // decline is `skipped_unsupported_draft`.
  let message: { raw?: string; threadId?: string } | undefined;
  try {
    const existing = await client.api("gmail", "users.drafts", "get", {
      params: { userId: "me", id: draftId, format: "raw" },
    });
    message = (existing.data as { message?: { raw?: string; threadId?: string } } | undefined)
      ?.message;
  } catch {
    return send("unavailable");
  }
  if (!message?.raw) return send("skipped_unsupported_draft");

  // A Gmail draft can be written from an alias, so the signature comes from
  // the sendAs entry matching the draft's own From header.
  const sig = await lookupSignature(client, draftFromHeader(message.raw));
  if (!sig.ok) return send(sig.state);

  // Wrapped because the guarantee above is that NOTHING here costs the user
  // their send, and a guarantee that rests on "this function cannot throw" is
  // an argument rather than a control.
  let rewritten: ReturnType<typeof signDraftRaw>;
  try {
    rewritten = signDraftRaw(message.raw, sig);
  } catch {
    return send("skipped_unsupported_draft");
  }
  if (rewritten.state !== "applied" || !rewritten.raw) return send(rewritten.state);

  const updateBody: Record<string, unknown> = { raw: rewritten.raw };
  if (message.threadId) updateBody.threadId = message.threadId;

  try {
    if (rewritten.raw.length > DRAFT_SIGN_MAX_CHARS) {
      // A draft carrying files (SCRUM-279) goes back as media, not as a JSON
      // string the size of every file it holds.
      const bytes = Buffer.from(rewritten.raw, "base64url");
      await client.upload("gmail", "users.drafts", "update", {
        params: { userId: "me", id: draftId },
        metadata: message.threadId ? { message: { threadId: message.threadId } } : {},
        contentType: "message/rfc822",
        source: (async function* () {
          yield bytes;
        })(),
      });
    } else {
      await client.api("gmail", "users.drafts", "update", {
        params: { userId: "me", id: draftId },
        jsonBody: { message: updateBody },
      });
    }
  } catch {
    // Gmail refused our rewrite. The draft is untouched on the server, so
    // send what the user actually wrote rather than failing their send.
    return send("skipped_unsupported_draft");
  }
  return send("applied");
}

/** The original message a reply or forward is built from.
 *
 * Read through the API rather than left to the CLI helper: the helper accepts
 * ONE body and a boolean --html, so it can emit text/plain OR a single
 * text/html part and never both, which is why a signed reply used to lose its
 * plain alternative. Composing here is what makes multipart/alternative
 * possible on every send path. */
/** Every part of a message that carries a filename: what a forward carries
 * along (SCRUM-279). Parts without one are the message's own text. */
function filenameParts(messageId: string, part: GmailPart | undefined, out: OriginalPart[] = []): OriginalPart[] {
  if (!part) return out;
  if (part.filename && (part.body?.attachmentId || part.body?.data)) {
    out.push({
      messageId,
      filename: part.filename,
      mimeType: part.mimeType,
      size: part.body?.size,
      attachmentId: part.body?.attachmentId,
      data: part.body?.attachmentId ? undefined : part.body?.data,
      contentId: part.headers?.find((h) => h.name.toLowerCase() === "content-id")?.value,
    });
  }
  for (const p of part.parts ?? []) filenameParts(messageId, p, out);
  return out;
}

async function fetchOriginal(
  client: GwsClient,
  messageId: string
): Promise<{ original: OriginalMessage; threadId?: string; parts: OriginalPart[] }> {
  const result = await client.api("gmail", "users.messages", "get", {
    params: { userId: "me", id: messageId, format: "full" },
  });
  const message = result.data as GmailMessage;
  const header = (name: string) => getHeader(message, name) ?? "";
  const decode = (mime: string) => {
    const part = findPart(message.payload, mime);
    return part?.body?.data
      ? Buffer.from(part.body.data, "base64url").toString("utf-8")
      : undefined;
  };
  return {
    threadId: message.threadId,
    parts: filenameParts(messageId, message.payload),
    original: {
      from: header("From"),
      replyTo: header("Reply-To") || undefined,
      to: header("To") || undefined,
      cc: header("Cc") || undefined,
      // Gmail labels a message SENT only when this account sent it.
      selfSent: message.labelIds?.includes("SENT") ?? false,
      date: header("Date"),
      subject: header("Subject"),
      messageId: header("Message-ID") || header("Message-Id"),
      references: header("References") || undefined,
      plain: decode("text/plain"),
      html: decode("text/html"),
    },
  };
}

/** gmail_send and gmail_create_draft with attachments. Drive metadata is
 * read before signing, because links go into the note above the signature;
 * every refusal (shape, size, a missing or folder id) lands before the
 * signature lookup and before any byte is fetched. */
async function sendWithAttachments(
  client: GwsClient,
  toolName: string,
  args: Record<string, unknown>,
  entries: ParsedEntry[]
) {
  const bodies = resolveBody(toolName, args);
  const headers = composeHeaders(args);
  const resolved = await resolveAttachments(client, entries);
  const signed = await applySignature(client, args, withLinks(bodies, resolved.links));
  const delivery: Delivery = toolName === "gmail_send" ? { kind: "send" } : { kind: "draft_create" };
  const data = await deliver(client, delivery, headers, composeBodies(signed), resolved.files);
  return toolName === "gmail_send"
    ? sentResponse(data, signed.state, resolved.report)
    : draftResponse(data, signed.state, resolved.report);
}

export async function handleGmail(
  client: GwsClient,
  toolName: string,
  args: Record<string, unknown>
) {
  switch (toolName) {
    case "gmail_send": {
      assertHeadersSingleLine(args);
      const entries = parseAttachments(args.attachments);
      if (entries.length > 0) return sendWithAttachments(client, toolName, args, entries);
      // The signature is applied to the RESOLVED body, before anything builds
      // MIME, so no send path can be reached without it having been offered.
      const signed = await applySignature(client, args, resolveBody(toolName, args));
      // Every send goes out as raw MIME built here. The gws CLI helper used to
      // carry plain ASCII sends and emitted a single text/html part with no
      // fallback once HTML was involved; it is off every send path now, so the
      // wire shape no longer depends on which branch a call happened to take,
      // and header encoding (SCRUM-249) is this module's on every route.
      const result = await client.api("gmail", "users.messages", "send", {
        params: { userId: "me" },
        jsonBody: { raw: buildRawMessage(toolName, args, signed) },
      });
      return sentResponse(result.data, signed.state);
    }

    case "gmail_reply": {
      // Composing here puts reply on the same raw header path as gmail_send,
      // so it needs the same guard. encodeAddressHeader is NOT a defence: it
      // returns a value containing CRLF verbatim.
      assertHeadersSingleLine(args);
      assertBodyContract(toolName, args, { requireBody: true });
      const entries = parseAttachments(args.attachments);
      let signed: Awaited<ReturnType<typeof signSingleSlotBody>>;
      let fetched: Awaited<ReturnType<typeof fetchOriginal>>;
      let resolved: Resolved | undefined;
      if (entries.length === 0) {
        // Independent: the signature lookup reads the account's sendAs, the
        // fetch reads the message being replied to, and neither needs the
        // other's result. Issued together, they cost one round trip instead of
        // two. Both contract asserts ran above, so a bad call still costs none.
        [signed, fetched] = await Promise.all([
          signSingleSlotBody(client, toolName, args, { requireBody: true }),
          fetchOriginal(client, args.message_id as string),
        ]);
      } else {
        // Links go into the note before the signature, so the Drive metadata
        // is read (alongside the original) before signing.
        [resolved, fetched] = await Promise.all([
          resolveAttachments(client, entries),
          fetchOriginal(client, args.message_id as string),
        ]);
        signed = await signSingleSlotBody(client, toolName, args, { requireBody: true }, resolved.links);
      }
      const { original, threadId } = fetched;
      // Reply all leaves the account's own addresses out, which takes the
      // account's send-as list. Read only then: a plain reply needs no
      // address but the ones on the original.
      const replyAll = args.reply_all === true;
      const recipients = replyRecipients(original, {
        replyAll,
        ownAddresses: replyAll ? await ownAddresses(client) : [],
      });
      // The caller's own statement of who this should reach, checked before
      // anything is composed or sent.
      assertExpectedRecipients(recipients, args.expected_to);
      const to = addressLine(recipients.to);
      const cc = addressLine(recipients.cc);
      const plainBody =
        signed.body ??
        derivePlain(signed.unsignedHtml ?? (args.html_body as string) ?? "");
      const bodies = buildReplyBodies(
        original,
        plainBody,
        signed.html ?? plainToHtml(plainBody)
      );
      const headers = [
        `To: ${encodeAddressHeader(to)}`,
        ...(cc ? [`Cc: ${encodeAddressHeader(cc)}`] : []),
        `Subject: ${encodeHeaderValue(replySubject(original.subject))}`,
        ...threadHeaders(original),
      ];
      // Where it went is part of the answer: a Reply-To can name someone
      // other than the sender, and the caller should see that it did.
      // A reply that did not reach the original's sender says so, and names
      // the sender it left out.
      const redirected = replyRedirected(original, [...recipients.to, ...recipients.cc]);
      const sentTo = {
        to,
        ...(cc ? { cc } : {}),
        ...(redirected ? { reply_to_used: true, original_from: addressOnly(original.from) } : {}),
      };
      if (resolved) {
        const data = await deliver(client, { kind: "send", threadId }, headers, { plain: bodies.plain, html: bodies.html }, resolved.files);
        return sentResponse(data, signed.state, resolved.report, sentTo);
      }
      const result = await client.api("gmail", "users.messages", "send", {
        params: { userId: "me" },
        jsonBody: {
          raw: renderMultipartAlternative(headers, bodies.plain, bodies.html),
          ...(threadId ? { threadId } : {}),
        },
      });
      return sentResponse(result.data, signed.state, undefined, sentTo);
    }

    case "gmail_forward": {
      assertHeadersSingleLine(args);
      assertBodyContract(toolName, args);
      const entries = parseAttachments(args.attachments);
      const carry = !suppressionRequested(args.include_original_attachments);
      let signed: Awaited<ReturnType<typeof signSingleSlotBody>>;
      let fetched: Awaited<ReturnType<typeof fetchOriginal>>;
      let resolved: Resolved | undefined;
      if (entries.length === 0) {
        [signed, fetched] = await Promise.all([
          signSingleSlotBody(client, toolName, args),
          fetchOriginal(client, args.message_id as string),
        ]);
        // The original's own files come along unless the caller opted out.
        // No Drive entries means no links, so signing first changes nothing.
        if (carry && fetched.parts.length > 0) resolved = await resolveAttachments(client, [], fetched.parts);
      } else {
        const fetching = fetchOriginal(client, args.message_id as string);
        resolved = await resolveAttachments(
          client,
          entries,
          fetching.then((f) => (carry ? f.parts : []))
        );
        fetched = await fetching;
        signed = await signSingleSlotBody(client, toolName, args, undefined, resolved.links);
      }
      const { original } = fetched;
      const to = args.to as string;
      const note = signed.body ?? "";
      const noteHtml = signed.html ?? plainToHtml(note);
      const originalPlain = originalPlainText(original);
      const originalHtml = originalHtmlBody(original);
      const headers = [
        `To: ${encodeAddressHeader(to)}`,
        `Subject: ${encodeHeaderValue(forwardSubject(original.subject))}`,
        ...threadHeaders(original),
      ];
      const plain = [note, "", forwardPlainBlock(original, to, originalPlain)].join("\n");
      const html = `${noteHtml}<br>\n${forwardHtmlBlock(original, to, originalHtml)}`;
      if (resolved) {
        const data = await deliver(client, { kind: "send" }, headers, { plain, html }, resolved.files);
        return sentResponse(data, signed.state, resolved.report);
      }
      const result = await client.api("gmail", "users.messages", "send", {
        params: { userId: "me" },
        jsonBody: { raw: renderMultipartAlternative(headers, plain, html) },
      });
      return sentResponse(result.data, signed.state);
    }

    case "gmail_read": {
      const result = await client.api("gmail", "users.messages", "get", {
        params: {
          userId: "me",
          id: args.message_id,
          format: "full",
        },
      });
      const maxBodyChars = args.max_body_chars as number | undefined;
      if (!args.text_only && maxBodyChars === undefined) {
        return jsonResponse(result.data);
      }

      const msg = result.data as GmailMessage;
      let body = extractTextBody(msg.payload);
      if (maxBodyChars !== undefined) {
        body = truncate(body, maxBodyChars);
      }
      return jsonResponse({
        ...flattenMessage(msg),
        cc: getHeader(msg, "Cc"),
        body,
        attachments: listAttachments(msg.payload),
      });
    }

    case "gmail_search":
      return fetchMessageList(client, {
        q: args.query,
        maxResults: (args.max_results as number) || 10,
      });

    case "gmail_list":
      return fetchMessageList(client, {
        labelIds: (args.label as string) || "INBOX",
        maxResults: (args.max_results as number) || 10,
      });

    case "gmail_save_attachment_to_drive": {
      // The transport owns how the bytes move: decoded as they stream in and
      // uploaded in bounded chunks, never through the conversation.
      const uploaded = await client.gmailAttachmentToDrive({
        messageId: args.message_id as string,
        attachmentId: args.attachment_id as string,
        name: args.filename as string,
        parent: args.parent_folder_id as string | undefined,
      });
      return jsonResponse(uploaded.data);
    }

    case "gmail_create_draft": {
      // Same order as gmail_send: refuse a bad header before the lookup costs
      // a call, sign the RESOLVED body, then build MIME from what came back.
      assertHeadersSingleLine(args);
      const entries = parseAttachments(args.attachments);
      if (entries.length > 0) return sendWithAttachments(client, toolName, args, entries);
      const signed = await applySignature(client, args, resolveBody(toolName, args));
      const result = await client.api("gmail", "users.drafts", "create", {
        params: { userId: "me" },
        jsonBody: { message: { raw: buildRawMessage(toolName, args, signed) } },
      });
      return draftResponse(result.data, signed.state);
    }

    case "gmail_update_draft": {
      assertHeadersSingleLine(args);
      const entries = parseAttachments(args.attachments);
      const bodies = resolveBody(toolName, args);
      const threadOf = () =>
        args.thread_id
          ? Promise.resolve(args.thread_id as string)
          : client
              .api("gmail", "users.drafts", "get", {
                params: { userId: "me", id: args.draft_id, format: "metadata" },
              })
              .then((existing) => (existing.data as { message?: { threadId?: string } })?.message?.threadId);
      if (entries.length > 0) {
        const [resolved, threadId] = await Promise.all([resolveAttachments(client, entries), threadOf()]);
        const signed = await applySignature(client, args, withLinks(bodies, resolved.links));
        const data = await deliver(
          client,
          { kind: "draft_update", draftId: args.draft_id as string, threadId },
          composeHeaders(args),
          composeBodies(signed),
          resolved.files
        );
        return draftResponse(data, signed.state, resolved.report);
      }
      // Independent: the signature lookup reads the account's sendAs, the get
      // reads the draft's thread, and neither needs the other's result.
      const [signed, existingThreadId] = await Promise.all([applySignature(client, args, bodies), threadOf()]);

      const message: Record<string, unknown> = { raw: buildRawMessage(toolName, args, signed) };
      if (existingThreadId) message.threadId = existingThreadId;

      const result = await client.api("gmail", "users.drafts", "update", {
        params: { userId: "me", id: args.draft_id },
        jsonBody: { message },
      });
      return draftResponse(result.data, signed.state);
    }

    case "gmail_send_draft":
      return sendDraft(client, args);

    case "gmail_delete_draft": {
      await client.api("gmail", "users.drafts", "delete", {
        params: { userId: "me", id: args.draft_id },
      });
      return jsonResponse({ deleted: true, draft_id: args.draft_id });
    }

    case "gmail_mark_read": {
      const addLabels = args.add_labels as string[] | undefined;
      const removeLabels = args.remove_labels as string[] | undefined;
      const body: Record<string, unknown> = {};
      if (addLabels?.length) body.addLabelIds = addLabels;
      if (removeLabels?.length) body.removeLabelIds = removeLabels;
      // The read-state tool's default, and ONLY a default (SCRUM-368): with
      // no label named at all, mark read. A caller who names labels gets
      // exactly those. The default used to apply whenever remove_labels was
      // empty, so add_labels alone also marked the mail read, and
      // add_labels ["UNREAD"] added and removed UNREAD in one request.
      if (!addLabels?.length && !removeLabels?.length) body.removeLabelIds = ["UNREAD"];
      return modifyMessageLabels(client, args, body);
    }

    case "gmail_label_message": {
      const addLabels = args.add_labels as string[] | undefined;
      const removeLabels = args.remove_labels as string[] | undefined;
      // No default here on purpose: this tool exists to change labels, and
      // silently marking mail read because the caller named no labels would
      // be a side effect nobody asked for.
      if (!addLabels?.length && !removeLabels?.length) {
        throw new Error("Provide add_labels, remove_labels, or both");
      }
      const body: Record<string, unknown> = {};
      if (addLabels?.length) body.addLabelIds = addLabels;
      if (removeLabels?.length) body.removeLabelIds = removeLabels;
      return modifyMessageLabels(client, args, body);
    }

    case "gmail_list_filters": {
      const result = await client.api("gmail", "users.settings.filters", "list", {
        params: { userId: "me" },
      });
      // A mailbox with no filters answers with an empty body, which returned
      // as a bare "" — indistinguishable from a failure to the caller. Say
      // "none" in the same shape as "some".
      const data = result.data as { filter?: unknown[] } | string | undefined;
      const filters =
        typeof data === "object" && Array.isArray(data?.filter) ? data.filter : [];
      return jsonResponse({ count: filters.length, filters });
    }

    case "gmail_create_label": {
      let result;
      try {
        result = await client.api("gmail", "users.labels", "create", {
          params: { userId: "me" },
          jsonBody: { name: args.name },
        });
      } catch (err) {
        // SCRUM-247: a name that is already taken is not a failure, it is
        // the label. Answer with the existing one, marked as found, so a
        // caller can create once per run and never has to list every label
        // first to learn whether one exists. Any other refusal stays an error.
        if (!isLabelExistsError(err)) throw err;
        const existing = await findLabelByName(client, args.name as string);
        if (!existing) throw err;
        return jsonResponse({ ...existing, existed: true });
      }
      // The label is created, but this call can come back with an empty
      // body, which used to be returned verbatim: the tool promised "the
      // created label including its ID" and handed back nothing, breaking
      // the documented create -> filter chain with no way to recover the id
      // short of listing labels by hand. When the id is missing, look it up.
      const created = result.data as { id?: string } | undefined;
      if (created?.id) return jsonResponse(created);
      const label = await findLabelByName(client, args.name as string);
      if (!label) {
        throw new Error(
          `Label "${args.name}" was created but could not be read back. ` +
            `Use gmail_list_labels to find its ID.`
        );
      }
      return jsonResponse(label);
    }

    case "gmail_list_labels": {
      const result = await client.api("gmail", "users.labels", "list", {
        params: { userId: "me" },
      });
      const data = result.data as { labels?: GmailLabel[] } | undefined;
      const labels = data?.labels ?? [];
      return jsonResponse({ count: labels.length, labels });
    }

    case "gmail_update_label": {
      const body: Record<string, unknown> = {};
      if (args.name !== undefined) body.name = args.name;
      if (args.label_list_visibility !== undefined) {
        body.labelListVisibility = args.label_list_visibility;
      }
      if (args.message_list_visibility !== undefined) {
        body.messageListVisibility = args.message_list_visibility;
      }
      if (Object.keys(body).length === 0) {
        throw new Error(
          "Provide at least one of name, label_list_visibility or message_list_visibility"
        );
      }
      const result = await client.api("gmail", "users.labels", "patch", {
        params: { userId: "me", id: args.label_id },
        jsonBody: body,
      });
      const updated = result.data as { id?: string } | undefined;
      if (updated?.id) return jsonResponse(updated);
      // Same empty-body shape as create: report what was asked for rather
      // than an empty success.
      return jsonResponse({ id: args.label_id, ...body });
    }

    case "gmail_delete_label": {
      await client.api("gmail", "users.labels", "delete", {
        params: { userId: "me", id: args.label_id },
      });
      return deleteResponse(`Label ${args.label_id}`);
    }

    default:
      throw new Error(`Unknown Gmail tool: ${toolName}`);
  }
}
