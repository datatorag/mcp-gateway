import { errorMessage, type GwsClient } from "../gws-client.js";
import { CREATE, MUTATE, READ, ToolDef } from "./annotations.js";
import { jsonResponse } from "./response.js";
import { requireNonBlank } from "./validate.js";
import { copyDriveFile, deleteDriveFile } from "./drive-ops.js";
import { readDocText } from "./docs.js";
import { readSheetValues } from "./sheets.js";
import { getPresentationOutline } from "./slides.js";

export const driveTools: ToolDef[] = [
  {
    name: "drive_create_folder",
    description: "Create a new folder in Google Drive.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name for the new folder",
        },
        parent_id: {
          type: "string",
          description: "Parent folder ID to create inside (optional, defaults to root)",
        },
      },
      required: ["name"],
    },
    annotations: CREATE("Create Drive folder"),
  },
  {
    name: "drive_search",
    description:
      "Search for files in Google Drive. Returns file names, IDs, types, and modification dates.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query (Drive query syntax, e.g., \"name contains 'report'\" or \"mimeType='application/vnd.google-apps.spreadsheet'\")",
        },
        page_size: {
          type: "number",
          description: "Maximum number of results to return (default: 20)",
        },
      },
      required: ["query"],
    },
    annotations: READ("Search Drive files"),
  },
  {
    name: "drive_read_file",
    description:
      "Read the text content of any file in Google Drive by file ID. Supports Google Docs, Sheets, Slides, Office formats (.docx/.xlsx/.pptx — auto-converted), and plain text files. Returns extracted text directly — no local filesystem needed.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: {
          type: "string",
          description: "The Google Drive file ID to read",
        },
      },
      required: ["file_id"],
    },
    annotations: READ("Read Drive file"),
  },
  {
    name: "drive_rename_file",
    description:
      "Rename a file or folder in Google Drive. Changes the name only: content, location, and sharing are untouched. Works on any Drive item the account can edit, including Docs, Sheets, Slides, and folders.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: {
          type: "string",
          description: "The Google Drive file or folder ID to rename",
        },
        name: {
          type: "string",
          minLength: 1,
          description: "The new name",
        },
      },
      required: ["file_id", "name"],
    },
    annotations: MUTATE("Rename Drive file"),
  },
  {
    name: "drive_copy_file",
    description:
      "Copy a file in Google Drive, naming the copy in the same call. Use this to instantiate a template instead of rebuilding it: the copy carries the original's tabs, formatting, and formulas, so it cannot drift from the template the way a hand-rebuild does. Folders cannot be copied: Drive rejects that with a 403 \"This file cannot be copied by the user\", which is a limitation of the API and not a permissions problem to retry.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: {
          type: "string",
          description: "The Google Drive file ID to copy",
        },
        name: {
          type: "string",
          minLength: 1,
          description: "Name for the new copy",
        },
        parent_id: {
          type: "string",
          description:
            "Folder ID to place the copy in (optional, defaults to the original's folder)",
        },
      },
      required: ["file_id", "name"],
    },
    annotations: CREATE("Copy Drive file"),
  },
  {
    name: "drive_get_file",
    description:
      "Describes one file or folder in Google Drive without reading its content. Takes the file ID. Returns its name, MIME type, size in bytes when Drive reports one (folders have none), the IDs of the folders it is in, its owners' names and addresses, when it was created and last modified, its link, whether it is in Trash, whether it is shared, and the shared drive it belongs to when it is in one. A file the account cannot see answers as not found.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: {
          type: "string",
          description: "The Google Drive file or folder ID to describe",
        },
      },
      required: ["file_id"],
    },
    annotations: READ("Get Drive file details"),
  },
  {
    name: "drive_move_file",
    description:
      "Moves a file or folder in Google Drive into another folder. Takes the file ID and the destination folder ID. The item is added to the destination folder and removed from the folder or folders it was in, so it ends up in one place; its name, content and ID are unchanged. Returns the item's ID, name, the folder it is now in and its link. An item already in the destination folder is left where it is and reported as not moved.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: {
          type: "string",
          description: "The Google Drive file or folder ID to move",
        },
        folder_id: {
          type: "string",
          description: "The ID of the folder to move it into",
        },
      },
      required: ["file_id", "folder_id"],
    },
    annotations: MUTATE("Move Drive file to another folder"),
  },
  {
    name: "drive_trash_file",
    description:
      "Moves a file or folder in Google Drive to Trash. Takes the file ID. The item stays in Trash, where Drive deletes it for good after 30 days and where its owner can restore it before then; trashing a folder trashes what is inside it. Returns the item's ID, name and its trashed state as Drive reports it afterwards. Works on any Drive item the account is allowed to trash, including Docs, Sheets and Slides.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: {
          type: "string",
          description: "The Google Drive file or folder ID to move to Trash",
        },
      },
      required: ["file_id"],
    },
    annotations: MUTATE("Move Drive file to Trash"),
  },
  {
    name: "drive_share_file",
    description:
      "Shares a Google Drive file or folder with one person by email address, as reader, commenter or writer. Takes the file ID, the address and the role, and optionally a message for the notification email. Google emails the person unless notify is false. Returns the file ID and its permission list afterwards: who has access, at what role. Sharing a file with someone already on it at another role adds no second entry; Drive keeps one per person. This gives the person access to the file and, for a folder, to what is inside it.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: {
          type: "string",
          description: "The Google Drive file or folder ID to share.",
        },
        email: {
          type: "string",
          description: "The email address of the person to share with.",
        },
        role: {
          type: "string",
          enum: ["reader", "commenter", "writer"],
          description: "The access to give: reader (view), commenter (view and comment) or writer (edit).",
        },
        message: {
          type: "string",
          description: "An optional message, sent in the notification email.",
        },
        notify: {
          type: "boolean",
          description: "Whether Google emails the person about the share (default: true).",
        },
      },
      required: ["file_id", "email", "role"],
    },
    // Gives a person access to a file: an effect outside the account that
    // cannot be taken back from their inbox.
    annotations: MUTATE("Share Drive file with a person"),
  },
  {
    name: "drive_get_file_permissions",
    description:
      "Lists who has access to a Google Drive file or folder and at what role. Takes the file ID. Returns one entry per permission: its ID, its type (user, group, domain or anyone), the role (owner, organizer, fileOrganizer, writer, commenter or reader), and the person's name and address or the domain where there is one. A file the account cannot see answers as not found.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: {
          type: "string",
          description: "The Google Drive file or folder ID.",
        },
      },
      required: ["file_id"],
    },
    annotations: READ("List who has access to a Drive file"),
  },
  {
    name: "drive_list_recent_files",
    description:
      "Lists the Google Drive files the account opened most recently, or the ones modified most recently, the most recent at the top. Returns one compact entry per file: its ID, name, MIME type, when it was last modified, when the account last opened it, and its link, plus a page token when more remain. Files in Trash are left out.",
    inputSchema: {
      type: "object",
      properties: {
        by: {
          type: "string",
          enum: ["opened", "modified"],
          description: "Order by when the account last opened each file, or by when each file was last modified by anyone (default: opened).",
        },
        page_size: {
          type: "number",
          description: "The most files to return in one page (default: 20, at most 100).",
        },
        page_token: {
          type: "string",
          description: "The nextPageToken from an earlier call, to read the page after it.",
        },
      },
      required: [],
    },
    annotations: READ("List recent Drive files"),
  },
];

