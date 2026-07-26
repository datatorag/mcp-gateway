import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { handleChatStream } from "@mastra/ai-sdk";

vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({ ANTHROPIC_API_KEY: "test-key", PLAYGROUND_MODEL: "claude-haiku-4-5" }),
}));

import { buildPluginRequestContext, createPluginMCPClient, resolvePluginTools } from "./mcp/client";
import { createDatatoragAgent, DATATORAG_AGENT_ID, SYSTEM_PROMPT } from "./agents/datatorag";

/**
 * Prompt caching, tested on the only artefact that can settle it: the bytes
 * that leave the process.
 *
 * A cache breakpoint is a field on the provider's request body. Types cannot
 * show whether it survived the trip from our config through the agent runtime
 * and the provider adapter, and neither can documentation — every layer in
 * between is free to drop an option it does not recognise, silently and
 * without failing. So this file stubs the transport, keeps the real body, and
 * asserts on it.
 *
 * What is at stake if it regresses is not subtle. The system prompt and the
 * tool schemas — around 11k tokens once a user has Workspace connected — are
 * invariant across every step of a turn and are re-sent on each one. Without
 * the two breakpoints below they are re-billed at full rate every step, and
 * nothing anywhere reports that it happened.
 */

type CapturedBody = {
  system?: Array<{ text?: string; cache_control?: { type?: string } }>;
  tools?: Array<{ name?: string; cache_control?: { type?: string } }>;
  cache_control?: unknown;
};

/** An Anthropic streaming response that says as little as possible while still
 * parsing — the subject under test is the REQUEST. */
function anthropicStreamResponse(): Response {
  const event = (obj: unknown) => `event: ${(obj as { type: string }).type}\ndata: ${JSON.stringify(obj)}\n\n`;
  const body = [
    event({
      type: "message_start",
      message: {
        id: "m1", type: "message", role: "assistant", model: "test", content: [],
        stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }),
    event({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }),
    event({ type: "content_block_stop", index: 0 }),
    event({
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    }),
    event({ type: "message_stop" }),
  ].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A real MCP server, so the tools under test are the ones the client actually
 * builds rather than hand-made stand-ins. Whether a framework-built tool object
 * even accepts our marker is half the question. */
async function startPlugin(toolNames: string[]) {
  const http: Server = createServer((req, res) => {
    void (async () => {
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const server = new McpServer({ name: "cache-plugin", version: "1.0.0" });
      for (const name of toolNames) {
        server.registerTool(
          name,
          { description: name, inputSchema: { title: z.string().optional() } },
          async () => ({ content: [{ type: "text" as const, text: "ok" }] })
        );
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, raw.length > 0 ? JSON.parse(raw) : undefined);
    })();
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  return {
    port: (http.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections?.();
        http.close(() => resolve());
      }),
  };
}

/** Reads a stream to completion. Via a reader rather than `for await`, because
 * the stream type is only async-iterable at runtime, not in its declaration. */
async function drainStream(stream: unknown): Promise<void> {
  const reader = (stream as ReadableStream<unknown>).getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
}

const cleanups: Array<() => Promise<void>> = [];
const captured: CapturedBody[] = [];

beforeEach(() => {
  captured.length = 0;
  const realFetch = globalThis.fetch;
  // Only the provider call is intercepted. The MCP traffic below runs over the
  // same global `fetch` and has to keep working, so anything that is not
  // Anthropic is passed straight through.
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!String(url).includes("api.anthropic.com")) return realFetch(url, init);
    captured.push(JSON.parse(String(init?.body ?? "{}")) as CapturedBody);
    return anthropicStreamResponse();
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** One real turn through the real agent, returning the body it sent. */
async function captureTurn(toolNames: string[]): Promise<CapturedBody> {
  const plugin = await startPlugin(toolNames);
  cleanups.push(plugin.close);

  const client = createPluginMCPClient(
    [
      {
        slug: "gws-mcp",
        containerPort: plugin.port,
        githubRepoUrl: "https://github.com/datatorag/gws-mcp",
      },
    ],
    { id: `cache-${Date.now()}-${Math.random()}` }
  );
  cleanups.push(() => client.disconnect());

  const requestContext = buildPluginRequestContext({
    userId: "cache-user",
    tokensByServer: { "gws-mcp": "cache-token" },
  });
  const tools = await resolvePluginTools(requestContext, {
    client,
    listAllowedToolNames: async () => new Set(toolNames.map((n) => `gws-mcp__${n}`)),
  });

  const storage = new InMemoryStore();
  const mastra = new Mastra({
    storage,
    agents: { [DATATORAG_AGENT_ID]: createDatatoragAgent(storage, async () => tools) },
    logger: false,
  });

  const stream = await handleChatStream({
    mastra,
    agentId: DATATORAG_AGENT_ID,
    version: "v6",
    params: {
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      requestContext,
      memory: { thread: "cache-thread", resource: "cache-user" },
    } as never,
  });
  await drainStream(stream);

  expect(captured).toHaveLength(1);
  if (process.env.SHOW_BODY) {
    console.log(
      JSON.stringify(
        {
          system: captured[0]!.system,
          tools: (captured[0]!.tools ?? []).map((t) => ({
            name: t.name, cache_control: t.cache_control,
          })),
          top_level_cache_control: captured[0]!.cache_control,
        },
        null,
        2
      )
    );
  }
  return captured[0]!;
}

describe("playground prompt caching, on the wire", () => {
  it("marks the system prompt as a cache breakpoint", async () => {
    const body = await captureTurn(["docs_get", "docs_create"]);

    // The prompt travelled as a system block AND carries the marker. Both
    // halves matter: the marker has nowhere to live if the prompt is sent as a
    // bare string, which is the shape it is easiest to regress to.
    expect(body.system?.[0]?.text).toBe(SYSTEM_PROMPT);
    expect(body.system?.[0]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("marks the last tool schema, and only the last", async () => {
    const body = await captureTurn(["docs_get", "docs_create", "docs_delete"]);
    const tools = body.tools ?? [];

    expect(tools).toHaveLength(3);
    // A cache prefix is cumulative, so the marker on the FINAL schema is what
    // turns the whole tool block into a cache read. Marking an earlier one
    // would cover only part of it, and marking several wastes breakpoints —
    // there are four per request.
    expect(tools.slice(0, -1).map((t) => t.cache_control)).toEqual([undefined, undefined]);
    expect(tools[tools.length - 1]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("puts no stray breakpoint at the top level of the request", async () => {
    const body = await captureTurn(["docs_get"]);

    // The failure this pins down was real once: a call-level `cacheControl`
    // serializes to a top-level `cache_control`, which Anthropic does not read
    // as a breakpoint. It looks configured and caches nothing.
    expect(body.cache_control).toBeUndefined();
  });
});
