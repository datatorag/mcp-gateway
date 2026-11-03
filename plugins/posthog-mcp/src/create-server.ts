import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PostHogClient } from "./posthog-client.js";
import type { SessionContext } from "./session-context.js";
import { allTools, toolHandlers } from "./tools/index.js";
import { errorMetaField, errorMetaFor } from "./error-meta.js";

const NO_SESSION: SessionContext = { ok: false, refusal: "No PostHog access token reached this call." };

function refusal(text: string, kind: "refused" | "unknown_tool") {
  return { content: [{ type: "text" as const, text }], isError: true, _meta: errorMetaField({ kind }) };
}

/** One session's server (SCRUM-471). A session the gateway handed no usable
 * token, host or project gets one: its calls are refused in words, and no
 * request is made. */
export function createMcpServer(context: SessionContext = NO_SESSION): Server {
  const client = context.ok ? new PostHogClient(context.host, context.project, context.token) : null;
  const server = new Server({ name: "posthog", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const handler = toolHandlers.get(name);
    const def = allTools.find((t) => t.name === name);
    if (!handler || !def) return refusal(`Unknown tool: ${name}`, "unknown_tool");
    if (!client) return refusal(context.ok ? "" : context.refusal, "refused");
    const unknown = Object.keys(args).filter((k) => !(k in def.inputSchema.properties));
    if (unknown.length > 0) return refusal(`Unknown argument: ${unknown.join(", ")}.`, "refused");
    try {
      return await handler(client, name, args as Record<string, unknown>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true, _meta: errorMetaField(errorMetaFor(err)) };
    }
  });

  return server;
}
