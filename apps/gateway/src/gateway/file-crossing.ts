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
import { resolveContent } from "./file-inbound";

/** Tools that take a file reference, by namespaced name, and the argument
 * that carries it. */
export const FILE_CONSUMING_TOOLS: Readonly<Record<string, { fileArg: string }>> = {
  "atlassian-mcp__jira_add_attachment": { fileArg: "file" },
  /** SCRUM-421. Source and destination are the same plugin, and the file
   * still crosses through here: one path, one set of caps, and a
   * reference's `account` can name a different connected account from the
   * one whose Drive receives it. */
  "gws-mcp__drive_upload_file": { fileArg: "file" },
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
  /** A Drive file as stored (SCRUM-428). A Google Docs, Sheets or Slides
   * file has no stored bytes and is refused by the plugin with the
   * drive_export reference to use instead. */
  drive_file: {
    plugin: "gws-mcp",
    service: "google-workspace",
    requiredStrings: ["file_id"],
    scopeTool: "drive_read_file",
    describes: "a Google Drive file",
  },
  /** A native file rendered to a format. The format is REQUIRED, and its own
   * type, because only required fields reach the plugin and only they are
   * covered by a download link's signature: an optional one would be dropped
   * on the way. */
  drive_export: {
    plugin: "gws-mcp",
    service: "google-workspace",
    requiredStrings: ["file_id", "format"],
    scopeTool: "drive_read_file",
    describes: "a Google Docs, Sheets or Slides file exported to a format",
  },
};

/**
 * Reference types whose bytes the gateway resolves itself (SCRUM-437): the
 * caller already holds the file, so there is no source plugin, no source
 * token and no `account`. `content` carries the file as base64 in the call;
 * `upload` names a file received through an upload link.
 */
export const LOCAL_REFERENCE_TYPES: Readonly<
  Record<"content" | "upload", { requiredStrings: readonly string[]; describes: string }>
> = {
  content: { requiredStrings: ["name", "base64"], describes: "a file carried in the call" },
  upload: { requiredStrings: ["upload_id"], describes: "a file received through an upload link" },
};

/** The local types a tool takes today. `upload` is declared above for the
 * upload link and joins this list when that link exists; until then it is
 * neither taken nor offered in a refusal's examples. */
export const ACCEPTED_LOCAL_TYPES: readonly string[] = ["content"];

/** The fields a reference of either kind must carry, or undefined for a type
 * that is neither. */
function requiredFieldsOf(type: string): readonly string[] | undefined {
  if (Object.hasOwn(FILE_REFERENCE_TYPES, type)) return FILE_REFERENCE_TYPES[type].requiredStrings;
  if (Object.hasOwn(LOCAL_REFERENCE_TYPES, type)) {
    return LOCAL_REFERENCE_TYPES[type as keyof typeof LOCAL_REFERENCE_TYPES].requiredStrings;
  }
  return undefined;
}

export function isLocalReference(ref: FileReference): boolean {
  return Object.hasOwn(LOCAL_REFERENCE_TYPES, ref.type);
}

/** The example a refusal shows for a reference type: its type and every
 * field the type requires, values elided. Built from the tables so the words
 * and the check cannot disagree. */
