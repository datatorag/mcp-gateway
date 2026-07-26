import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { mcpServers } from "@datatorag-mcp/db";
import type { EngineTool } from "./engine";
import { NAMESPACE_SEPARATOR } from "../plugin-manager";
import { PLUGIN_SERVICE_MAP, getServiceToken } from "../service-token";
import {
  listUserToolRows,
  buildPluginServerUrl,
  callPluginToolOnce,
} from "../user-tools";

/**
 * Extracted from POST /api/playground/call, which now delegates to
 * listUserEngineTools/executeUserTool below. This module is also the tool
 * source/executor for the playground agent loop (engine.ts, wired up by
 * the streaming route). The connected-service policy and plugin-invocation
 * mechanics are shared with the MCP front door via ../user-tools.
 */

/** Thrown for pre-flight tool-call failures the route maps to a specific
 * HTTP status (mirrors what /api/playground/call returned before this
 * extraction). Genuine execution-time failures (network/connection errors
 * from the plugin call) propagate as plain Errors instead — the route maps
 * those to 500, same as before. */
export class ToolCallError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ToolCallError";
    this.status = status;
  }
}

// Fallback verb heuristic — used ONLY for tools the plugin didn't annotate
// with an MCP readOnlyHint (see classifyWrite). Verbs (as `_`-delimited
// tokens in a tool's action name) that indicate the tool MUTATES state.
// Reads (list/get/search/read/freebusy/…) never match. Matching a token (not
// a substring) keeps `directory_search` a read while `docs_create` /
// `gmail_send` / `sheets_append` / `slides_batch_update` are writes. `run`/
// `exec`/`execute` cover arbitrary-operation runners (e.g. gws_run) that carry
// no other verb.
const WRITE_VERBS = new Set([
  "create", "update", "delete", "write", "send", "reply", "forward",
  "append", "add", "insert", "mark", "complete", "save", "transition",
  "respond", "move", "copy", "edit", "remove", "upload", "batch",
  "run", "exec", "execute", "publish", "share", "grant", "revoke",
  "archive", "trash", "rename", "submit", "restore", "cancel", "clear",
]);

/** Heuristic fallback: whether a namespaced tool mutates state, judged by the
 * action segment's verb tokens. Prefer classifyWrite, which trusts the MCP
 * readOnlyHint annotation and only falls back to this when unannotated. */
export function isWriteTool(namespacedName: string): boolean {
  const sep = namespacedName.indexOf(NAMESPACE_SEPARATOR);
  const action = sep === -1 ? namespacedName : namespacedName.slice(sep + NAMESPACE_SEPARATOR.length);
  return action
    .toLowerCase()
    .split("_")
    .some((token) => WRITE_VERBS.has(token));
}

/** Whether a tool must be user-confirmed in the playground before it runs.
 * Trusts the MCP readOnlyHint annotation from the registry when present; falls
 * back to the verb heuristic only when the plugin didn't annotate the tool. */
export function classifyWrite(row: {
  namespacedName: string;
  readOnlyHint: boolean | null;
}): boolean {
  if (row.readOnlyHint === true) return false; // declared read-only
  if (row.readOnlyHint === false) return true; // declared mutating
  return isWriteTool(row.namespacedName); // unannotated → heuristic
}

export function parseNamespacedName(namespacedName: string): {
  serverSlug: string;
  toolName: string;
} {
  const separatorIndex = namespacedName.indexOf(NAMESPACE_SEPARATOR);
  if (separatorIndex === -1) {
    throw new ToolCallError(`Invalid tool name: ${namespacedName}`, 400);
  }
  return {
    serverSlug: namespacedName.slice(0, separatorIndex),
    toolName: namespacedName.slice(
      separatorIndex + NAMESPACE_SEPARATOR.length
    ),
  };
}

/** Flattens an MCP CallToolResult to the { text, isError } shape the
 * playground engine and the /api/playground/call route both consume:
 * all `content[].text` blocks joined with "\n"; isError only when the
 * result explicitly says so. */
export function flattenToolResult(result: {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}): { text: string; isError: boolean } {
  const text = (result.content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text as string)
    .join("\n");
  return { text, isError: result.isError === true };
}

/**
 * The user's visible tools (shared connected-service policy — see
 * user-tools.ts), shaped for the Anthropic API as EngineTool[], plus an
 * `isWrite` predicate derived from each tool's registry annotation (verb
 * heuristic fallback) — the write-confirmation gate the engine consumes.
 * (/api/playground/tools filters neither status nor enabled — this
 * intentionally does NOT copy that route's query shape.)
 */
export async function listUserEngineTools(
  db: Database,
  userId: string
): Promise<{ tools: EngineTool[]; isWrite: (name: string) => boolean }> {
  const rows = await listUserToolRows(db, userId);
  const writeNames = new Set<string>();
  const tools = rows.map((r) => {
    if (classifyWrite(r)) writeNames.add(r.namespacedName);
    return {
      name: r.namespacedName,
      description: r.description,
      input_schema: r.schema,
    };
  });
  return { tools, isWrite: (name) => writeNames.has(name) };
}

/**
 * Executes one namespaced tool exactly like POST /api/playground/call did
 * (slug split, PLUGIN_SERVICE_MAP, getServiceToken, one-shot client — see
 * user-tools.ts). Strips any `account` key from args — playground always
 * uses the user's default account for the service; the multi-account
 * limitation is accepted for v1.
 *
 * Throws a ToolCallError (with an HTTP status) for pre-flight failures
 * (bad name, unknown server, no service mapping, service not connected) so
 * the route can map them to the same status codes it always has. Plugin
 * connection/execution failures propagate as plain Errors — the route
 * maps those to 500, same as before.
 */
export async function executeUserTool(
  db: Database,
  userId: string,
  namespacedName: string,
  args: Record<string, unknown>
): Promise<{ text: string; isError: boolean }> {
  const { serverSlug, toolName } = parseNamespacedName(namespacedName);

  const [mcpServer] = await db
    .select({
      id: mcpServers.id,
      containerPort: mcpServers.containerPort,
      githubRepoUrl: mcpServers.githubRepoUrl,
    })
    .from(mcpServers)
    .where(eq(mcpServers.slug, serverSlug))
    .limit(1);

  if (!mcpServer) {
    throw new ToolCallError(`Unknown server: ${serverSlug}`, 400);
  }

  const requiredService = PLUGIN_SERVICE_MAP[serverSlug];
  if (!requiredService) {
    throw new ToolCallError(`No service mapping for ${serverSlug}`, 400);
  }

  const cleanArgs = { ...args };
  delete cleanArgs.account;

  const userToken = await getServiceToken(db, userId, requiredService);
  if (!userToken) {
    throw new ToolCallError(
      "Service not connected. Please connect from the dashboard first.",
      403
    );
  }

  const result = await callPluginToolOnce({
    serverUrl: buildPluginServerUrl({ slug: serverSlug, ...mcpServer }),
    userToken,
    toolName,
    args: cleanArgs,
    clientName: "datatorag-playground",
  });
  return flattenToolResult(
    result as { content?: Array<{ type: string; text?: string }>; isError?: boolean }
  );
}
