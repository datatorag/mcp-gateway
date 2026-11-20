/**
 * The private route the gateway uses to hand this plugin a file (SCRUM-501).
 *
 *   POST /internal/consume
 *
 * It is NOT an MCP tool and no model ever calls it. `notion_attach_file`
 * takes a file REFERENCE (where a file lives, not its content). The gateway
 * resolves that reference by fetching the bytes from another connector, then
 * calls this route with the tool's arguments and the bytes as multipart. The
 * bytes go gateway to plugin to Notion and never pass through a conversation.
 *
 * This module knows nothing about sockets: it takes a method, headers and an
 * async iterable of chunks, and answers a status and a JSON body, so every
 * branch is testable without a server. It follows atlassian-mcp's route of
 * the same name; the plugins share no package.
 */

import { NotionClient } from "../notion-client.js";
import { errorMetaField, errorMetaFor, type ErrorMeta } from "../error-meta.js";
import {
  BadHandoff,
  isMultipart,
  MAX_ARGS_BYTES,
  parseHandoff,
  totalBytes,
  type HandedFile,
} from "./handoff.js";
import { attachNotionFile, MAX_FILE_BYTES, type SuppliedFile } from "../tools/notion-file.js";

export const CONSUME_PATH = "/internal/consume";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  _meta?: Record<string, ErrorMeta>;
};

type ConsumingTool = (
  client: NotionClient,
  args: Record<string, unknown>,
  files: Map<string, HandedFile>
) => Promise<ToolResult>;

/** A tool that takes exactly one file, in the `file` field. */
function oneFile(
  tool: (client: NotionClient, args: Record<string, unknown>, file: SuppliedFile) => Promise<ToolResult>
): ConsumingTool {
  return async (client, args, files) => {
    const file = files.get("file");
    if (!file || files.size !== 1) {
      return {
        content: [{ type: "text", text: "This tool takes one file a call. Nothing was uploaded." }],
        isError: true,
        _meta: errorMetaField({ kind: "refused" }),
      };
    }
    return tool(client, args, file);
  };
}

/** The tools this route serves. A tool is listed here only if it takes
 * bytes; everything else is reachable through /mcp alone. */
const consumingTools = new Map<string, ConsumingTool>([["notion_attach_file", oneFile(attachNotionFile)]]);

/** The whole body, at most: the file's cap, the arguments' cap, and room for
 * the multipart framing around them. The file alone is held to
 * MAX_FILE_BYTES once the body is parsed. */
const MAX_BODY_BYTES = MAX_FILE_BYTES + MAX_ARGS_BYTES + 64 * 1024;

export interface ConsumeRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
}

export interface ConsumeResponse {
  status: number;
  body:
    | { error: string; code: string }
    | { content: Array<{ type: "text"; text: string }>; isError: boolean; _meta?: Record<string, ErrorMeta> };
}

function refuse(status: number, code: string, error: string): ConsumeResponse {
  return { status, body: { error, code } };
}

class BodyTooLarge extends Error {}

/** Read the body, giving up the moment it passes the cap. The cap is
 * enforced on bytes actually received, not on Content-Length. */
async function readCapped(body: AsyncIterable<Uint8Array>, cap: number): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > cap) throw new BodyTooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

/** The page id for the log line, only once it has the shape of a Notion id,
 * so the line cannot be made to say anything else. */
function loggablePage(value: unknown): string {
  return typeof value === "string" && /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(value)
    ? value
    : "other";
}

export async function handleConsume(req: ConsumeRequest): Promise<ConsumeResponse> {
  if (req.method !== "POST") {
    return refuse(405, "method_not_allowed", "Use POST.");
  }

  const header = (name: string): string | undefined => {
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase() === name && typeof value === "string" && value) {
        return value;
      }
    }
    return undefined;
  };

  const token = header("x-user-token");
  if (!token) {
    return refuse(401, "no_token", "Missing X-User-Token.");
  }

  const toolName = header("x-tool-name");
  if (!toolName) {
    return refuse(400, "bad_request", "Missing X-Tool-Name.");
  }
  const tool = consumingTools.get(toolName);
  if (!tool) {
    return refuse(404, "unknown_tool", "This route does not serve that tool.");
  }

  const contentType = header("content-type");
  if (!isMultipart(contentType)) {
    return refuse(400, "bad_request", "The body must be multipart/form-data.");
  }

  // Content-Length is only a shortcut for an honest caller. The read below
  // enforces the cap whatever this header says.
  const declared = Number(header("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return refuse(413, "too_large", tooLargeMessage());
  }

  let body: Buffer;
  try {
    body = await readCapped(req.body, MAX_BODY_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLarge) {
      return refuse(413, "too_large", tooLargeMessage());
    }
    return refuse(400, "bad_request", "The body could not be read.");
  }
  if (body.byteLength === 0) {
    return refuse(400, "bad_request", "The body is empty.");
  }

  let args: Record<string, unknown>;
  let files: Map<string, HandedFile>;
  try {
    ({ args, files } = await parseHandoff(body, contentType as string));
  } catch (err) {
    return refuse(400, "bad_request", err instanceof BadHandoff ? err.message : "The body could not be read.");
  }
  const bytes = totalBytes(files);
  if (bytes > MAX_FILE_BYTES) {
    return refuse(413, "too_large", tooLargeMessage());
  }

  let result: ToolResult;
  try {
    // A write: the client never sends a request twice.
    result = await tool(new NotionClient({ accessToken: token, readOnlyTool: false }), args, files);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
      _meta: errorMetaField(errorMetaFor(err)),
    };
  }

  const isError = result.isError === true;
  // One line, and nothing in it that came from the file or the page: no
  // filename, no title.
  console.error(`[consume] ${toolName} outcome=${isError ? "error" : "ok"} bytes=${bytes} page=${loggablePage(args.page_id)}`);
  return {
    status: 200,
    body: { content: result.content, isError, ...(result._meta ? { _meta: result._meta } : {}) },
  };
}

function tooLargeMessage(): string {
  return `The file is larger than ${MAX_FILE_BYTES} bytes.`;
}