export function referenceExample(type: string): string {
  const fields = (requiredFieldsOf(type) ?? []).map((field) => `,"${field}":"..."`).join("");
  return `{"type":"${type}"${fields}}`;
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TRANSFERS_HOST = 2;
/** Downloads to a browser have their own host slots (SCRUM-420). A download
 * is the one transfer whose speed the other end controls, so in a shared
 * pool two slow readers could keep every attachment waiting. */
export const MAX_DOWNLOADS_HOST = 2;
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

/** A set of host slots. The per-user count is shared by every pool: one
 * file per user in memory at a time, whichever way it is going. */
type SlotPool = { inFlight: number; readonly max: number };
const POOLS = {
  transfer: { inFlight: 0, max: MAX_TRANSFERS_HOST } as SlotPool,
  download: { inFlight: 0, max: MAX_DOWNLOADS_HOST } as SlotPool,
};
export type SlotPoolName = keyof typeof POOLS;
const userInFlight = new Map<string, number>();

/** How many transfers are running, for tests and nothing else. */
export function transfersInFlight(): { host: number; users: number } {
  return { host: POOLS.transfer.inFlight, users: userInFlight.size };
}

/** The same for the download pool. */
export function downloadsInFlight(): number {
  return POOLS.download.inFlight;
}

/** What a refusal says did not happen. The Jira crossing uploads; a download
 * link does not, and a refusal that says "nothing was uploaded" about a link
 * describes the wrong thing. */
export type RefusalWords = {
  /** Mid-sentence, e.g. "nothing was uploaded". */
  clause: string;
  /** A sentence of its own, e.g. "Nothing was uploaded." */
  sentence: string;
  /** For the busy refusal, e.g. "Nothing was read or uploaded". */
  busy: string;
};
const UPLOAD_WORDS: RefusalWords = {
  clause: "nothing was uploaded",
  sentence: "Nothing was uploaded.",
  busy: "Nothing was read or uploaded",
};

export function refuse(text: string): CrossingResult {
  return { content: [{ type: "text", text }], isError: true };
}

const MB = 1024 * 1024;
const CAP_WORDS = `${MAX_FILE_BYTES / MB} MB`;

export type FileReference = { type: string; account?: string; [key: string]: unknown };

/**
 * Reads the file reference in `fileArg`. `local: false` is for a tool that
 * re-reads its source later and so cannot take a file the caller holds (the
 * download link): the local types are then unknown and go unlisted.
 */
export function readReference(
  args: Record<string, unknown>,
  fileArg: string,
  toolName: string,
  opts: { local?: boolean } = {}
): { ok: true; ref: FileReference } | { ok: false; text: string } {
  const local = opts.local ?? true;
  const types = [...Object.keys(FILE_REFERENCE_TYPES), ...(local ? ACCEPTED_LOCAL_TYPES : [])];
  const examples = types.map(referenceExample).join(" or ");
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
  const required = types.includes(ref.type) ? requiredFieldsOf(ref.type) : undefined;
  if (!required) {
    return {
      ok: false,
      text: `Unknown file reference type ${JSON.stringify(echoName(ref.type))}. ${shape}`,
    };
  }
  for (const field of required) {
    if (typeof ref[field] !== "string" || ref[field] === "") {
      return {
        ok: false,
        text: `A ${ref.type} reference needs a ${field} that is a non-empty string. ${shape}`,
      };
    }
  }
  if (Object.hasOwn(LOCAL_REFERENCE_TYPES, ref.type) && ref.account !== undefined) {
    const article = /^[aeiou]/.test(ref.type) ? "An" : "A";
    return { ok: false, text: `${article} ${ref.type} reference names no account: the file comes with the call.` };
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

/** The source side of a reference, resolved for the session's user: whose
 * token reads the file and which plugin answers it. */
type ResolvedSource = {
  ref: FileReference;
  token: string;
  mcpUrl: string;
};

/**
 * THE SOURCE LEG, PART ONE: who can read the referenced file. No byte moves
 * here. No connection, no grant or no plugin is a refusal in words.
 */
async function resolveSource(
  opts: Pick<CrossFileOptions, "resolveToken" | "resolvePluginUrl" | "surface" | "connectionsUrl">,
  ref: FileReference
): Promise<{ ok: true; source: ResolvedSource } | { ok: false; result: CrossingResult }> {
  const refType = FILE_REFERENCE_TYPES[ref.type];
  // The source side, for the session's user. No connection, no bytes.
  const serviceUrl = `${opts.connectionsUrl}/${refType.service}`;
  const source = await opts.resolveToken(refType.service, ref.account);
  if (!source?.token) {
    return {
      ok: false,
      result: refuse(
        ref.account
          ? `No connected account found for ${echoName(ref.account)}. The file is ${refType.describes}: connect that account at ${serviceUrl}, then try again.`
          : `${refType.service} is not connected. The file is ${refType.describes}: connect the account that holds it at ${serviceUrl}, then try again.`
      ),
    };
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
  if (!scope.ok) return { ok: false, result: refuse(scope.message) };

  const sourceMcpUrl = await opts.resolvePluginUrl(refType.plugin);
  if (!sourceMcpUrl) {
    return {
      ok: false,
      result: refuse(`A ${ref.type} file cannot be read right now: the connector that holds it is not available.`),
    };
  }
  return { ok: true, source: { ref, token: source.token, mcpUrl: sourceMcpUrl } };
}

/**
 * Claims one of the user's and one of the pool's slots, or refuses.
 * Everything that holds a file in memory holds one. Check and claim have no
 * await between them, so two calls cannot both see a free slot.
 */
function claimSlot(
  userId: string,
  pool: SlotPool,
  words: RefusalWords
): { ok: true; release: () => void } | { ok: false; result: CrossingResult } {
  if ((userInFlight.get(userId) ?? 0) >= MAX_TRANSFERS_PER_USER) {
    return {
      ok: false,
      result: refuse(
        "A file transfer of yours is already in progress. Files move one at a time: wait for it to finish, then try again."
      ),
    };
  }
  if (pool.inFlight >= pool.max) {
    return {
      ok: false,
      result: refuse(
        `The service is busy moving other files right now. ${words.busy}; try again in a minute.`
      ),
    };
  }
  pool.inFlight += 1;
  userInFlight.set(userId, (userInFlight.get(userId) ?? 0) + 1);
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      pool.inFlight -= 1;
      const left = (userInFlight.get(userId) ?? 1) - 1;
      if (left <= 0) userInFlight.delete(userId);
      else userInFlight.set(userId, left);
    },
  };
}

/** Runs `run` inside a transfer slot; the slot is freed however it ends. */
async function withTransferSlot(
  userId: string,
  run: () => Promise<CrossingResult>
): Promise<CrossingResult> {
  const slot = claimSlot(userId, POOLS.transfer, UPLOAD_WORDS);
  if (!slot.ok) return slot.result;
  try {
    return await run();
  } finally {
    slot.release();
  }
}

/** A file as the source gave it, whole and in memory. */
export type SourceFile = { bytes: Buffer<ArrayBuffer>; name: string; type: string };

/**
 * THE SOURCE LEG, PART TWO: the bytes, never more than the cap. Answers the
 * file or a refusal in words; a source that cannot be reached, or the
 * deadline, surfaces as the fetch's own throw for the caller to shape.
 */
async function fetchSourceFile(
  source: ResolvedSource,
  io: { fetchFn: typeof fetch; controller: AbortController },
  words: RefusalWords = UPLOAD_WORDS
): Promise<{ ok: true; file: SourceFile } | { ok: false; result: CrossingResult }> {
  const sourceRes = await io.fetchFn(routeUrl(source.mcpUrl, SOURCE_ROUTE), {
    method: "POST",
    headers: {
      "X-User-Token": source.token,
      "Content-Type": "application/json",
    },
    // Only the type and the fields that type declares go to the plugin.
    // `account` was used here to choose the token, and anything else the
    // caller put on the reference is dropped rather than passed through.
    body: JSON.stringify({ ref: closedReference(source.ref), max_bytes: MAX_FILE_BYTES }),
    signal: io.controller.signal,
  });

  if (sourceRes.status !== 200) {
    const message = await routeMessage(sourceRes);
    return {
      ok: false,
      result: refuse(`The file could not be read from its source, so ${words.clause}: ${message}`),
    };
  }

  const overCap = refuse(
    `The file is larger than ${CAP_WORDS}, the most that can be moved in one call. ${words.sentence}`
  );
  const declared = Number(sourceRes.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
    io.controller.abort();
    return { ok: false, result: overCap };
  }
  const body = await readCapped(sourceRes, MAX_FILE_BYTES);
  if (body.over) {
    io.controller.abort();
    return { ok: false, result: overCap };
  }

  let fileName: string;
  try {
    fileName = decodeURIComponent(sourceRes.headers.get("x-file-name") ?? "");
  } catch {
    fileName = "";
  }
  if (!fileName) {
    return {
      ok: false,
      result: refuse(`The file's source did not give it a usable name, so ${words.clause}.`),
    };
  }
  const fileType = sourceRes.headers.get("content-type") || "application/octet-stream";
  return { ok: true, file: { bytes: body.bytes, name: fileName, type: fileType } };
}

export type ReferencedFileOptions = Pick<
  CrossFileOptions,
  "userId" | "resolveToken" | "resolvePluginUrl" | "surface" | "connectionsUrl" | "fetchFn" | "timeoutMs"
> & {
  /** A reference `readReference` accepted. */
  ref: FileReference;
  pool: SlotPoolName;
  words: RefusalWords;
};

/** Why a referenced file was not handed over. `busy` read nothing; `source`
 * tried and did not get the file. */
export type ReferencedFileRefusal = { ok: false; reason: "busy" | "source"; result: CrossingResult };

/**
 * THE SOURCE LEG, WHOLE, for a consumer that is not a plugin (SCRUM-420).
 *
 * Reads the referenced file for the session's user and runs `use` on it
 * while the slot is still held, so the file is in memory only inside a
 * slot. The deadline covers the read; `use` sets its own.
 *
 * This is the only door to the read outside this module: the slot and the
 * deadline cannot be left out by a caller, because the caller never holds
 * the pieces. It never throws for a source it could not reach; that is a
 * refusal in words here, since there is no plugin call for a throw to mean
 * something about.
 */
export async function withReferencedFile<T>(
  opts: ReferencedFileOptions,
  use: (file: SourceFile) => Promise<T>
): Promise<{ ok: true; value: T } | ReferencedFileRefusal> {
  const resolved = await resolveSource(opts, opts.ref);
  if (!resolved.ok) return { ok: false, reason: "source", result: resolved.result };

  const slot = claimSlot(opts.userId, POOLS[opts.pool], opts.words);
  if (!slot.ok) return { ok: false, reason: "busy", result: slot.result };
  try {
    const timeoutMs = opts.timeoutMs ?? TRANSFER_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let fetched: Awaited<ReturnType<typeof fetchSourceFile>>;
    try {
      fetched = await fetchSourceFile(resolved.source, { fetchFn: opts.fetchFn ?? fetch, controller }, opts.words);
    } catch {
      // Not echoed, as in crossFile: a transport detail of a request that
      // carried a token.
      return {
        ok: false,
        reason: "source",
        result: refuse(
          timedOut
            ? `The read was abandoned after ${Math.round(timeoutMs / 1000)} seconds, while the file was still being read from its source. ${opts.words.sentence}`
            : `The file's source could not be reached. ${opts.words.sentence}`
        ),
      };
    } finally {
      clearTimeout(timer);
    }
    if (!fetched.ok) return { ok: false, reason: "source", result: fetched.result };
    return { ok: true, value: await use(fetched.file) };
  } finally {
    slot.release();
  }
}

/**
 * THE DESTINATION LEG: hands a file to the plugin that stores it, with the
 * tool's arguments, and answers that tool's own result.
 */
async function sendToDestination(
  file: SourceFile,
  dest: { url: string; token: string; toolName: string; encodedArgs: string },
  io: { fetchFn: typeof fetch; controller: AbortController }
): Promise<CrossingResult> {
  const destRes = await io.fetchFn(routeUrl(dest.url, DESTINATION_ROUTE), {
    method: "POST",
    headers: {
      "X-User-Token": dest.token,
      "X-Tool-Name": dest.toolName,
      "X-Tool-Args": dest.encodedArgs,
      "X-File-Name": encodeURIComponent(file.name),
      "X-File-Type": file.type,
      "Content-Type": "application/octet-stream",
    },
    body: file.bytes,
    signal: io.controller.signal,
  });

  if (destRes.status !== 200) {
    const message = await routeMessage(destRes);
    return refuse(`${dest.toolName} did not accept the file: ${message}`);
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
      `${dest.toolName} took the file but its answer could not be read. The file may or may not have been uploaded; check the destination before trying again.`
    );
  }
  return parsed;
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

  const destinationToken = opts.destinationToken;
  if (!destinationToken) {
    return refuse(`${opts.toolName} needs a connected account before it can take a file.`);
  }

  // A local reference's content never leaves the gateway: the plugin gets
  // its type alone, and the bytes as the body. No consume route reads the
  // file argument, and base64 in it would not fit the header anyway.
  const local = isLocalReference(read.ref);
  const sentArgs = local ? { ...opts.args, [consuming.fileArg]: closedFileArg(read.ref) } : opts.args;
  const encodedArgs = Buffer.from(JSON.stringify(sentArgs), "utf8").toString("base64url");
  if (encodedArgs.length > MAX_ENCODED_ARGS_CHARS) {
    return refuse(
      `The arguments to ${opts.toolName} are too large to send with a file. Shorten them and try again.`
    );
  }

  if (local) return crossLocalFile(opts, read.ref, { url: opts.destinationUrl, token: destinationToken, encodedArgs });

  const resolved = await resolveSource(opts, read.ref);
  if (!resolved.ok) return resolved.result;

  return withTransferSlot(opts.userId, async () => {
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
      const fetched = await fetchSourceFile(resolved.source, { fetchFn, controller });
      if (!fetched.ok) return fetched.result;

      leg = "destination";
      return await sendToDestination(
        fetched.file,
        { url: opts.destinationUrl, token: destinationToken, toolName: opts.toolName, encodedArgs },
        { fetchFn, controller }
      );
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
    }
  });
}

