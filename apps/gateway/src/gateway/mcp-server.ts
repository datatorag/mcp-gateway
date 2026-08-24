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
import { PLUGIN_SERVICE_MAP, resolveServiceToken } from "./service-token";
import {
  listUserToolRows,
  buildPluginServerUrl,
  callPluginToolOnce,
} from "./user-tools";
import {
  accountsGrantingScope,
  listConnectedAccounts,
} from "./connected-accounts";
import { trackToolCall } from "./track";
import { trackMcpToolsListed } from "./mcp-analytics";
import { checkCallAllowance } from "./billing/enforce";
import {
  checkScopeForTool,
  missingScopeMessage,
  rewriteScopeError,
  MISSING_SCOPE_ERROR_MARKER,
} from "./scope-grant";

const ACCOUNT_PARAM_SCHEMA = {
  type: "string",
  description:
    "Optional email address of the connected account to use (e.g. 'user@gmail.com'). If omitted, the default account is used.",
} as const;

type BuiltinResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/**
 * Gateway built-in tools — served by this process, no plugin behind them.
 *
 * This registry IS the metering boundary for built-ins (SCRUM-66 / f-050).
 * ListTools appends exactly these definitions, and CallTool dispatches every
 * name found here through one shared path that emits a tool_call event with
 * `builtin: true` — which classifies to metered:false, so the event reaches
 * analytics and neither billing sink runs (see usage/classify.ts). Before the
 * registry, the two built-ins were handled inline and emitted nothing; that
 * silence was undocumented, so a third built-in would have inherited it by
 * default. An entry added here inherits emission and non-metering by
 * construction, and mcp-server.builtins.test.ts iterates the registry, so a
 * new entry is covered without anyone remembering to cover it.
 */
export const BUILT_IN_TOOLS: {
  definition: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  handler: (
    args: Record<string, unknown> | undefined,
    ctx: { db: Database; userId: string }
  ) => Promise<BuiltinResult>;
}[] = [
  {
    definition: {
      name: "list_connected_accounts",
      description:
        "List the user's connected accounts grouped by service. Use this to discover which accounts are available before passing the 'account' parameter to other tools.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    handler: async (_args, { db, userId }) => {
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
        content: [{ type: "text" as const, text: JSON.stringify(grouped) }],
      };
    },
  },
  {
    definition: {
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
    },
    handler: async (args) => ({
      content: [
        {
          type: "text" as const,
          text: `[datatorag-mcp echo] ${args?.message ?? "(no message)"}`,
        },
      ],
    }),
  },
];

/**
 * Creates a new MCP Server instance for a client session.
 * Dynamically serves tools from the registry and routes calls to backend
 * processes (local plugins) or Docker containers.
 */
