import { createHash } from "node:crypto";
import { NotionApiError, NotionUnreachableError, type NotionClient } from "../notion-client.js";
import { notionId } from "../notion-id.js";
import { pageTitle } from "../properties.js";
import { WRITE, type ToolDef } from "./annotations.js";
import { jsonResponse } from "./response.js";

/* SCRUM-501: a file put on a Notion page, named by a file reference.
 *
 * The bytes never pass through the conversation. The call arrives at the
 * gateway with a reference; the gateway resolves it (from Gmail or Drive, or
 * a file the caller sent) and hands the bytes to this plugin on its private
 * route, `/internal/consume`, which calls `attachNotionFile`. The same call
 * through `/mcp` carries no bytes and is refused in words.
 *
 * Notion takes a file in three steps: create a file upload, send the bytes to
 * it, then append a block that names it. Everything that can say no is asked
 * first (the page, the workspace's own size limit), so a refusal leaves
 * nothing in Notion. Nothing is retried: a write here is never sent twice. */

/** The largest file the gateway hands over: 25 MB, the cap on every file
 * reference. The private route stops reading a body at this size. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** What one upload request to Notion takes. A larger file needs Notion's
 * multi-part upload, which this tool does not do. */
export const SINGLE_PART_MAX_BYTES = 20 * 1024 * 1024;

/** Image types Notion shows as an image block. Any other type goes on the
 * page as a file block, except a PDF, which has its own block. */
