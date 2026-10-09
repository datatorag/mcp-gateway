import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AtlassianClient } from "./atlassian-client.js";
import { allTools, toolHandlers } from "./tools/index.js";

export const atlassianClient = new AtlassianClient();

export function createMcpServer(client?: AtlassianClient): Server {
  const activeClient = client ?? atlassianClient;

  const server = new Server(
    { name: "atlassian", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args = {} } = request.params;

    const effectiveClient = extra.authInfo?.token
      ? activeClient.withToken(extra.authInfo.token)
      : activeClient;

    try {
      const handler = toolHandlers.get(name);
      if (!handler) {
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
      }
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
      };
    }
  });

  return server;
}
