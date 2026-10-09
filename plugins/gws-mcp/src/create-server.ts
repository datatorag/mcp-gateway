import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GwsClient, errorMessage } from "./gws-client.js";
import { allTools, toolHandlers } from "./tools/index.js";
import { validateArgs } from "./tools/validate.js";

export const gwsClient = new GwsClient();

export function createMcpServer(client?: GwsClient): Server {
  const activeClient = client ?? gwsClient;
  const server = new Server(
    { name: "google-workspace", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args = {} } = request.params;

    // Use the MCP bearer token for gws CLI calls when available
    const client = extra.authInfo?.token
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
      // Validate against the tool's own advertised schema before the call
      // leaves us. The low-level Server does not do this, so without it a
      // missing or misspelled argument reaches Google and comes back as an
      // error describing Google's state rather than the caller's mistake.
      const tool = allTools.find((t) => t.name === name);
      if (tool) validateArgs(tool, args as Record<string, unknown>);
      return await handler(client, name, args as Record<string, unknown>);
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }],
        isError: true,
      };
    }
  });

  return server;
}
