import type { IncomingMessage, ServerResponse } from "node:http";
import type { GwsClient } from "../gws-client.js";
import { gmailAttachment } from "./file-bytes/gmail-attachment.js";
import { gmailMessage } from "./file-bytes/gmail-message.js";
import { refuse, type FileBytesResponse, type Resolver } from "./file-bytes/shared.js";

export { MAX_NAME_LENGTH, type FileBytesCode, type FileBytesResponse } from "./file-bytes/shared.js";
export { fileNameFor, sanitiseSubject } from "./file-bytes/gmail-message.js";

/** The private route the gateway calls to fetch the bytes of a file
 * reference (SCRUM-384).
 *
 * WHY IT EXISTS: moving a file from one connector to another through tool
 * results would put the whole file in the model's context. The gateway asks
 * the plugin that owns the file for its bytes here, holds them in memory, and
 * hands them to the plugin that stores them. This is not an MCP tool and no
 * model can call it.
 *
 * This file is the route: the request, the token, the cap, and the choice of
 * resolver. What a reference type means lives in its own file under
 * `file-bytes/`.
 *
 * NOTHING ABOUT THE FILE IS LOGGED OR WRITTEN TO DISK. The one log line per
 * request carries the outcome code and a byte count. */

export const FILE_BYTES_PATH = "/internal/file-bytes";

/** The request is a small JSON object; anything larger is not one of ours. */
export const MAX_REQUEST_BYTES = 16 * 1024;

/** Every reference type, by the `type` a ref carries. Dispatch and the
 * supported-types text both read this, so a new type is one line here. */
export const RESOLVERS: Record<string, Resolver> = {
  gmail_message: gmailMessage,
  gmail_attachment: gmailAttachment,
};

export interface FileBytesRequest {
  method: string | undefined;
  /** The X-User-Token header: a Google access token. Never logged or echoed. */
  token: string | undefined;
  /** The request body as text. */
  body: string;
}

/** The whole route, with no socket: a request in, a response out. */
export async function handleFileBytes(
  req: FileBytesRequest,
  clientFor: (token: string) => GwsClient
): Promise<FileBytesResponse> {
  if (req.method !== "POST") {
    return refuse(405, "method_not_allowed", "This route answers POST only.", { Allow: "POST" });
  }
  if (!req.token) return refuse(401, "no_token", "The X-User-Token header is missing.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body);
  } catch {
    return refuse(400, "bad_request", "The request body is not JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return refuse(400, "bad_request", "The request body must be a JSON object.");
  }
  const { ref, max_bytes: maxBytes } = parsed as { ref?: unknown; max_bytes?: unknown };
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
    return refuse(400, "bad_request", "The request has no ref object.");
  }
  if (typeof maxBytes !== "number" || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    return refuse(400, "bad_request", "max_bytes must be a positive integer.");
  }
  const fields = ref as Record<string, unknown>;
  // A string that is the registry's own key: an array would coerce to one,
  // and `constructor` is on every object.
  const { type } = fields;
  if (typeof type !== "string" || !Object.hasOwn(RESOLVERS, type)) {
    const supported = Object.keys(RESOLVERS).join(", ");
    return refuse(400, "unsupported_ref", `This reference type is not supported. Supported: ${supported}.`);
  }
  const resolver = RESOLVERS[type];
  const invalid = resolver.validate(fields);
  if (invalid) return refuse(400, "bad_request", invalid);

  return resolver.resolve(fields, maxBytes, clientFor(req.token));
}

/** The request body as text, or null once it passes MAX_REQUEST_BYTES. */
async function readRequestBody(req: IncomingMessage): Promise<string | null> {
  const held: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) return null;
    held.push(chunk);
  }
  return Buffer.concat(held).toString("utf8");
}

/** The node:http side: read the request, answer, write the one log line. */
export async function serveFileBytes(
  req: IncomingMessage,
  res: ServerResponse,
  clientFor: (token: string) => GwsClient
): Promise<void> {
  let out: FileBytesResponse;
  try {
    const header = req.headers["x-user-token"];
    const token = Array.isArray(header) ? header[0] : header;
    const body = req.method === "POST" ? await readRequestBody(req) : "";
    out =
      body === null
        ? refuse(400, "bad_request", "The request body is too large.", { Connection: "close" })
        : await handleFileBytes({ method: req.method, token, body }, clientFor);
  } catch {
    // Nothing from the failure is echoed: it could describe the file.
    out = refuse(502, "upstream", "The file could not be read.");
  }
  console.error(`file-bytes: code=${out.code} status=${out.status} bytes=${out.code === "ok" ? out.body.length : 0}`);
  res.writeHead(out.status, out.headers).end(out.body);
}