/** What drive_share_file and drive_get_file_permissions report for each
 * permission: who, at what role. */
const PERMISSION_FIELDS = "permissions(id,type,role,emailAddress,displayName,domain),nextPageToken";

/** An address shaped enough to send to Drive; Drive is the judge of the rest. */
const EMAIL = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;

async function listPermissions(client: GwsClient, fileId: string) {
  const result = await client.api("drive", "permissions", "list", {
    params: { fileId, fields: PERMISSION_FIELDS, supportsAllDrives: true },
  });
  const data = (result.data ?? {}) as {
    permissions?: { id?: string; type?: string; role?: string; emailAddress?: string; displayName?: string; domain?: string }[];
  };
  return (Array.isArray(data.permissions) ? data.permissions : []).map((p) => ({
    id: p.id,
    type: p.type,
    role: p.role,
    ...(p.emailAddress ? { email: p.emailAddress } : {}),
    ...(p.displayName ? { name: p.displayName } : {}),
    ...(p.domain ? { domain: p.domain } : {}),
  }));
}

/** What drive_get_file reads: the facts about a file, never its content. */
export const FILE_DETAIL_FIELDS =
  "id,name,mimeType,size,parents,owners(displayName,emailAddress)," +
  "createdTime,modifiedTime,webViewLink,trashed,shared,driveId";

