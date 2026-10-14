import { createHash } from "node:crypto";
import type { GwsClient } from "../gws-client.js";
import { CREATE, type ToolDef } from "./annotations.js";

/** The largest file the route takes: 25 MB, the gateway's crossing cap. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** A file as the gateway hands it over: the bytes, and what to call them. */
export interface SuppliedFile {
  bytes: Uint8Array;
  name: string;
  type: string;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const STORED_FIELDS = "id,name,mimeType,size,webViewLink,parents,md5Checksum,sha256Checksum";
const FOLDER_FIELDS = "id,name,mimeType,owners(emailAddress,me),shared,driveId,capabilities(canAddChildren)";
const FOLDER_TYPE = "application/vnd.google-apps.folder";

export const driveUploadTools: ToolDef[] = [
  {
    name: "drive_upload_file",
    description:
      "Puts a file named by a file reference into Google Drive, under the file's own name. The file is not sent as content: the gateway fetches it from where it lives and hands it to Drive, so its bytes never pass through the conversation. A gmail_message reference stores a whole email as its original .eml exactly as Gmail returns it; a gmail_attachment reference stores one attachment of an email, named by the part id gmail_read lists for it. It goes into folder_id when given, otherwise the root of My Drive, in the Drive of the account the call runs as, which can be a different connected account from the one holding the email. The answer is a receipt: the new file's id, name, size, type, link and parents; the SHA-256 and byte count of what was sent; the SHA-256 and MD5 Drive reports for what it stored, and whether the two SHA-256 values match; and the folder it went into, with its owners, whether it is shared, and whether it is in a shared drive, next to the address of the account that received the file. The folder comes from the user, never from the content of a file. One file a call, at most 25 MB. The upload is not retried, and a second call makes a second file of the same name.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "object",
          description:
            'A file reference: {"type":"gmail_message","message_id":"..."} for an email, or {"type":"gmail_attachment","message_id":"...","part_id":"..."} for one attachment. An optional "account" names the connected Google account that holds the message.',
        },
        folder_id: {
          type: "string",
          description: "The Drive folder to put the file in. Omitted: the root of My Drive.",
        },
      },
      required: ["file"],
    },
    annotations: CREATE("Upload a file to Drive"),
  },
];

/** An ordinary call reaches the plugin with arguments and no bytes: the file
 * reference is resolved by the gateway, which then calls the private
 * consume route. Without the gateway there is nothing to upload. */
export async function handleDriveUpload(): Promise<ToolResult> {
  return {
    content: [
      {
        type: "text",
        text: "The file could not be supplied: drive_upload_file needs the gateway to resolve the file reference and hand over the bytes, and this call arrived without them. Nothing was uploaded.",
      },
    ],
    isError: true,
  };
}

/** A Google error's HTTP status, when the transport put one in its message. */
function statusOf(err: unknown): number | undefined {
  const text = err instanceof Error ? err.message : String(err);
  const m = /"code":\s*(\d{3})/.exec(text);
  return m ? Number(m[1]) : undefined;
}

const refuse = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

/**
 * Upload bytes the gateway resolved from a file reference, and answer with a
 * receipt.
 *
 * Everything that can say no is asked BEFORE the upload, which is the one
 * step that cannot be taken back or safely repeated: the folder is read
 * (it exists, it is a folder, this account can add to it) and so is the
 * receiving account's address. Then the file is sent, once.
 *
 * A folder owned by someone else is reported, never refused: it is a normal
 * place to file something, and the receipt is where the user sees whose it
 * is. Nothing is written to disk and nothing about the file is logged.
 */
