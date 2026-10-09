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
];

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