const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";
const OFFICE_PREFIX = "application/vnd.openxmlformats-officedocument";

export async function handleDrive(
  client: GwsClient,
  toolName: string,
  args: Record<string, unknown>
) {
  switch (toolName) {
    case "drive_create_folder": {
      const body: Record<string, unknown> = {
        name: args.name as string,
        mimeType: "application/vnd.google-apps.folder",
      };
      if (args.parent_id) {
        body.parents = [args.parent_id as string];
      }
      const result = await client.api("drive", "files", "create", {
        params: { supportsAllDrives: true, fields: "id,name,webViewLink" },
        jsonBody: body,
      });
      return jsonResponse(result.data);
    }

    case "drive_search": {
      const result = await client.api("drive", "files", "list", {
        params: {
          q: args.query as string,
          pageSize: (args.page_size as number) || 20,
          fields: "files(id,name,mimeType,modifiedTime,size,webViewLink)",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        },
      });
      return jsonResponse(result.data);
    }

    case "drive_read_file": {
      const fileId = args.file_id as string;

      // Step 1: Get file metadata
      const meta = await client.api("drive", "files", "get", {
        params: { fileId, fields: "name,mimeType", supportsAllDrives: true },
      });
      const { name, mimeType } = meta.data as { name: string; mimeType: string };

      // Step 2: Route by mimeType
      const content = await readFileContent(client, fileId, name, mimeType);
      return jsonResponse({ fileId, name, mimeType, content });
    }

    case "drive_rename_file": {
      const result = await client.api("drive", "files", "update", {
        params: {
          fileId: args.file_id as string,
          supportsAllDrives: true,
          fields: "id,name,webViewLink",
        },
        // files.update is a PATCH: whatever is in this body gets written, so
        // it carries the one field the caller asked to change and no other.
        jsonBody: { name: requireNonBlank(toolName, "name", args.name as string) },
      });
      return jsonResponse(result.data);
    }

    case "drive_copy_file": {
      const body: Record<string, unknown> = {
        name: requireNonBlank(toolName, "name", args.name as string),
      };
      if (args.parent_id) {
        body.parents = [args.parent_id as string];
      }
      // `parents` is in the field list because where the copy landed is the
      // one thing the caller cannot see without a second call.
      const result = await copyDriveFile(
        client,
        args.file_id as string,
        body,
        "id,name,parents,webViewLink"
      );
      return jsonResponse(result.data);
    }

    case "drive_get_file": {
      const result = await client.api("drive", "files", "get", {
        params: { fileId: args.file_id as string, fields: FILE_DETAIL_FIELDS, supportsAllDrives: true },
      });
      return jsonResponse(result.data);
    }

    case "drive_move_file": {
      const fileId = args.file_id as string;
      const folderId = requireNonBlank(toolName, "folder_id", args.folder_id as string);
      // A move in Drive is "add this parent, remove those", so the folders
      // the item is in now have to be read first. Leaving them in place
      // would add a second location rather than move anything.
      const current = await client.api("drive", "files", "get", {
        params: { fileId, fields: "id,name,parents,webViewLink", supportsAllDrives: true },
      });
      const before = (current.data ?? {}) as { id?: string; name?: string; parents?: string[]; webViewLink?: string };
      const parents = Array.isArray(before.parents) ? before.parents : [];
      if (parents.length === 1 && parents[0] === folderId) {
        return jsonResponse({ ...before, moved: false, note: "The item is already in that folder." });
      }
      const from = parents.filter((p) => p !== folderId);
      const result = await client.api("drive", "files", "update", {
        params: {
          fileId,
          addParents: folderId,
          ...(from.length > 0 ? { removeParents: from.join(",") } : {}),
          supportsAllDrives: true,
          fields: "id,name,parents,webViewLink",
        },
        // files.update is a PATCH and whatever is in the body gets written.
        // A move changes no field of the file, so the body is empty.
        jsonBody: {},
      });
      return jsonResponse({ ...(result.data as Record<string, unknown>), moved: true });
    }

    case "drive_trash_file": {
      const result = await client.api("drive", "files", "update", {
        params: { fileId: args.file_id as string, supportsAllDrives: true, fields: "id,name,trashed" },
        // The one field this call is for, and no other.
        jsonBody: { trashed: true },
      });
      return jsonResponse(result.data);
    }

    case "drive_share_file": {
      const fileId = requireNonBlank(toolName, "file_id", args.file_id as string);
      const email = String(args.email ?? "").trim();
      if (!EMAIL.test(email)) throw new Error("drive_share_file: email must be one email address.");
      const role = args.role as string;
      if (!["reader", "commenter", "writer"].includes(role)) {
        throw new Error("drive_share_file: role must be reader, commenter or writer.");
      }
      const notify = args.notify !== false;
      await client.api("drive", "permissions", "create", {
        params: {
          fileId,
          supportsAllDrives: true,
          sendNotificationEmail: notify,
          ...(notify && typeof args.message === "string" && args.message !== "" ? { emailMessage: args.message } : {}),
          fields: "id",
        },
        jsonBody: { type: "user", role, emailAddress: email },
      });
      return jsonResponse({ file_id: fileId, shared_with: email, role, notified: notify, permissions: await listPermissions(client, fileId) });
    }

    case "drive_get_file_permissions": {
      const fileId = requireNonBlank(toolName, "file_id", args.file_id as string);
      return jsonResponse({ file_id: fileId, permissions: await listPermissions(client, fileId) });
    }

    case "drive_list_recent_files": {
      const byModified = args.by === "modified";
      const params: Record<string, unknown> = {
        q: "trashed = false",
        orderBy: byModified ? "modifiedTime desc" : "viewedByMeTime desc",
        pageSize: Math.min(Math.max(1, Math.floor(Number(args.page_size) || 20)), 100),
        fields: "files(id,name,mimeType,modifiedTime,viewedByMeTime,webViewLink),nextPageToken",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      };
      if (args.page_token) params.pageToken = args.page_token;
      const result = await client.api("drive", "files", "list", { params });
      const data = (result.data ?? {}) as {
        files?: { id?: string; name?: string; mimeType?: string; modifiedTime?: string; viewedByMeTime?: string; webViewLink?: string }[];
        nextPageToken?: string;
      };
      const files = (Array.isArray(data.files) ? data.files : []).map((f) => ({
        id: f.id,
        name: f.name,
        mime_type: f.mimeType,
        modified: f.modifiedTime,
        ...(f.viewedByMeTime ? { opened_by_me: f.viewedByMeTime } : {}),
        link: f.webViewLink,
      }));
      return jsonResponse({ count: files.length, files, ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}) });
    }

    default:
      throw new Error(`Unknown Drive tool: ${toolName}`);
  }
}

