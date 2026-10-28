import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GwsClient, errorMessage } from "./gws-client.js";
import { allTools, toolHandlers } from "./tools/index.js";
import { validateArgs } from "./tools/validate.js";
import { errorMetaField, errorMetaFor } from "./error-meta.js";
import { officeFileRefusal } from "./tools/office-files.js";
import { withAliased } from "./tools/response.js";

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

    // Use the MCP bearer token for this call when the transport carries one
    const client = extra.authInfo?.token
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
      // Validate against the tool's own advertised schema before the call
      // leaves us. The low-level Server does not do this, so without it a
      // missing or misspelled argument reaches Google and comes back as an
      // error describing Google's state rather than the caller's mistake.
      const tool = allTools.find((t) => t.name === name);
      const aliased = tool ? validateArgs(tool, args as Record<string, unknown>) : {};
      return withAliased(await handler(client, name, args as Record<string, unknown>), aliased);
    } catch (err) {
      // SCRUM-455: a Sheets, Docs or Slides request on an Office file gets
      // words that name the conversion instead of Google's bare 400.
      const office = await officeFileRefusal(client, name, err);
      return {
        content: [{ type: "text" as const, text: office ?? `Error: ${errorMessage(err)}` }],
        isError: true,
        _meta: errorMetaField(errorMetaFor(err)),
      };
    }
  });

  return server;
}
