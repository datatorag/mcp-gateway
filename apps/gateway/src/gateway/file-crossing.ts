/**
 * SCRUM-384 stage 1: carrying a file from one plugin to another.
 *
 * A caller invokes a consuming tool with a FILE REFERENCE in its arguments
 * instead of bytes. Inside that one call the gateway asks the plugin that
 * owns the reference's service for the bytes over a private route, holds them
 * in memory, and hands them to the destination plugin over a private route
 * together with the tool's arguments. Nothing is written to disk, there is no
 * handle to expire and nothing to clean up.
 *
 * What this module must never do, and its tests pin:
 * - sniff. Which tools take a file and which reference types exist are the
 *   two registries below; any other tool is untouched.
 * - name a URL. A reference names one of the user's connected services, so
 *   bytes only ever move between two of them.
 * - cross the tokens. The source token goes to the source plugin only, the
 *   destination token to the destination plugin only.
 * - read, change or log the file. The name and type the source gives are
 *   passed through; nothing here writes a log line.
 */

import type { ResolvedServiceToken } from "./service-token";
import { checkScopeForTool, type Surface } from "./scope-grant";
import { echoName } from "./skills-catalogue";

/** Tools that take a file reference, by namespaced name, and the argument
 * that carries it. */
export const FILE_CONSUMING_TOOLS: Readonly<Record<string, { fileArg: string }>> = {
  "atlassian-mcp__jira_add_attachment": { fileArg: "file" },
};

/** Reference types: the plugin that can answer the bytes, the service whose
 * token that takes, the fields a reference of the type must carry, and a tool
 * of the same family whose scope the read needs (the scope pre-check judges
 * by tool name). */
export const FILE_REFERENCE_TYPES: Readonly<
  Record<
    string,
    {
      plugin: string;
      service: string;
      requiredStrings: readonly string[];
      scopeTool: string;
      describes: string;
    }
  >
> = {
  gmail_message: {
    plugin: "gws-mcp",
    service: "google-workspace",
    requiredStrings: ["message_id"],
    scopeTool: "gmail_export_message",
    describes: "a Gmail message",
  },
  /** One attachment of a message, by its PART id (SCRUM-395). Gmail issues
   * a new attachment id on every read of a message, so only the part id,
   * which `gmail_read` lists, names the same attachment twice. The scope is
   * judged as `gmail_read`: every Gmail tool maps to the one Gmail scope,
   * and that is the tool a caller reads the part id from. */
  gmail_attachment: {
    plugin: "gws-mcp",
    service: "google-workspace",
    requiredStrings: ["message_id", "part_id"],
    scopeTool: "gmail_read",
    describes: "an attachment of a Gmail message",
  },
};

/** The example a refusal shows for a reference type: its type and every
 * field the type requires, values elided. Built from the table so the words
 * and the check cannot disagree. */
