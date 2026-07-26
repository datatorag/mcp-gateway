import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { MCPClient } from "@mastra/mcp";
import { shortToolName } from "@/app/dashboard/playground-presentation";
import {
  buildPluginRequestContext,
  createPluginMCPClient,
  resolvePluginTools,
  toNamespacedName,
  USER_TOKEN_HEADER,
} from "./client";

/**
 * Two things are worth testing here and they are the two things that would be
 * silently wrong in production:
 *
 * 1. Whose credentials go out on the wire. The claim is that one shared client
 *    can serve many users because identity travels per request. That is only
 *    true if the header actually arrives. So the assertions below are made on
 *    what a REAL MCP SERVER RECEIVED, not on what the client thinks it sent —
 *    a mocked fetch would happily confirm a broken design.
 * 2. That tool names survive the trip. Every tool we serve has underscores in
 *    its own name, and the framework joins server and tool with a single
 *    underscore, so its names cannot be taken apart again. Ours can, and the
 *    UI depends on that.
 */

/* -------------------------------------------------------------------------- */
/* A real MCP server over HTTP, which records what it was sent                 */
/* -------------------------------------------------------------------------- */

type ReceivedCall = {
  tool: string;
  token: string | undefined;
  args: Record<string, unknown>;
};

type FakePlugin = {
  url: string;
  port: number;
  calls: ReceivedCall[];
  close: () => Promise<void>;
};

async function startFakePlugin(toolNames: string[]): Promise<FakePlugin> {
  const calls: ReceivedCall[] = [];

  const http: Server = createServer((req, res) => {
    void (async () => {
      if (req.method !== "POST") {
        // No SSE fallback needed; the client only needs the POST path.
        res.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw.length > 0 ? JSON.parse(raw) : undefined;

      // The token is read off THIS request, and the tool handler below closes
      // over it, so a recorded call can only ever report the header that
      // actually arrived with it.
      const header = req.headers[USER_TOKEN_HEADER.toLowerCase()];
      const token = Array.isArray(header) ? header[0] : header;

      const server = new McpServer({ name: "fake-plugin", version: "1.0.0" });
      for (const toolName of toolNames) {
        server.registerTool(
          toolName,
          {
            description: `fake ${toolName}`,
            inputSchema: { note: z.string().optional() },
          },
          async (args) => {
            calls.push({ tool: toolName, token, args: args as Record<string, unknown> });
            return { content: [{ type: "text" as const, text: `ran ${toolName}` }] };
          }
        );
      }

      // Stateless: a server per request, so nothing is shared between users
      // on the server side either.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    })();
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as AddressInfo).port;

  return {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections?.();
        http.close(() => resolve());
      }),
  };
}

/** Server rows shaped the way the plugin registry stores them. `githubRepoUrl`
 * set means "runs on localhost at containerPort", which is what a fake plugin
 * on an ephemeral port is. */
function serverRow(slug: string, port: number) {
  return {
    slug,
    containerPort: port,
    githubRepoUrl: `https://github.com/datatorag/${slug}`,
  };
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

function track(fn: () => Promise<void>) {
  cleanups.push(fn);
}

/* -------------------------------------------------------------------------- */

describe("plugin tool naming", () => {
  it("keeps a tool name that contains underscores intact and splittable", () => {
    const namespaced = toNamespacedName("gws-mcp", "slides_batch_update");
    expect(namespaced).toBe("gws-mcp__slides_batch_update");

    // The UI trims the same name for display; it must still find the tool.
    expect(shortToolName(namespaced)).toBe("slides_batch_update");
  });
});

describe("per-user tool resolution", () => {
  it("gives two users their own tool sets and sends each user's own token", async () => {
    const gws = await startFakePlugin(["gmail_send", "docs_create"]);
    const atlassian = await startFakePlugin(["jira_create_issue"]);
    track(gws.close);
    track(atlassian.close);

    const client: MCPClient = createPluginMCPClient(
      [serverRow("gws-mcp", gws.port), serverRow("atlassian-mcp", atlassian.port)],
      { id: `test-${Date.now()}-${Math.random()}` }
    );
    track(() => client.disconnect());

    // Alice has both services connected; Bob only has Google. This is the
    // shape the shared connected-service policy produces.
    const allowedByUser: Record<string, Set<string>> = {
      alice: new Set(["gws-mcp__gmail_send", "gws-mcp__docs_create", "atlassian-mcp__jira_create_issue"]),
      bob: new Set(["gws-mcp__gmail_send"]),
    };
    const deps = {
      client,
      listAllowedToolNames: async (userId: string) => allowedByUser[userId] ?? new Set<string>(),
    };

    const aliceContext = buildPluginRequestContext({
      userId: "alice",
      tokensByServer: { "gws-mcp": "alice-google-token", "atlassian-mcp": "alice-atlassian-token" },
    });
    const bobContext = buildPluginRequestContext({
      userId: "bob",
      tokensByServer: { "gws-mcp": "bob-google-token" },
    });

    const aliceTools = await resolvePluginTools(aliceContext, deps);
    const bobTools = await resolvePluginTools(bobContext, deps);

    expect(Object.keys(aliceTools).sort()).toEqual([
      "atlassian-mcp__jira_create_issue",
      "gws-mcp__docs_create",
      "gws-mcp__gmail_send",
    ]);
    expect(Object.keys(bobTools)).toEqual(["gws-mcp__gmail_send"]);

    // Interleaved on purpose: if the token were latched onto the shared
    // connection instead of the request, the second call would carry the
    // first caller's credential.
    await aliceTools["gws-mcp__gmail_send"]!.execute!({ note: "a" }, { requestContext: aliceContext });
    await bobTools["gws-mcp__gmail_send"]!.execute!({ note: "b" }, { requestContext: bobContext });
    await aliceTools["atlassian-mcp__jira_create_issue"]!.execute!(
      { note: "c" },
      { requestContext: aliceContext }
    );

    expect(gws.calls).toEqual([
      { tool: "gmail_send", token: "alice-google-token", args: { note: "a" } },
      { tool: "gmail_send", token: "bob-google-token", args: { note: "b" } },
    ]);
    // Alice's Atlassian call carries her ATLASSIAN token, not her Google one:
    // per-plugin keys, because these credentials are not interchangeable.
    expect(atlassian.calls).toEqual([
      { tool: "jira_create_issue", token: "alice-atlassian-token", args: { note: "c" } },
    ]);
  });

  it("resolves no tools at all when the request cannot say who it is", async () => {
    const gws = await startFakePlugin(["gmail_send"]);
    track(gws.close);

    const client = createPluginMCPClient([serverRow("gws-mcp", gws.port)], {
      id: `test-anon-${Date.now()}-${Math.random()}`,
    });
    track(() => client.disconnect());

    const tools = await resolvePluginTools(undefined, {
      client,
      listAllowedToolNames: async () => new Set(["gws-mcp__gmail_send"]),
    });
    expect(tools).toEqual({});
    expect(gws.calls).toEqual([]);
  });
});
