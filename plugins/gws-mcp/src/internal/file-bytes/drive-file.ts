import type { GwsClient } from "../../gws-client.js";
import { EXPORTS, EXPORT_FORMATS } from "../../attachments/resolve.js";
import { MAX_MIME_TYPE, MIME_TYPE } from "./gmail-attachment.js";
import {
  fitName,
  found,
  googleError,
  readStreamCapped,
  refuse,
  sanitiseNamePart,
  tooLarge,
  type FileBytesResponse,
  type Resolver,
} from "./shared.js";

/** `{ type: "drive_file", file_id }` and `{ type: "drive_export", file_id,
 * format }`: a Drive file as stored, and a Google Doc, Sheet or Slides deck
 * rendered to a format (SCRUM-428).
 *
 * TWO TYPES, NOT ONE WITH AN OPTIONAL FORMAT. The gateway hands a resolver
 * only a type's required fields, and the download link's signature covers
 * only those, so an optional format would be dropped on the way here. A
 * native file asked for as a drive_file is refused with the drive_export
 * reference to use instead, rather than exported to a format nobody chose.
 *
 * Every refusal comes from the file's metadata, before a byte is read. */

/** A Drive id as it goes into a URL path: letters, digits, _ and -. */
export const DRIVE_ID = /^[A-Za-z0-9_-]+$/;

const NATIVE = "application/vnd.google-apps.";
const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";

const META_FIELDS = "id,name,mimeType,size,trashed,shortcutDetails(targetId)";

interface DriveMeta {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  trashed?: boolean;
  shortcutDetails?: { targetId?: string };
}

/** A failed Drive call as an answer. Every Drive reference hangs off a file
 * id, so a 404 is the file that is missing whichever read met it. Google
 * refuses an export over its own limit with a 403; that is a size, and says
 * so, rather than a permissions problem. */
export function driveFailure(what: string, err: unknown): FileBytesResponse {
  const { status, message } = googleError(err);
  if (status === 404) return refuse(404, "not_found", "Drive has no file with that id in this account.");
  if (/too large to be exported|export size limit|exportSizeLimitExceeded/i.test(message)) {
    return refuse(413, "too_large", "Google cannot export this file: it is over Google's limit for an export. A smaller file, or another format, may fit.");
  }
  return refuse(502, "upstream", `Drive could not return the ${what}: ${message}`);
}

/** The Drive name, cleaned the way an attachment's is, with the extension
 * kept whole. `ext` is added when the name does not already end in it. */
export function driveFileName(name: string | undefined, fileId: string, ext = ""): string {
  const clean = sanitiseNamePart((name ?? "").slice(0, 1000));
  const base = !clean || /^\.+$/.test(clean) ? `drive-file-${fileId}` : clean;
  if (ext && base.toLowerCase().endsWith(ext)) return fitName(base.slice(0, base.length - ext.length), ext);
  if (ext) return fitName(base, ext);
  const dot = base.lastIndexOf(".");
  const ending = dot > 0 ? base.slice(dot) : "";
  const keep = ending.length > 1 && ending.length <= 16 && !ending.includes(" ") ? ending : "";
  return fitName(base.slice(0, base.length - keep.length), keep);
}

async function metadata(client: GwsClient, fileId: string): Promise<DriveMeta> {
  const result = await client.api("drive", "files", "get", {
    params: { fileId, fields: META_FIELDS, supportsAllDrives: true },
  });
  return (result.data ?? {}) as DriveMeta;
}

/** What every Drive reference refuses, from the metadata alone: a folder,
 * a shortcut, a file in Trash. Undefined when none applies. */
function notAFile(meta: DriveMeta): FileBytesResponse | undefined {
  if (meta.mimeType === FOLDER) {
    return refuse(400, "bad_request", "That id is a folder, and a folder has no content of its own to move. Name a file inside it.");
  }
  if (meta.mimeType === SHORTCUT) {
    const target = meta.shortcutDetails?.targetId;
    return refuse(400, "bad_request", `That id is a shortcut. Name the file it points to${target ? `, ${target},` : ""} instead.`);
  }
  if (meta.trashed === true) {
    return refuse(400, "bad_request", "That file is in Trash. Restore it first, or name another file.");
  }
  return undefined;
}

