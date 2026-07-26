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
import { PLUGIN_SERVICE_MAP } from "./service-token";

/**
 * The single definition of "which registry tools can this user see" plus the
 * plugin-invocation mechanics, shared by the MCP front door (mcp-server.ts),
 * the agent's MCP client (src/mastra/mcp/client.ts) and the direct tool call
 * behind /api/playground/call (playground/tools.ts). Each consumer shapes the
 * rows for its own protocol on top; the policy lives only here.
 */

export type UserToolRow = {
  namespacedName: string;
  description: string;
  /** Parsed JSON schema (inputSchemaJson is jsonb — drizzle already returns
   * an object; never JSON.parse it). Defaults to an empty object schema. */
  schema: Record<string, unknown>;
  /** Service the tool needs (from PLUGIN_SERVICE_MAP); undefined for tools
   * whose server has no service mapping — those are visible to everyone. */
  requiredService: string | undefined;
  /** MCP readOnlyHint annotation as the plugin server declared it: true =
   * read-only, false = mutating, null = unannotated.
   *
   * Recorded, not trusted. It used to decide the playground's write-approval
   * gate, which meant a server could exempt its own destructive tools from
   * being approved by annotating them read-only. The gate now classifies from
   * the tool name alone (see playground/tools.ts `classifyWrite`) and no code
   * path reads this field to make a security decision. It is kept because it
   * is a true record of what the server said, which is worth having when
   * auditing a plugin. */
  readOnlyHint: boolean | null;
};

/**
 * All tools from active servers whose required service the user has
 * connected. The connected set comes from connectedAccounts.connectorType
 * PRIMARILY, falling back to un-migrated serviceConnections ONLY when the
 * connectedAccounts set is empty. Tools are filtered to
 * mcpServers.status = "active" AND tools.enabled = true.
 */
export async function listUserToolRows(
  db: Database,
  userId: string
): Promise<UserToolRow[]> {
  // Run user-specific and global queries in parallel
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
        readOnlyHint: tools.readOnlyHint,
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

  const result: UserToolRow[] = [];
  for (const t of registeredTools) {
    const requiredService = PLUGIN_SERVICE_MAP[t.serverSlug];

    // Skip tools for services the user hasn't connected.
    if (requiredService && !connectedServices.has(requiredService)) continue;

    result.push({
      namespacedName: t.namespacedName,
      description: t.description ?? "",
      schema: (t.inputSchemaJson as Record<string, unknown>) ?? {
        type: "object" as const,
        properties: {},
      },
      requiredService,
      readOnlyHint: t.readOnlyHint,
    });
  }

  return result;
}

/** The registry row fields that say where a plugin server is reachable. Stated
 * once here, next to the function that turns it into a URL, so a consumer that
 * lists servers and a consumer that addresses one cannot drift apart. */
export type PluginServerRow = {
  slug: string;
  containerPort: number | null;
  githubRepoUrl: string | null;
};

/** URL of a plugin's MCP endpoint: locally-run plugins (githubRepoUrl set)
 * listen on localhost; containerized ones on their compose-network hostname,
 * unless DOCKER_HOST_OVERRIDE redirects (dev-against-remote-plugins). */
export function buildPluginServerUrl(server: PluginServerRow): string {
  if (server.githubRepoUrl) {
    return `http://localhost:${server.containerPort}/mcp`;
  }
  const dockerHostOverride = process.env.DOCKER_HOST_OVERRIDE;
  if (dockerHostOverride) {
    return `http://${dockerHostOverride}/mcp`;
  }
  return `http://dtrmcp-server-${server.slug}:${server.containerPort}/mcp`;
}

/** One-shot per-user-token plugin call: fresh StreamableHTTP client with the
 * X-User-Token header, connect → callTool → close-in-finally. (Tokenless
 * calls use the shared ConnectionPool instead — see pool.ts.) */
export async function callPluginToolOnce(opts: {
  serverUrl: string;
  userToken: string;
  toolName: string;
  args: Record<string, unknown>;
  clientName: string;
}): Promise<Awaited<ReturnType<Client["callTool"]>>> {
  const transport = new StreamableHTTPClientTransport(new URL(opts.serverUrl), {
    requestInit: { headers: { "X-User-Token": opts.userToken } },
  });
  const client = new Client(
    { name: opts.clientName, version: "0.1.0" },
    { capabilities: {} }
  );
  try {
    await client.connect(transport);
    return await client.callTool({
      name: opts.toolName,
      arguments: opts.args,
    });
  } finally {
    await client.close();
  }
}
