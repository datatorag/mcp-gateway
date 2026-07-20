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
 * user-tools.ts), shaped for the Anthropic API as EngineTool[].
 * (/api/playground/tools filters neither status nor enabled — this
 * intentionally does NOT copy that route's query shape.)
 */
export async function listUserEngineTools(
  db: Database,
  userId: string
): Promise<EngineTool[]> {
  const rows = await listUserToolRows(db, userId);
  return rows.map((r) => ({
    name: r.namespacedName,
    description: r.description,
    input_schema: r.schema,
  }));
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
