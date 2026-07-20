import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { eq, and } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { mcpServers, pluginConnections } from "@datatorag-mcp/db";
import type { ConnectionPool } from "./pool";
import { NAMESPACE_SEPARATOR } from "./plugin-manager";
import { PLUGIN_SERVICE_MAP, getServiceToken } from "./service-token";
import {
  listUserToolRows,
  buildPluginServerUrl,
  callPluginToolOnce,
} from "./user-tools";
import { listConnectedAccounts } from "./connected-accounts";
import { trackToolCall } from "./track";

const ACCOUNT_PARAM_SCHEMA = {
  type: "string",
  description:
    "Optional email address of the connected account to use (e.g. 'user@gmail.com'). If omitted, the default account is used.",
} as const;

/**
 * Creates a new MCP Server instance for a client session.
 * Dynamically serves tools from the registry and routes calls to backend
 * processes (local plugins) or Docker containers.
 */
export function createMcpServer(
  userId: string,
  db: Database,
  pool: ConnectionPool
): Server {
  const server = new Server(
    { name: "datatorag-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Shared connected-service policy — see user-tools.ts. This handler only
    // shapes the rows for MCP: inject the `account` param on service-backed
    // tools and append the built-in tools.
    const rows = await listUserToolRows(db, userId);

    const toolList: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }[] = [];

    for (const t of rows) {
      if (t.requiredService) {
        const properties = {
          ...(t.schema.properties as Record<string, unknown>),
          account: ACCOUNT_PARAM_SCHEMA,
        };
        toolList.push({
          name: t.namespacedName,
          description: t.description,
          inputSchema: { ...t.schema, properties },
        });
      } else {
        toolList.push({
          name: t.namespacedName,
          description: t.description,
          inputSchema: t.schema,
        });
      }
    }

    toolList.push(
      {
        name: "list_connected_accounts",
        description:
          "List the user's connected accounts grouped by service. Use this to discover which accounts are available before passing the 'account' parameter to other tools.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "echo",
        description:
          "Echo back the input message. A built-in test tool to verify the gateway is working.",
        inputSchema: {
          type: "object" as const,
          properties: {
            message: {
              type: "string",
              description: "The message to echo back",
            },
          },
          required: ["message"],
        },
      }
    );

    return { tools: toolList };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;

    if (name === "echo") {
      const message = (rawArgs as Record<string, unknown>)?.message;
      return {
        content: [
          {
            type: "text" as const,
            text: `[datatorag-mcp echo] ${message ?? "(no message)"}`,
          },
        ],
      };
    }

    if (name === "list_connected_accounts") {
      const rows = await listConnectedAccounts(db, userId);

      if (rows.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No connected accounts. The user can connect accounts at /dashboard/connections.",
            },
          ],
        };
      }

      const grouped: Record<
        string,
        { email: string; label: string | null; is_default: boolean; connected_at: string }[]
      > = {};
      for (const row of rows) {
        const key = row.connectorType;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({
          email: row.accountEmail,
          label: row.label,
          is_default: row.isDefault,
          connected_at: row.connectedAt.toISOString().split("T")[0],
        });
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(grouped) },
        ],
      };
    }

    const args = rawArgs as Record<string, unknown>;

    const separatorIndex = name.indexOf(NAMESPACE_SEPARATOR);
    if (separatorIndex === -1) {
      return {
        content: [
          { type: "text" as const, text: `Unknown tool: ${name}` },
        ],
        isError: true,
      };
    }

    const serverSlug = name.slice(0, separatorIndex);
    const toolName = name.slice(separatorIndex + NAMESPACE_SEPARATOR.length);

    const [mcpServer] = await db
      .select({
        id: mcpServers.id,
        slug: mcpServers.slug,
        containerPort: mcpServers.containerPort,
        githubRepoUrl: mcpServers.githubRepoUrl,
      })
      .from(mcpServers)
      .where(eq(mcpServers.slug, serverSlug))
      .limit(1);

    if (!mcpServer) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Unknown server: ${serverSlug}`,
          },
        ],
        isError: true,
      };
    }

    const serverUrl = buildPluginServerUrl(mcpServer);

    // Look up per-user token: first check service connections, then legacy plugin connections
    let userToken: string | null = null;

    const requiredService = PLUGIN_SERVICE_MAP[mcpServer.slug];
    let accountEmail: string | undefined;
    if (requiredService) {
      accountEmail = args.account as string | undefined;
      delete args.account;

      userToken = await getServiceToken(
        db,
        userId,
        requiredService,
        accountEmail
      );
      if (!userToken) {
        const msg = accountEmail
          ? `No connected account found for ${accountEmail}. Please connect it from the dashboard at /dashboard/connections.`
          : `${requiredService} is not connected. Please connect it from the dashboard at /dashboard/connections before using ${serverSlug} tools.`;
        return {
          content: [{ type: "text" as const, text: msg }],
          isError: true,
        };
      }
    } else if (mcpServer.githubRepoUrl) {
      // Legacy: check pluginConnections table
      const [conn] = await db
        .select({ accessToken: pluginConnections.accessToken })
        .from(pluginConnections)
        .where(
          and(
            eq(pluginConnections.userId, userId),
            eq(pluginConnections.mcpServerId, mcpServer.id)
          )
        )
        .limit(1);
      if (conn) {
        userToken = conn.accessToken;
      }
    }

    console.log(
      `[route] ${name} → ${serverUrl} (tool: ${toolName}, token: ${userToken ? "yes" : "no"})`
    );

    const startTime = Date.now();

    try {
      let result;
      if (userToken) {
        result = await callPluginToolOnce({
          serverUrl,
          userToken,
          toolName,
          args: args as Record<string, unknown>,
          clientName: "datatorag-mcp",
        });
      } else {
        const pooledClient = await pool.acquire(mcpServer.id, serverUrl);
        try {
          result = await pooledClient.callTool({
            name: toolName,
            arguments: args as Record<string, unknown>,
          });
        } finally {
          pool.release(mcpServer.id, pooledClient);
        }
      }

      const responseText = JSON.stringify(result);
      const isError = !!(result as { isError?: boolean }).isError;
      const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
      const errorMessage = isError
        ? content
            ?.filter((c) => c.type === "text")
            .map((c) => c.text)
            .join(" ") ?? null
        : null;
      // Fire-and-forget: metering must never slow the tool response. Latency
      // and sizes are already captured into the props here; trackToolCall is
      // self-contained (never throws) so the floating promise is safe.
      void trackToolCall(db, {
        userId,
        toolName: name,
        connectorType: requiredService ?? null,
        accountEmail,
        latencyMs: Date.now() - startTime,
        responseSizeBytes: responseText.length,
        errorMessage,
        outcome: { thrown: false, isError, errorMessage, source: "mcp", toolName: name },
      });

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      console.error(
        `[route-error] ${serverSlug}/${toolName} @ ${serverUrl}:`,
        message
      );

      // Fire-and-forget (see the success path above): metering off the response
      // path, self-contained and never throwing.
      void trackToolCall(db, {
        userId,
        toolName: name,
        connectorType: requiredService ?? null,
        accountEmail,
        latencyMs: Date.now() - startTime,
        responseSizeBytes: null,
        errorMessage: message,
        outcome: { thrown: true, errorMessage: message, source: "mcp", toolName: name },
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Error calling ${serverSlug}/${toolName}: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
