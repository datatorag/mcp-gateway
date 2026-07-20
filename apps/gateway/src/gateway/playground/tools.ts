import { eq, and } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import {
  tools,
  mcpServers,
  connectedAccounts,
  serviceConnections,
} from "@datatorag-mcp/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { EngineTool } from "./engine";
import { NAMESPACE_SEPARATOR } from "../plugin-manager";
import { PLUGIN_SERVICE_MAP, getServiceToken } from "../service-token";

/**
 * Extracted from POST /api/playground/call, which now delegates to
 * listUserEngineTools/executeUserTool below. This module is also the tool
 * source/executor for the playground agent loop (engine.ts, wired up by
 * the streaming route).
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
 * All tools from active servers whose required service the user has
 * connected, shaped for the Anthropic API (Task 7's engine.ts consumes
 * these directly as EngineTool[]).
 *
 * Mirrors mcp-server.ts's ListTools connected-service semantics exactly
 * (mcp-server.ts:44-85): the connected set comes from
 * connectedAccounts.connectorType PRIMARILY, falling back to
 * serviceConnections ONLY when the connectedAccounts set is empty. Tools
 * are filtered to mcpServers.status = "active" AND tools.enabled = true.
 * (/api/playground/tools filters neither — this intentionally does NOT
 * copy that route's query shape.)
 */
export async function listUserEngineTools(
  db: Database,
  userId: string
): Promise<EngineTool[]> {
  const [accountRows, registeredTools] = await Promise.all([
    db
      .selectDistinct({ connectorType: connectedAccounts.connectorType })
      .from(connectedAccounts)
      .where(eq(connectedAccounts.userId, userId)),
    db
      .select({
        namespacedName: tools.namespacedName,
        description: tools.description,
        inputSchemaJson: tools.inputSchemaJson,
        serverSlug: mcpServers.slug,
      })
      .from(tools)
      .innerJoin(mcpServers, eq(tools.mcpServerId, mcpServers.id))
      .where(and(eq(mcpServers.status, "active"), eq(tools.enabled, true))),
  ]);

  const connectedServices = new Set<string>();
  for (const row of accountRows) connectedServices.add(row.connectorType);

  // Fallback: check un-migrated service_connections, only when the user has
  // no rows in connected_accounts at all.
  if (connectedServices.size === 0) {
    const legacyRows = await db
      .selectDistinct({ service: serviceConnections.service })
      .from(serviceConnections)
      .where(eq(serviceConnections.userId, userId));
    for (const row of legacyRows) connectedServices.add(row.service);
  }

  const result: EngineTool[] = [];
  for (const t of registeredTools) {
    const requiredService = PLUGIN_SERVICE_MAP[t.serverSlug];

    // Skip tools for services the user hasn't connected.
    if (requiredService && !connectedServices.has(requiredService)) continue;

    // inputSchemaJson is jsonb — drizzle already returns a parsed object.
    // Never JSON.parse it.
    const schema = (t.inputSchemaJson as Record<string, unknown>) ?? {
      type: "object" as const,
      properties: {},
    };

    result.push({
      name: t.namespacedName,
      description: t.description ?? "",
      input_schema: schema,
    });
  }

  return result;
}

/**
 * Executes one namespaced tool exactly like POST /api/playground/call did
 * (slug split, PLUGIN_SERVICE_MAP, getServiceToken, StreamableHTTP client,
 * X-User-Token header). Strips any `account` key from args — playground
 * always uses the user's default account for the service; the
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

  const cleanArgs = { ...args };
  delete cleanArgs.account;

  const userToken = await getServiceToken(db, userId, requiredService);
  if (!userToken) {
    throw new ToolCallError(
      "Service not connected. Please connect from the dashboard first.",
      403
    );
  }

  const serverUrl = mcpServer.githubRepoUrl
    ? `http://localhost:${mcpServer.containerPort}/mcp`
    : `http://dtrmcp-server-${serverSlug}:${mcpServer.containerPort}/mcp`;

  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: { headers: { "X-User-Token": userToken } },
  });
  const client = new Client(
    { name: "datatorag-playground", version: "0.1.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: toolName,
      arguments: cleanArgs,
    });
    return flattenToolResult(
      result as { content?: Array<{ type: string; text?: string }>; isError?: boolean }
    );
  } finally {
    await client.close();
  }
}