async function readFileContent(
  client: GwsClient,
  fileId: string,
  name: string,
  mimeType: string
): Promise<unknown> {
  // Native Google formats: the same extraction the dedicated tools use,
  // called at the data level rather than through their MCP response
  // envelopes.
  if (mimeType === GOOGLE_DOC) {
    return readDocText(client, fileId);
  }
  if (mimeType === GOOGLE_SHEET) {
    return (await readSheetValues(client, fileId, "A1:Z1000")).values;
  }
  if (mimeType === GOOGLE_SLIDES) {
    return (await getPresentationOutline(client, fileId)).slides;
  }

  // Office formats → copy-convert to native, read, delete copy
  if (mimeType.startsWith(OFFICE_PREFIX)) {
    const target = mimeType.includes("wordprocessing")
      ? GOOGLE_DOC
      : mimeType.includes("spreadsheet")
        ? GOOGLE_SHEET
        : GOOGLE_SLIDES;
    let copy: { id: string; mimeType: string } | undefined;
    try {
      const copyResult = await copyDriveFile(client, fileId, {
        name: `${name} [MCP temp]`,
        mimeType: target,
      });
      copy = copyResult.data as { id: string; mimeType: string };
      return await readFileContent(client, copy.id, name, copy.mimeType);
    } catch (err: unknown) {
      return { error: `Failed to read Office file: ${errorMessage(err)}` };
    } finally {
      if (copy?.id) {
        // Fire-and-forget: the caller never sees the temp copy, so its
        // cleanup should not hold the response for another round-trip.
        // Errors were already swallowed when this was awaited.
        void deleteDriveFile(client, copy.id).catch(() => {});
      }
    }
  }

  // Plain text / CSV (explicit types only)
  if (mimeType === "text/plain" || mimeType === "text/csv") {
    const result = await client.api("drive", "files", "get", {
      params: { fileId, alt: "media", supportsAllDrives: true },
    });
    return result.data;
  }

  // Everything else is unsupported
  return { error: `Unsupported file type: ${mimeType}` };
}
