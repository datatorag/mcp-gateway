import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SlackClient } from "./slack-client.js";
import { allTools, toolHandlers, toolReadOnly } from "./tools/index.js";
import { errorMetaField, errorMetaFor } from "./error-meta.js";

/** A client with no token: every call through it is refused in words. */
export const slackClient = new SlackClient();

export function createMcpServer(client?: SlackClient): Server {
  const activeClient = client ?? slackClient;

  const server = new Server(
    { name: "slack", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args = {} } = request.params;

    const tokenClient = extra.authInfo?.token
      ? activeClient.withToken(extra.authInfo.token)
      : activeClient;

    try {
      const handler = toolHandlers.get(name);
      if (!handler) {
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
          isError: true,
          _meta: errorMetaField({ kind: "unknown_tool" }),
        };
      }
      // Retry is decided by the tool's annotation, never by the Slack method:
      // a write tool's own lookups are not retried either. A tool missing from
      // the map counts as a write.
      const effectiveClient = tokenClient.forTool(toolReadOnly.get(name) === true);
      return await handler(
        effectiveClient,
        name,
        args as Record<string, unknown>
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
        _meta: errorMetaField(errorMetaFor(err)),
      };
    }
  });

  return server;
}