/** What a destination plugin is told about a local reference: its type.
 * The content, or an upload's id, stays in the gateway. */
export function closedFileArg(ref: FileReference): Record<string, unknown> {
  return { type: ref.type };
}

/**
 * A consuming tool whose file the caller holds (SCRUM-437). The same
 * destination leg as `crossFile`, with no source read: the file is decoded
 * here, inside the transfer slot, so it is in memory only while one is held.
 */
async function crossLocalFile(
  opts: CrossFileOptions,
  ref: FileReference,
  dest: { url: string; token: string; encodedArgs: string }
): Promise<CrossingResult> {
  // The Agent keeps tool arguments in its thread history and draws them on
  // its approval card, so a content reference there would store a file.
  if (ref.type === "content" && opts.surface === "agent") {
    return refuse(
      "A content reference cannot be used in the dashboard Agent, which keeps the arguments of every tool call. Nothing was uploaded."
    );
  }
  return withTransferSlot(opts.userId, async () => {
    const decoded = resolveContent(ref);
    if (!decoded.ok) return refuse(decoded.text);

    const fetchFn = opts.fetchFn ?? fetch;
    const timeoutMs = opts.timeoutMs ?? TRANSFER_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      return await sendToDestination(decoded.file, { ...dest, toolName: opts.toolName }, { fetchFn, controller });
    } catch {
      // As in crossFile: a transport detail of a request that carried a
      // token is not echoed.
      if (timedOut) {
        return refuse(
          `The transfer was abandoned after ${Math.round(timeoutMs / 1000)} seconds, while the file was being handed to ${opts.toolName}. The file may or may not have been uploaded; check the destination before trying again.`
        );
      }
      throw new Error(
        `the connection to ${opts.toolName} failed while the file was being handed over. The file may or may not have been uploaded; check the destination before trying again.`
      );
    } finally {
      clearTimeout(timer);
    }
  });
}

/** The reference as the source plugin gets it: its type and the string
 * fields that type requires, and nothing else. */
function closedReference(ref: FileReference): Record<string, unknown> {
  const out: Record<string, unknown> = { type: ref.type };
  const declared = FILE_REFERENCE_TYPES[ref.type as keyof typeof FILE_REFERENCE_TYPES];
  for (const field of declared.requiredStrings) out[field] = ref[field];
  return out;
}
