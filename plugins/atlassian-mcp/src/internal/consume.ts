/**
 * The private route the gateway uses to hand this plugin a file.
 *
 *   POST /internal/consume
 *
 * It is NOT an MCP tool and no model ever calls it. A tool such as
 * jira_add_attachment takes a file REFERENCE (where a file lives, not its
 * content). The gateway resolves that reference by fetching the bytes from
 * another connector, then calls this route with the bytes as the request
 * body and the tool's arguments in a header. The bytes go gateway to plugin
 * to Jira and never pass through a conversation.
 *
 * This module knows nothing about sockets: it takes a method, headers and an
 * async iterable of chunks, and answers a status and a JSON body, so every
 * branch is testable without a server.
 */

import { AtlassianClient } from "../atlassian-client.js";
import {
  addJiraAttachment,
  isIssueKey,
  MAX_ATTACHMENT_BYTES,
  type SuppliedFile,
} from "../tools/jira.js";

export const CONSUME_PATH = "/internal/consume";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ConsumingTool = (
  client: AtlassianClient,
  args: Record<string, unknown>,
  file: SuppliedFile
) => Promise<ToolResult>;

/** The tools this route serves. A tool is listed here only if it takes
 * bytes; everything else is reachable through /mcp alone. */
const consumingTools = new Map<string, ConsumingTool>([
  ["jira_add_attachment", addJiraAttachment],
]);

export interface ConsumeRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
}

export interface ConsumeResponse {
  status: number;
  body:
    | { error: string; code: string }
    | { content: Array<{ type: "text"; text: string }>; isError: boolean };
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

  const rawArgs = header("x-tool-args");
  if (!rawArgs) {
    return refuse(400, "bad_request", "Missing X-Tool-Args.");
  }
  let args: Record<string, unknown>;
  try {
    // Buffer's base64url decoder never throws, it skips what it does not
    // recognise, so the alphabet is checked first.
    if (!/^[A-Za-z0-9_-]+$/.test(rawArgs)) throw new Error("not base64url");
    const parsed: unknown = JSON.parse(
      Buffer.from(rawArgs, "base64url").toString("utf8")
    );
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    args = parsed as Record<string, unknown>;
  } catch {
    return refuse(
      400,
      "bad_request",
      "X-Tool-Args must be the base64url of a JSON object."
    );
  }

  const rawName = header("x-file-name");
  if (!rawName) {
    return refuse(400, "bad_request", "Missing X-File-Name.");
  }
  let fileName: string;
  try {
    fileName = decodeURIComponent(rawName);
  } catch {
    return refuse(400, "bad_request", "X-File-Name is not URI-encoded.");
  }

  const fileType = header("x-file-type");
  if (!fileType) {
    return refuse(400, "bad_request", "Missing X-File-Type.");
  }

  // Content-Length is only a shortcut for an honest caller. The read below
  // enforces the cap whatever this header says.
  const declared = Number(header("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES) {
    return refuse(413, "too_large", tooLargeMessage());
  }

  let bytes: Buffer;
  try {
    bytes = await readCapped(req.body, MAX_ATTACHMENT_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLarge) {
      return refuse(413, "too_large", tooLargeMessage());
    }
    return refuse(400, "bad_request", "The body could not be read.");
  }
  if (bytes.byteLength === 0) {
    return refuse(400, "bad_request", "The body is empty.");
  }

  let result: ToolResult;
  try {
    result = await tool(new AtlassianClient({ accessToken: token }), args, {
      bytes,
      name: fileName,
      type: fileType,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }

  const isError = result.isError === true;
  // One line, and nothing in it that came from the file or the issue's
  // content: no filename, no summary. The key is logged only once it has the
  // shape of a key, so the line cannot be made to say anything else.
  console.error(
    `[consume] ${toolName} outcome=${isError ? "error" : "ok"} bytes=${bytes.byteLength} issue=${
      isIssueKey(args.issue_key) ? args.issue_key : "invalid"
    }`
  );
  return { status: 200, body: { content: result.content, isError } };
}

function tooLargeMessage(): string {
  return `The file is larger than ${MAX_ATTACHMENT_BYTES} bytes.`;
}