const IMAGE_TYPES = new Set([
  "image/gif",
  "image/heic",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/tiff",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

export type FileBlockType = "image" | "pdf" | "file";

export function blockTypeFor(mimeType: string): FileBlockType {
  const type = mimeType.split(";")[0].trim().toLowerCase();
  if (IMAGE_TYPES.has(type)) return "image";
  if (type === "application/pdf") return "pdf";
  return "file";
}

/** A file as the gateway hands it over. */
export interface SuppliedFile {
  bytes: Uint8Array;
  name: string;
  type: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function sizeWords(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return mib >= 1 ? `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MB` : `${bytes} bytes`;
}

/** The workspace's own per-file limit, from the bot user Notion answers for
 * this connection (`bot.workspace_limits.max_file_upload_size_in_bytes`), or
 * null when Notion does not say. A free workspace allows 5 MB. */
async function workspaceLimit(client: NotionClient): Promise<number | null> {
  const me = await client.get("/v1/users/me");
  const limit = isObj(me) && isObj(me.bot) && isObj(me.bot.workspace_limits)
    ? me.bot.workspace_limits.max_file_upload_size_in_bytes
    : undefined;
  return typeof limit === "number" && limit > 0 ? limit : null;
}

/** An error from a step after the upload was created, in words that say what
 * is and is not on the page. Keeps the error's class, so the gateway's meter
 * reads it as Notion's refusal or as no answer. */
function afterCreate(err: unknown, step: "send" | "append"): Error {
  const reason = err instanceof Error ? err.message : String(err);
  if (err instanceof NotionUnreachableError) {
    // No answer at all: the step may or may not have happened.
    const words =
      step === "append"
        ? `Notion took the file, and no answer came back to adding it to the page, so it is not known whether the file is on the page. It was not retried; look at the page before calling again. ${reason}`
        : `No answer came back while sending the file to Notion. Nothing was added to the page, and it was not retried; Notion discards an upload that is not attached within an hour. ${reason}`;
    return new NotionUnreachableError(words);
  }
  const what = step === "append" ? "Notion took the file but did not add it to the page." : "Notion did not take the file's bytes.";
  const words = `${what} Nothing was attached to the page, and it was not retried; Notion discards an upload that is not attached within an hour. ${reason}`;
  if (err instanceof NotionApiError) return new NotionApiError(words, err.status, err.code);
  return new Error(words);
}

/** Upload the bytes the gateway resolved and append them to the page as an
 * image, PDF, or file block. Answers a receipt. */
export async function attachNotionFile(client: NotionClient, args: Obj, file: SuppliedFile) {
  const pageId = notionId(args.page_id, "page_id");
  const name = typeof args.filename === "string" && args.filename.trim() !== "" ? args.filename.trim() : file.name;
  const byteCount = file.bytes.byteLength;

  // The page first: one that does not exist, or is not shared with the
  // connection, is refused before anything is uploaded.
  const page = await client.get(`/v1/pages/${pageId}`);
  if (!isObj(page)) throw new Error("Notion's answer for the page was not a page. Nothing was sent.");

  if (byteCount > SINGLE_PART_MAX_BYTES) {
    throw new Error(
      `The file is ${sizeWords(byteCount)}, and this tool sends a file to Notion in one part, which Notion allows up to ${sizeWords(SINGLE_PART_MAX_BYTES)}. Nothing was sent.`
    );
  }
  const limit = await workspaceLimit(client);
  if (limit !== null && byteCount > limit) {
    throw new Error(
      `The file is ${sizeWords(byteCount)}, and this Notion workspace accepts files of at most ${sizeWords(limit)} (a free workspace allows 5 MB). Nothing was sent.`
    );
  }

  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const contentType = file.type || "application/octet-stream";
  const blockType = blockTypeFor(contentType);

  const created = await client.post("/v1/file_uploads", {
    mode: "single_part",
    filename: name,
    content_type: contentType,
  });
  const uploadId = isObj(created) && typeof created.id === "string" ? created.id : null;
  if (!uploadId) throw new Error("Notion did not name the file upload it created. Nothing was sent or attached.");

  const form = new FormData();
  form.append("file", new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: contentType }), name);
  let sent: unknown;
  try {
    sent = await client.postMultipart(`/v1/file_uploads/${uploadId}/send`, form);
  } catch (err) {
    throw afterCreate(err, "send");
  }

  let appended: unknown;
  try {
    appended = await client.patch(`/v1/blocks/${pageId}/children`, {
      children: [{ object: "block", type: blockType, [blockType]: { type: "file_upload", file_upload: { id: uploadId } } }],
    });
  } catch (err) {
    throw afterCreate(err, "append");
  }
  const block = isObj(appended) && Array.isArray(appended.results) && isObj(appended.results[0]) ? appended.results[0] : null;

  const fileRef = isObj(args.file) ? args.file : undefined;
  const receipt: Obj = {
    block: {
      id: block && typeof block.id === "string" ? block.id : null,
      type: block && typeof block.type === "string" ? block.type : blockType,
    },
    file: {
      name,
      size: isObj(sent) && typeof sent.content_length === "number" ? sent.content_length : byteCount,
      mime_type: contentType,
    },
    sent: { bytes: byteCount, sha256 },
    page: {
      // Notion's own answer, not the argument echoed back.
      id: typeof page.id === "string" ? page.id : pageId,
      title: pageTitle(page.properties),
      url: typeof page.url === "string" ? page.url : null,
    },
    source: { type: fileRef && typeof fileRef.type === "string" ? fileRef.type : null },
  };
  if (!block) receipt.block_unconfirmed = true;
  if (isObj(sent) && typeof sent.content_length === "number" && sent.content_length !== byteCount) {
    receipt.size_mismatch = true;
  }
  return jsonResponse(receipt);
}

const FILE_REFERENCE = {
  type: "object",
  description:
    'A file reference. For a whole Gmail message: {"type": "gmail_message", "message_id": "<id>"}. For one attachment of a message: {"type": "gmail_attachment", "message_id": "<id>", "part_id": "<part id>"}. For a Drive file as stored: {"type": "drive_file", "file_id": "<id>"}. For a Google Docs, Sheets or Slides file exported: {"type": "drive_export", "file_id": "<id>", "format": "pdf"}. For a file the caller already holds: {"type": "content", "name": "<file name>", "base64": "<standard base64, one unbroken string>"}, at most 1 MB decoded. For a file sent through file_upload_link: {"type": "upload", "upload_id": "<id from its receipt>"}.',
  properties: {
    type: {
      type: "string",
      enum: ["gmail_message", "gmail_attachment", "drive_file", "drive_export", "content", "upload"],
      description:
        "The kind of file reference: gmail_message for the whole email as its original .eml, gmail_attachment for one attachment of it, drive_file for a Drive file as stored, drive_export for a Google Docs, Sheets or Slides file exported to a format, content for a file carried in the call, or upload for a file sent through file_upload_link.",
    },
    message_id: {
      type: "string",
      description: "The Gmail message ID, as returned by a Gmail search or read. Required with gmail_message and gmail_attachment",
    },
    file_id: { type: "string", description: "The Google Drive file ID. Required with drive_file and drive_export" },
    format: {
      type: "string",
      description:
        "What to export to, with drive_export: pdf, docx, txt, md, html, rtf, odt or epub for a Doc; pdf, xlsx, csv (the opening tab), tsv, html or ods for a Sheet; pdf, pptx, txt or odp for Slides",
    },
    part_id: {
      type: "string",
      description:
        'The attachment\'s part id as gmail_read lists it, such as "1" or "0.1". Required with gmail_attachment, ignored otherwise.',
    },
    account: {
      type: "string",
      description:
        "Which connected Google account holds the message or file, by email address. Optional; omit it to use the default account. Not taken with content.",
    },
    name: { type: "string", description: "The file's name, with its extension. Required with content." },
    base64: {
      type: "string",
      description: "The file's bytes in standard base64 as one unbroken string, at most 1 MB decoded. Required with content.",
    },
    mime_type: {
      type: "string",
      description: "The file's type, such as image/png. Optional with content; omitted, it comes from the name's extension.",
    },
    upload_id: {
      type: "string",
      description: "The id from the receipt of a file sent through file_upload_link. Required with upload.",
    },
  },
  required: ["type"],
};

export const notionFileTools: ToolDef[] = [
  {
    name: "notion_attach_file",
    description:
      "Puts a file on a Notion page, appended at the end of the page: an image as an image block, a PDF as a PDF block, and any other file as a file block. The file is named by a file reference. A reference to a file in Gmail or Drive names where it lives: the gateway fetches it and hands it straight to Notion, so its bytes stay out of the conversation. A gmail_message reference puts a whole email on the page as its original .eml, and a gmail_attachment reference one attachment of an email, named by the part id gmail_read lists for it. A drive_file reference puts a Google Drive file as stored, and a drive_export reference a Google Docs, Sheets or Slides file exported to a format such as pdf. A content reference carries a file the caller already holds, as standard base64 in the call, at most 1 MB decoded. An upload reference names a file the user sent through file_upload_link, up to 25 MB, which goes to one call. One file a call. Notion takes a file of at most 20 MB in one part, which is what this tool sends, and a free Notion workspace accepts files of at most 5 MB; the workspace's own limit is read from Notion before anything is sent, and a larger file is refused with nothing sent. The answer is a receipt with the new block's id and type, the file's name, size and type, the SHA-256 and byte count of what was sent, and the page's id, title and URL. The upload is not sent twice; after a failure, the page shows whether the file arrived.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "The page's Notion id or URL. The file is appended at the end of this page." },
        file: FILE_REFERENCE,
        filename: {
          type: "string",
          description: "The name the file has on the page. Optional; by default the name comes from the source.",
        },
      },
      required: ["page_id", "file"],
    },
    annotations: WRITE("Put a file on a Notion page"),
  },
];

/** Through `/mcp` the call carries the reference and no bytes: the gateway
 * resolves a reference and hands the bytes to `/internal/consume`, and this
 * server cannot fetch from another connector itself. */
export async function handleNotionFile(
  _client: NotionClient,
  name: string,
  _args: Obj
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  throw new Error(
    `The file could not be supplied: ${name} needs the gateway to resolve the file reference and hand over the bytes, and this call arrived without them. Nothing was sent.`
  );
}