export function referenceExample(type: string): string {
  const fields = FILE_REFERENCE_TYPES[type].requiredStrings.map((field) => `,"${field}":"..."`).join("");
  return `{"type":"${type}"${fields}}`;
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TRANSFERS_HOST = 2;
export const MAX_TRANSFERS_PER_USER = 1;
export const TRANSFER_TIMEOUT_MS = 60_000;

/** The arguments travel in a request header, and the plugin's HTTP server
 * caps the size of all headers together. Refused before any byte moves. */
const MAX_ENCODED_ARGS_CHARS = 8 * 1024;
/** A route's JSON answer (an error, or the tool result) is small. */
const MAX_ROUTE_ANSWER_BYTES = 1024 * 1024;
const MAX_ROUTE_MESSAGE_CHARS = 500;

const SOURCE_ROUTE = "/internal/file-bytes";
const DESTINATION_ROUTE = "/internal/consume";

export type CrossingResult = {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
  [key: string]: unknown;
};

export type CrossFileOptions = {
  /** The session's user. Both tokens are this user's and nobody else's. */
  userId: string;
  /** Namespaced tool name, e.g. `atlassian-mcp__jira_add_attachment`. */
  tool: string;
  /** Bare tool name the destination plugin knows, e.g. `jira_add_attachment`. */
  toolName: string;
  /** The tool's arguments as the plugin would receive them on an ordinary
   * call, file reference included. */
  args: Record<string, unknown>;
  /** The destination plugin's MCP URL (`buildPluginServerUrl`). */
  destinationUrl: string;
  destinationToken: string | null;
  /** Resolves a service token for THE SESSION USER; the caller binds the
   * user, so this module cannot ask for anyone else's. */
  resolveToken: (service: string, account?: string) => Promise<ResolvedServiceToken | null>;
  /** The MCP URL of an installed plugin by slug, or null. */
  resolvePluginUrl: (pluginSlug: string) => Promise<string | null>;
  surface: Surface;
  /** Absolute connections page URL, for the refusals that name a fix. */
  connectionsUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

export function fileCrossingFor(tool: string): { fileArg: string } | null {
  return Object.hasOwn(FILE_CONSUMING_TOOLS, tool) ? FILE_CONSUMING_TOOLS[tool] : null;
}

let hostInFlight = 0;
const userInFlight = new Map<string, number>();

/** How many transfers are running, for tests and nothing else. */
export function transfersInFlight(): { host: number; users: number } {
  return { host: hostInFlight, users: userInFlight.size };
}

function refuse(text: string): CrossingResult {
  return { content: [{ type: "text", text }], isError: true };
}

const MB = 1024 * 1024;
const CAP_WORDS = `${MAX_FILE_BYTES / MB} MB`;

type FileReference = { type: string; account?: string; [key: string]: unknown };

function readReference(
  args: Record<string, unknown>,
  fileArg: string,
  toolName: string
): { ok: true; ref: FileReference } | { ok: false; text: string } {
  const examples = Object.keys(FILE_REFERENCE_TYPES).map(referenceExample).join(" or ");
  const shape = `${toolName} takes a file reference in "${fileArg}", an object such as ${examples}.`;
  const raw = args[fileArg];
  if (raw === undefined || raw === null) {
    return { ok: false, text: `The "${fileArg}" argument is missing. ${shape}` };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, text: `The "${fileArg}" argument is not an object. ${shape}` };
  }
  const ref = raw as Record<string, unknown>;
  if (typeof ref.type !== "string") {
    return { ok: false, text: `The "${fileArg}" argument has no type. ${shape}` };
  }
  if (!Object.hasOwn(FILE_REFERENCE_TYPES, ref.type)) {
    return {
      ok: false,
      text: `Unknown file reference type ${JSON.stringify(echoName(ref.type))}. ${shape}`,
    };
  }
  for (const field of FILE_REFERENCE_TYPES[ref.type].requiredStrings) {
    if (typeof ref[field] !== "string" || ref[field] === "") {
      return {
        ok: false,
        text: `A ${ref.type} reference needs a ${field} that is a non-empty string. ${shape}`,
      };
    }
  }
  if (ref.account !== undefined && typeof ref.account !== "string") {
    return {
      ok: false,
      text: `The account on a file reference must be the address of a connected account, as a string. ${shape}`,
    };
  }
  return { ok: true, ref: ref as FileReference };
}

function routeUrl(mcpUrl: string, path: string): string {
  const url = new URL(mcpUrl);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** Reads a response body, never holding more than `cap` bytes: the read stops
 * at the chunk that crosses the line and that chunk is dropped. */
async function readCapped(
  res: Response,
  cap: number
): Promise<{ over: false; bytes: Buffer<ArrayBuffer> } | { over: true }> {
  if (!res.body) return { over: false, bytes: Buffer.alloc(0) };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return { over: true };
    }
    chunks.push(value);
  }
  return { over: false, bytes: Buffer.concat(chunks, total) };
}

