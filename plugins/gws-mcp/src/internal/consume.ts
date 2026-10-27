/**
 * The private route the gateway uses to hand this plugin a file.
 *
 *   POST /internal/consume
 *
 * It is NOT an MCP tool and no model ever calls it. A tool such as
 * drive_upload_file takes a file REFERENCE (where a file lives, not its
 * content). The gateway resolves that reference by fetching the bytes from
 * another connector, then calls this route with the bytes as the request
 * body and the tool's arguments in a header. The bytes go gateway to plugin
 * to Drive and never pass through a conversation.
 *
 * This module knows nothing about sockets: it takes a method, headers and an
 * async iterable of chunks, and answers a status and a JSON body, so every
 * branch is testable without a server.
 */

import { GwsClient } from "../gws-client.js";
import { errorMetaField, errorMetaFor, type ErrorMeta } from "../error-meta.js";
import { handleGmail } from "../tools/gmail.js";
import {
  BadHandoff,
  isMultipart,
  MAX_ARGS_BYTES,
  parseHandoff,
  totalBytes,
  type HandedFile,
} from "./handoff.js";
import {
  MAX_UPLOAD_BYTES as MAX_ATTACHMENT_BYTES,
  uploadReferencedFile,
  type SuppliedFile,
} from "../tools/drive-upload.js";

export const CONSUME_PATH = "/internal/consume";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  _meta?: Record<string, ErrorMeta>;
};

type ConsumingTool = (
  client: GwsClient,
  args: Record<string, unknown>,
  files: Map<string, HandedFile>
) => Promise<ToolResult>;

const ATTACHMENT_FIELD = /^attachments\[(\d)\]$/;

/** The five Gmail tools that write a message: their files arrive as
 * entries of `attachments` (SCRUM-437). */
const EMAIL_TOOLS = ["gmail_send", "gmail_create_draft", "gmail_reply", "gmail_forward", "gmail_update_draft"];

/** The files of an email by the index of their `attachments` entry, or null
 * when any arrived in a field an email does not take. */
export function suppliedFrom(files: Map<string, HandedFile>): Map<number, HandedFile> | null {
  const out = new Map<number, HandedFile>();
  for (const [field, file] of files) {
    const m = ATTACHMENT_FIELD.exec(field);
    if (!m) return null;
    out.set(Number(m[1]), file);
  }
  return out;
}

function emailTool(name: string): ConsumingTool {
  return async (client, args, files) => {
    const supplied = suppliedFrom(files);
    if (!supplied) {
      return {
        content: [{ type: "text", text: "An email's files arrive as entries of its attachments. Nothing was sent." }],
        isError: true,
      };
    }
    return (await handleGmail(client, name, args, supplied)) as ToolResult;
  };
}

/** A tool that takes exactly one file, in the `file` field. */
function oneFile(
  tool: (client: GwsClient, args: Record<string, unknown>, file: SuppliedFile) => Promise<ToolResult>
): ConsumingTool {
  return async (client, args, files) => {
    const file = files.get("file");
    if (!file || files.size !== 1) {
      return {
        content: [{ type: "text", text: "This tool takes one file a call. Nothing was uploaded." }],
        isError: true,
      };
    }
    return tool(client, args, file);
  };
}

/** The tools this route serves. A tool is listed here only if it takes
 * bytes; everything else is reachable through /mcp alone. */
const consumingTools = new Map<string, ConsumingTool>([
  ["drive_upload_file", oneFile(uploadReferencedFile)],
  ...EMAIL_TOOLS.map((name): [string, ConsumingTool] => [name, emailTool(name)]),
]);

/** The whole body, at most: the files' cap, the arguments' cap, and room for
 * the multipart framing around them. The files alone are held to
 * MAX_ATTACHMENT_BYTES once the body is parsed. */
const MAX_BODY_BYTES = MAX_ATTACHMENT_BYTES + MAX_ARGS_BYTES + 64 * 1024;

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

/** Read the body, giving up the moment it passes the cap.
 *
 * The cap is enforced on bytes actually received, not on Content-Length,
 * which a caller can omit or get wrong. Returning from the loop stops the
 * read: no chunk past the one that crossed the line is pulled, and nothing
 * is kept. */
async function readCapped(
  body: AsyncIterable<Uint8Array>,
  cap: number
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > cap) throw new BodyTooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export async function handleConsume(
  req: ConsumeRequest
): Promise<ConsumeResponse> {
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

  // The body is the tool's arguments and its files as multipart (SCRUM-437):
  // the arguments outgrew a header once an email could carry a file.
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
  if (bytes > MAX_ATTACHMENT_BYTES) {
    return refuse(413, "too_large", tooLargeMessage());
  }

  let result: ToolResult;
  try {
    result = await tool(new GwsClient({ accessToken: token }), args, files);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
      _meta: errorMetaField(errorMetaFor(err)),
    };
  }

  const isError = result.isError === true;
  // One line, and nothing in it that came from the file, the folder or the
  // arguments: the outcome and a byte count.
  console.error(`[consume] ${toolName} outcome=${isError ? "error" : "ok"} bytes=${bytes}`);
  return {
    status: 200,
    body: { content: result.content, isError, ...(result._meta ? { _meta: result._meta } : {}) },
  };
}

function tooLargeMessage(): string {
  return `The file is larger than ${MAX_ATTACHMENT_BYTES} bytes.`;
}
