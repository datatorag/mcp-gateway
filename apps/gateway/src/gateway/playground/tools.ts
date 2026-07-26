import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { mcpServers } from "@datatorag-mcp/db";
import { NAMESPACE_SEPARATOR } from "../plugin-manager";
import { PLUGIN_SERVICE_MAP, getServiceToken } from "../service-token";
import { buildPluginServerUrl, callPluginToolOnce } from "../user-tools";

/**
 * Two things live here, and they are no longer one feature.
 *
 * The WRITE CLASSIFICATION — `isWriteTool`, `ALWAYS_WRITE_TOOLS`,
 * `classifyWrite`, `stripAccountArg` — is the product's security policy for
 * which tool calls a user has to approve. The agent runtime consumes it (see
 * `src/mastra/mcp/client.ts`, which sets `requireApproval` from it); it does
 * not depend on the runtime, which is why it outlived the hand-rolled loop
 * that used to be its only caller.
 *
 * `executeUserTool` and its helpers are the direct, non-agent tool call behind
 * POST /api/playground/call — the per-service tool tester on the connections
 * page. That path never went through the agent loop and is untouched by its
 * removal. The connected-service policy and plugin-invocation mechanics it
 * shares with the MCP front door live in ../user-tools.
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

// Verbs (as `_`-delimited tokens in a tool's action name) that indicate the
// tool MUTATES state. Reads (list/get/search/read/freebusy/…) never match.
// Matching a token (not a substring) keeps `directory_search` a read while
// `docs_create` / `gmail_send` / `sheets_append` / `slides_batch_update` are
// writes. `run`/`exec`/`execute` cover arbitrary-operation runners (e.g.
// gws_run) that carry no other verb.
const WRITE_VERBS = new Set([
  "create", "update", "delete", "write", "send", "reply", "forward",
  "append", "add", "insert", "mark", "complete", "save", "transition",
  "respond", "move", "copy", "edit", "remove", "upload", "batch",
  "run", "exec", "execute", "publish", "share", "grant", "revoke",
  "archive", "trash", "rename", "submit", "restore", "cancel", "clear",
]);

/** The floor of the write classification: whether a namespaced tool mutates
 * state, judged by the action segment's verb tokens. Call {@link classifyWrite}
 * rather than this — it is the floor plus the escalation list below. */
export function isWriteTool(namespacedName: string): boolean {
  const sep = namespacedName.indexOf(NAMESPACE_SEPARATOR);
  const action = sep === -1 ? namespacedName : namespacedName.slice(sep + NAMESPACE_SEPARATOR.length);
  return action
    .toLowerCase()
    .split("_")
    .some((token) => WRITE_VERBS.has(token));
}

/**
 * Tools that must be treated as writes even though their name reads as one.
 *
 * This list can only ever RAISE a tool to "write". There is deliberately no
 * companion list that lowers one to "read": the whole point of a floor is that
 * nothing can dig under it, and a mechanism for declaring something safe is a
 * mechanism for declaring something unsafely safe.
 *
 * It lives in source, in this file, on purpose. Which of our tools can change
 * a user's data is a security decision, and a security decision belongs
 * somewhere a reviewer sees it in a diff — not in a value we fetch at runtime
 * from the very servers the gate exists to protect the user from.
 *
 * Currently empty, and that is a measurement rather than an oversight: every
 * tool in the registry today is already classified correctly by the verb
 * heuristic (see the classification snapshot test, which asserts exactly that,
 * tool by tool).
 */
export const ALWAYS_WRITE_TOOLS: ReadonlySet<string> = new Set<string>([]);

/**
 * Whether a tool must be user-approved before it is allowed to run.
 *
 * Deliberately decided from the tool's NAME and this file's escalation list,
 * and from nothing the plugin server told us about itself. We used to consult
 * the MCP `readOnlyHint` annotation and trust it over the heuristic. That made
 * a server's own claim about a tool authoritative over whether that tool is
 * gated — a server could mark a destructive tool read-only and walk straight
 * past the approval prompt. The MCP specification is explicit that annotations
 * are hints and must not be treated as guarantees; we were treating one as a
 * security control.
 *
 * Reading it was worth nothing even before that: measured across the whole
 * enabled registry, the annotation agreed with this heuristic on every single
 * tool and has never once changed an outcome. So this is not a patched bypass,
 * it is a deleted one — the code that could be lied to is gone.
 *
 * The escalation set is a parameter with a default so the raise-only property
 * is testable without reaching into module state.
 */
export function classifyWrite(
  namespacedName: string,
  alwaysWrite: ReadonlySet<string> = ALWAYS_WRITE_TOOLS
): boolean {
  return isWriteTool(namespacedName) || alwaysWrite.has(namespacedName);
}

/**
 * Tool arguments with any `account` key removed.
 *
 * The playground acts as the user's DEFAULT account for a service, always. Our
 * plugins accept an `account` argument so an API caller can pick between
 * several connected mailboxes or calendars, but the playground has no UI for
 * choosing one and no way to show which one a result came from, so letting the
 * model pick would mean it silently guessing on the user's behalf.
 *
 * Whether the playground should support multiple accounts is a product
 * question, and a fair one — but it is not a question that changes its answer
 * because we changed which library runs the agent loop. Anything that swaps
 * machinery under a feature has to leave the feature behaving as it did.
 *
 * Non-objects are returned untouched, and an object without the key is returned
 * as-is rather than needlessly copied.
 */
export function stripAccountArg<T>(args: T): T {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return args;
  if (!("account" in (args as Record<string, unknown>))) return args;
  const { account: _account, ...rest } = args as Record<string, unknown>;
  return rest as T;
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
 * /api/playground/call route consumes: all `content[].text` blocks joined
 * with "\n"; isError only when the result explicitly says so. */
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
 * Executes one namespaced tool for POST /api/playground/call — the connections
 * page's tool tester (slug split, PLUGIN_SERVICE_MAP, getServiceToken,
 * one-shot client — see user-tools.ts). Strips any `account` key from args:
 * that surface always uses the user's default account for the service, and the
 * multi-account limitation is accepted for v1.
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

  const cleanArgs = stripAccountArg(args);

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