/** The `{error, code}` a private route answers with, as one sentence. */
async function routeMessage(res: Response): Promise<string> {
  let message = "";
  try {
    const body = await readCapped(res, MAX_ROUTE_ANSWER_BYTES);
    if (!body.over) {
      const parsed: unknown = JSON.parse(body.bytes.toString("utf8"));
      const error = (parsed as { error?: unknown } | null)?.error;
      if (typeof error === "string") message = error;
    }
  } catch {
    // Not JSON: the status alone is the message.
  }
  const printable = message.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim();
  return printable
    ? printable.slice(0, MAX_ROUTE_MESSAGE_CHARS)
    : `the plugin answered ${res.status} with no message`;
}

function isToolResult(value: unknown): value is CrossingResult {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

/**
 * Runs a consuming tool: resolves its file reference to bytes from the source
 * plugin and hands them to the destination plugin, inside the one call.
 *
 * Answers a tool result in every case it can describe. It THROWS only when a
 * plugin could not be spoken to at all, as an ordinary plugin call does, so
 * the dispatch shapes and tracks that the way it does for any other tool.
 */
export async function crossFile(opts: CrossFileOptions): Promise<CrossingResult> {
  const consuming = fileCrossingFor(opts.tool);
  if (!consuming) {
    return refuse(`${opts.toolName} does not take a file.`);
  }

  const read = readReference(opts.args, consuming.fileArg, opts.toolName);
  if (!read.ok) return refuse(read.text);
  const ref = read.ref;
  const refType = FILE_REFERENCE_TYPES[ref.type];

  if (!opts.destinationToken) {
    return refuse(`${opts.toolName} needs a connected account before it can take a file.`);
  }

  const encodedArgs = Buffer.from(JSON.stringify(opts.args), "utf8").toString("base64url");
  if (encodedArgs.length > MAX_ENCODED_ARGS_CHARS) {
    return refuse(
      `The arguments to ${opts.toolName} are too large to send with a file. Shorten them and try again.`
    );
  }

  // The source side, for the session's user. No connection, no bytes.
  const serviceUrl = `${opts.connectionsUrl}/${refType.service}`;
  const source = await opts.resolveToken(refType.service, ref.account);
  if (!source?.token) {
    return refuse(
      ref.account
        ? `No connected account found for ${echoName(ref.account)}. The file is ${refType.describes}: connect that account at ${serviceUrl}, then try again.`
        : `${refType.service} is not connected. The file is ${refType.describes}: connect the account that holds it at ${serviceUrl}, then try again.`
    );
  }
  // Same pre-check, same module and same fail-open rule as every other call:
  // a grant known to lack the scope is refused in words; one that cannot be
  // read goes through.
  const scope = checkScopeForTool({
    toolName: refType.scopeTool,
    service: refType.service,
    granted: source.scopes,
    surface: opts.surface,
    connectionsUrl: serviceUrl,
  });
  if (!scope.ok) return refuse(scope.message);

  const sourceMcpUrl = await opts.resolvePluginUrl(refType.plugin);
  if (!sourceMcpUrl) {
    return refuse(`A ${ref.type} file cannot be read right now: the connector that holds it is not available.`);
  }

  // Limits. Check and claim with no await between them, so two calls cannot
  // both see a free slot.
  if ((userInFlight.get(opts.userId) ?? 0) >= MAX_TRANSFERS_PER_USER) {
    return refuse(
      "A file transfer of yours is already in progress. Files move one at a time: wait for it to finish, then try again."
    );
  }
  if (hostInFlight >= MAX_TRANSFERS_HOST) {
    return refuse(
      "The service is busy moving other files right now. Nothing was read or uploaded; try again in a minute."
    );
  }
  hostInFlight += 1;
  userInFlight.set(opts.userId, (userInFlight.get(opts.userId) ?? 0) + 1);

  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? TRANSFER_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  /** Which leg is running. Decides what a failure can honestly say about
   * whether the file reached the destination. */
  let leg: "source" | "destination" = "source";

  try {
    const sourceRes = await fetchFn(routeUrl(sourceMcpUrl, SOURCE_ROUTE), {
      method: "POST",
      headers: {
        "X-User-Token": source.token,
        "Content-Type": "application/json",
      },
      // Only the type and the fields that type declares go to the plugin.
      // `account` was used here to choose the token, and anything else the
      // caller put on the reference is dropped rather than passed through.
      body: JSON.stringify({ ref: closedReference(ref), max_bytes: MAX_FILE_BYTES }),
      signal: controller.signal,
    });

    if (sourceRes.status !== 200) {
      const message = await routeMessage(sourceRes);
      return refuse(`The file could not be read from its source, so nothing was uploaded: ${message}`);
    }

    const overCap = refuse(
      `The file is larger than ${CAP_WORDS}, the most that can be moved in one call. Nothing was uploaded.`
    );
    const declared = Number(sourceRes.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
      controller.abort();
      return overCap;
    }
    const body = await readCapped(sourceRes, MAX_FILE_BYTES);
    if (body.over) {
      controller.abort();
      return overCap;
    }

    let fileName: string;
    try {
      fileName = decodeURIComponent(sourceRes.headers.get("x-file-name") ?? "");
    } catch {
      fileName = "";
    }
    if (!fileName) {
      return refuse("The file's source did not give it a usable name, so nothing was uploaded.");
    }
    const fileType = sourceRes.headers.get("content-type") || "application/octet-stream";

    leg = "destination";
    const destRes = await fetchFn(routeUrl(opts.destinationUrl, DESTINATION_ROUTE), {
      method: "POST",
      headers: {
        "X-User-Token": opts.destinationToken,
        "X-Tool-Name": opts.toolName,
        "X-Tool-Args": encodedArgs,
        "X-File-Name": encodeURIComponent(fileName),
        "X-File-Type": fileType,
        "Content-Type": "application/octet-stream",
      },
      body: body.bytes,
      signal: controller.signal,
    });

    if (destRes.status !== 200) {
      const message = await routeMessage(destRes);
      return refuse(`${opts.toolName} did not accept the file: ${message}`);
    }

    const answer = await readCapped(destRes, MAX_ROUTE_ANSWER_BYTES);
    let parsed: unknown = null;
    if (!answer.over) {
      try {
        parsed = JSON.parse(answer.bytes.toString("utf8"));
      } catch {
        parsed = null;
      }
    }
    if (!isToolResult(parsed)) {
      return refuse(
        `${opts.toolName} took the file but its answer could not be read. The file may or may not have been uploaded; check the destination before trying again.`
      );
    }
    return parsed;
  } catch {
    // The underlying error is deliberately not echoed: it is a transport
    // detail, and nothing from a request that carried a token is repeated.
    const seconds = Math.round(timeoutMs / 1000);
    if (timedOut) {
      return refuse(
        leg === "source"
          ? `The transfer was abandoned after ${seconds} seconds, while the file was still being read from its source. Nothing was uploaded.`
          : `The transfer was abandoned after ${seconds} seconds, while the file was being handed to ${opts.toolName}. The file may or may not have been uploaded; check the destination before trying again.`
      );
    }
    throw new Error(
      leg === "source"
        ? "the file's source could not be reached. Nothing was uploaded."
        : `the connection to ${opts.toolName} failed while the file was being handed over. The file may or may not have been uploaded; check the destination before trying again.`
    );
  } finally {
    clearTimeout(timer);
    hostInFlight -= 1;
    const left = (userInFlight.get(opts.userId) ?? 1) - 1;
    if (left <= 0) userInFlight.delete(opts.userId);
    else userInFlight.set(opts.userId, left);
  }
}

/** The reference as the source plugin gets it: its type and the string
 * fields that type requires, and nothing else. */
function closedReference(ref: FileReference): Record<string, unknown> {
  const out: Record<string, unknown> = { type: ref.type };
  const declared = FILE_REFERENCE_TYPES[ref.type as keyof typeof FILE_REFERENCE_TYPES];
  for (const field of declared.requiredStrings) out[field] = ref[field];
  return out;
}