async function readBytes(
  open: () => Promise<{ stream: ReadableStream<Uint8Array> }>,
  what: string,
  maxBytes: number
): Promise<{ body: Buffer } | FileBytesResponse> {
  let read: Awaited<ReturnType<typeof readStreamCapped>>;
  try {
    const res = await open();
    read = await readStreamCapped(res.stream as unknown as AsyncIterable<Uint8Array>, maxBytes);
  } catch (err) {
    return driveFailure(what, err);
  }
  if ("over" in read) return tooLarge(what, read.over, maxBytes);
  return read;
}

const validId = (ref: Record<string, unknown>) =>
  typeof ref.file_id === "string" && DRIVE_ID.test(ref.file_id)
    ? undefined
    : "ref.file_id must be a non-empty string of letters, digits, _ and -.";

export const driveFile: Resolver = {
  validate: validId,

  async resolve(ref, maxBytes, client) {
    const fileId = ref.file_id as string;
    let meta: DriveMeta;
    try {
      meta = await metadata(client, fileId);
    } catch (err) {
      return driveFailure("file", err);
    }
    const refused = notAFile(meta);
    if (refused) return refused;
    const mimeType = meta.mimeType ?? "";
    if (mimeType.startsWith(NATIVE)) {
      const kind = EXPORTS[mimeType];
      return refuse(
        400,
        "bad_request",
        kind
          ? `That is a Google ${kind.label} file, which has no stored content to send as it is. Ask for it as {"type":"drive_export","file_id":"${fileId}","format":"pdf"}, or another of: ${Object.keys(kind.formats).join(", ")}.`
          : "That is a Google file of a kind that has no stored content and cannot be exported."
      );
    }
    // SIZE BEFORE BYTES. Drive reports a stored file's size, so one over the
    // cap is refused without being fetched; the capped read is the backstop.
    const declared = Number(meta.size);
    if (Number.isFinite(declared) && declared > maxBytes) return tooLarge("file", declared, maxBytes);

    const read = await readBytes(() => client.download("drive", "files", "get", { fileId, supportsAllDrives: true }), "file", maxBytes);
    if ("status" in read) return read;
    const typed = mimeType.length <= MAX_MIME_TYPE && MIME_TYPE.test(mimeType);
    return found(read.body, typed ? mimeType : "application/octet-stream", driveFileName(meta.name, fileId));
  },
};

export const driveExport: Resolver = {
  validate(ref) {
    const invalid = validId(ref);
    if (invalid) return invalid;
    if (typeof ref.format !== "string" || !EXPORT_FORMATS.includes(ref.format)) {
      return `ref.format must be one of ${EXPORT_FORMATS.join(", ")}.`;
    }
    return undefined;
  },

  async resolve(ref, maxBytes, client) {
    const fileId = ref.file_id as string;
    const formatName = ref.format as string;
    let meta: DriveMeta;
    try {
      meta = await metadata(client, fileId);
    } catch (err) {
      return driveFailure("export", err);
    }
    const refused = notAFile(meta);
    if (refused) return refused;
    const mimeType = meta.mimeType ?? "";
    const kind = EXPORTS[mimeType];
    if (!kind) {
      return refuse(
        400,
        "bad_request",
        mimeType.startsWith(NATIVE)
          ? "That Google file is of a kind that cannot be exported."
          : `That is a stored file, not a Google Docs, Sheets or Slides file, so there is nothing to export. Ask for it as {"type":"drive_file","file_id":"${fileId}"}.`
      );
    }
    const format = kind.formats[formatName];
    if (!format) {
      return refuse(400, "bad_request", `A Google ${kind.label} file exports as ${Object.keys(kind.formats).join(", ")}, not ${formatName}.`);
    }
    // A Sheet's csv and tsv come from files.export too, which renders the
    // first tab only; the reference has no tab to name.
    const exportAs = typeof format.exportAs === "string" ? format.exportAs : format.mimeType;
    const read = await readBytes(
      () => client.download("drive", "files", "export", { fileId, mimeType: exportAs }),
      "export",
      maxBytes
    );
    if ("status" in read) return read;
    if (read.body.length === 0) return refuse(502, "upstream", "Drive could not return the export: it came back empty.");
    return found(read.body, format.mimeType, driveFileName(meta.name, fileId, format.ext));
  },
};