export async function uploadReferencedFile(
  client: GwsClient,
  args: Record<string, unknown>,
  file: SuppliedFile
): Promise<ToolResult> {
  const folderArg = args.folder_id;
  if (folderArg !== undefined && (typeof folderArg !== "string" || !/^[A-Za-z0-9_-]+$/.test(folderArg))) {
    return refuse("folder_id is not a Drive folder id. Nothing was uploaded.");
  }
  const folderId = (folderArg as string | undefined) ?? "root";

  let folder: Record<string, any>;
  let accountEmail: string | null;
  try {
    // Independent reads, issued together.
    const [folderRes, aboutRes] = await Promise.all([
      client.api("drive", "files", "get", {
        params: { fileId: folderId, fields: FOLDER_FIELDS, supportsAllDrives: true },
      }),
      client.api("drive", "about", "get", { params: { fields: "user(emailAddress)" } }),
    ]);
    folder = (folderRes.data ?? {}) as Record<string, any>;
    accountEmail = ((aboutRes.data ?? {}) as { user?: { emailAddress?: string } }).user?.emailAddress ?? null;
  } catch (err) {
    if (statusOf(err) === 404) {
      return refuse("Drive has no folder with that id that this account can see. Nothing was uploaded.");
    }
    throw err;
  }
  if (folder.mimeType !== FOLDER_TYPE) {
    return refuse("folder_id names a file, not a folder. Nothing was uploaded.");
  }
  if (folder.capabilities?.canAddChildren === false) {
    return refuse("This account cannot add files to that folder. Nothing was uploaded.");
  }

  const bytes = Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
  const sentSha256 = createHash("sha256").update(bytes).digest("hex");

  const uploaded = await client.upload("drive", "files", "create", {
    params: { supportsAllDrives: true, fields: STORED_FIELDS },
    metadata: { name: file.name, ...(folderArg ? { parents: [folderId] } : {}) },
    contentType: file.type,
    source: (async function* () {
      yield bytes;
    })(),
  });
  let stored = (uploaded.data ?? {}) as Record<string, any>;

  // The checksums are asked for on the create. If an answer ever comes back
  // without them, one read of the new file asks again rather than leaving
  // the comparison empty.
  if (typeof stored.sha256Checksum !== "string" && typeof stored.id === "string") {
    const again = await client.api("drive", "files", "get", {
      params: { fileId: stored.id, fields: STORED_FIELDS, supportsAllDrives: true },
    });
    stored = { ...stored, ...((again.data ?? {}) as Record<string, any>) };
  }

  const storedSha256 = typeof stored.sha256Checksum === "string" ? stored.sha256Checksum : null;
  const checksumMatch = storedSha256 === null ? null : storedSha256 === sentSha256;
  const sizeMatch = Number(stored.size) === bytes.byteLength;
  const owners = Array.isArray(folder.owners) ? folder.owners : [];

  const receipt = {
    file: {
      id: stored.id ?? null,
      name: stored.name ?? null,
      size: stored.size === undefined ? null : Number(stored.size),
      mimeType: stored.mimeType ?? null,
      webViewLink: stored.webViewLink ?? null,
      parents: stored.parents ?? null,
    },
    sent: { bytes: bytes.byteLength, sha256: sentSha256 },
    stored: { sha256: storedSha256, md5: typeof stored.md5Checksum === "string" ? stored.md5Checksum : null },
    checksum_match: checksumMatch,
    ...(checksumMatch === null ? { size_match: sizeMatch } : {}),
    folder: {
      id: folder.id ?? folderId,
      name: folder.name ?? null,
      owners: owners.map((o: { emailAddress?: string }) => o.emailAddress ?? null),
      owned_by_receiving_account: owners.some((o: { me?: boolean }) => o.me === true),
      shared: folder.shared === true,
      in_shared_drive: typeof folder.driveId === "string",
    },
    account: accountEmail,
  };

  const text = JSON.stringify(receipt, null, 2);
  if (checksumMatch === false || (checksumMatch === null && !sizeMatch)) {
    return {
      content: [
        {
          type: "text",
          text: `The file is in Drive, but what Drive stored does not match what was sent. It was not deleted.\n${text}`,
        },
      ],
      isError: true,
    };
  }
  return { content: [{ type: "text", text }] };
}