export function createMcpServer(
  userId: string,
  db: Database,
  pool: ConnectionPool,
  opts?: {
    /** Absolute origin for links in user-facing tool errors (SCRUM-136).
     * Optional so tests and legacy call sites fall back to a relative path. */
    baseUrl?: string;
  }
): Server {
  const connectionsUrl = `${opts?.baseUrl ?? ""}/dashboard/connections`;
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

    for (const t of BUILT_IN_TOOLS) toolList.push(t.definition);

    // A user who lists tools and then stops is a very different activation
    // signal from one whose client never connected. Count only — never the
    // tool list itself.
    void trackMcpToolsListed(db, userId, toolList.length);

    return { tools: toolList };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;

    const builtin = BUILT_IN_TOOLS.find((t) => t.definition.name === name);
    if (builtin) {
      const startTime = Date.now();
      try {
        const result = await builtin.handler(
          rawArgs as Record<string, unknown> | undefined,
          { db, userId }
        );
        // Same fire-and-forget shape as the plugin path below. f-050 was
        // exactly this call missing: built-ins answered on the wire and were
        // absent from analytics. `builtin: true` classifies to metered:false,
        // so the event is emitted and the billing sinks never run.
        void trackToolCall(db, {
          userId,
          toolName: name,
          connectorType: null,
          accountEmail: undefined,
          latencyMs: Date.now() - startTime,
          responseSizeBytes: JSON.stringify(result).length,
          errorMessage: null,
          outcome: { thrown: false, isError: false, source: "mcp", toolName: name, builtin: true },
        });
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`[route-error] builtin ${name}:`, message);
        void trackToolCall(db, {
          userId,
          toolName: name,
          connectorType: null,
          accountEmail: undefined,
          latencyMs: Date.now() - startTime,
          responseSizeBytes: null,
          errorMessage: message,
          outcome: { thrown: true, errorMessage: message, source: "mcp", toolName: name, builtin: true },
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Error calling ${name}: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // Allowance gate, BEFORE any dispatch work. Built-ins are above this line
    // on purpose — they are unmetered connectivity probes and must keep
    // answering for a capped user. A refusal here is a product state, not an
    // error: the call never dispatches, is never metered, and the message
    // tells the user what resets and what upgrades.
    const allowance = await checkCallAllowance(db, userId);
    if (!allowance.allowed) {
      return {
        content: [{ type: "text" as const, text: allowance.message }],
        isError: true,
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
      const requestedAccount = args.account as string | undefined;
      delete args.account;

      const resolved = await resolveServiceToken(
        db,
        userId,
        requiredService,
        requestedAccount
      );
      userToken = resolved?.token ?? null;
      // The account STAMPED on the usage event is the one the resolution
      // actually chose, not the caller's argument:
      // with the argument omitted the gateway still picks the default
      // account, and discarding that identity left every argument-less call
      // unattributable — the exact field metered billing would bill on. When
      // an argument was given, resolution only succeeds on that same account,
      // so the two agree; the legacy path has no account and reports the
      // request as made.
      accountEmail = resolved?.accountEmail ?? requestedAccount;
      if (!userToken) {
        const msg = requestedAccount
          ? `No connected account found for ${requestedAccount}. Please connect it from the dashboard at /dashboard/connections.`
          : `${requiredService} is not connected. Please connect it from the dashboard at /dashboard/connections before using ${serverSlug} tools.`;
        return {
          content: [{ type: "text" as const, text: msg }],
          isError: true,
        };
      }

      // SCRUM-136/107: refuse BEFORE dispatch when the scope this tool needs
      // is known-missing from the account the call would run as. The user
      // reads which access they did not grant and where to grant it, never a
      // raw Google 403. Fail-open by construction: unmapped tools and legacy
      // rows fall through to the call (the post-call rewrite is their net).
      const scopeCheck = checkScopeForTool({
        toolName,
        service: requiredService,
        granted: resolved?.scopes ?? null,
        surface: "mcp",
        connectionsUrl,
      });
      if (!scopeCheck.ok) {
        // SCRUM-145: the refusal names the account it judged and, when
        // another connected account holds the scope, names that too — "Gmail
        // not granted" alone is actively misleading to a user who just
        // granted Gmail on a different account. Enrichment only: a failed
        // lookup falls back to the plain refusal, never to a crash.
        let refusalText = scopeCheck.message;
        try {
          const alternates = await accountsGrantingScope(
            db,
            userId,
            requiredService,
            scopeCheck.missing.scope,
            accountEmail ?? null
          );
          refusalText = missingScopeMessage({
            displayName: scopeCheck.missing.displayName,
            surface: "mcp",
            connectionsUrl,
            accountEmail,
            alternates,
          });
        } catch {
          // scopeCheck.message stands.
        }
        // Metered with a distinct marker: a refusal the instrumentation
        // cannot see would be a one-sided measurement of exactly the failure
        // this exists to fix.
        void trackToolCall(db, {
          userId,
          toolName: name,
          connectorType: requiredService,
          accountEmail,
          latencyMs: 0,
          responseSizeBytes: null,
          errorMessage: `${MISSING_SCOPE_ERROR_MARKER} ${scopeCheck.missing.displayName} not granted`,
          outcome: {
            thrown: false,
            isError: true,
            errorMessage: `${MISSING_SCOPE_ERROR_MARKER} ${scopeCheck.missing.displayName} not granted`,
            source: "mcp",
            toolName: name,
          },
        });
        return {
          content: [{ type: "text" as const, text: refusalText }],
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

      // SCRUM-136: the at-failure net behind the pre-call check. A Google
      // insufficient-scope 403 that slipped through (unmapped tool, stale
      // row) reaches the user in words with a reconnect path; the RAW error
      // is what the usage row and the server log keep — the truth is metered,
      // the words are served.
      const scopeRewrite = rewriteScopeError({
        toolName,
        service: requiredService ?? null,
        errorText: errorMessage,
        surface: "mcp",
        connectionsUrl,
      });
      if (scopeRewrite) {
        console.warn(`[scope-error] ${name}: ${errorMessage}`);
        result = {
          ...(result as Record<string, unknown>),
          content: [{ type: "text" as const, text: scopeRewrite }],
        };
      }
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
