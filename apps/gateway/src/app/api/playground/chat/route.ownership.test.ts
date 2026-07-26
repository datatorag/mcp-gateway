import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { Memory } from "@mastra/memory";
import { handleChatStream } from "@mastra/ai-sdk";
import { MockLanguageModelV3 } from "ai/test";

/**
 * Who may approve a suspended write.
 *
 * This is the adversarial half of the write gate. The gate itself answers
 * "may this tool run without asking?"; this file answers the question that
 * only matters once more than one person uses the product — "whose yes was
 * it?" — and it answers it the same way, on the MCP server's own execution
 * log. A 403, an error chunk, a missing stream part: all of those are claims
 * about what the system intended. The array below is what happened.
 *
 * The reason it exists is not hypothetical. The first test in the last
 * describe block runs the framework WITHOUT our gate and watches one user's
 * write execute on another user's approval. That is the behaviour the route
 * has to defeat, and keeping the reproduction here is what stops someone
 * deciding the gate looks redundant.
 */

const USER_A = "user-a";
const USER_B = "user-b";

/* -------------------------------------------------------------------------- */
/* Mocks — everything the route touches that is not the subject under test     */
/* -------------------------------------------------------------------------- */

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({ getSessionUserId: () => getSessionUserId() }));

vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({
    ANTHROPIC_API_KEY: "test-key",
    PLAYGROUND_MODEL: "claude-haiku-4-5",
    PLAYGROUND_MESSAGE_CAP: 100,
  }),
}));

vi.mock("@/lib/db", () => ({ db: {}, getDb: () => ({}) }));

vi.mock("@/gateway/playground/cap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/gateway/playground/cap")>()),
  claimPlaygroundMessage: async () => true,
  refundPlaygroundMessage: async () => {},
}));

vi.mock("@/gateway/track", () => ({
  trackPlaygroundMessage: async () => {},
  trackPlaygroundToolCall: async () => {},
  trackPlaygroundCapHit: async () => {},
  trackPlaygroundConfirm: async () => {},
}));

// The plugin inventory and the token vault are database-backed and are not what
// this file is about. `buildPluginRequestContext` stays REAL — it is what makes
// the per-user identity the resumed write travels with.
vi.mock("@/mastra/mcp/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/mastra/mcp/client")>()),
  listPluginServers: async () => [{ slug: "gws-mcp", containerPort: 1, githubRepoUrl: null }],
  loadUserPluginTokens: async () => ({ "gws-mcp": "test-token" }),
}));

const getMastra = vi.fn();
vi.mock("@/mastra", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/mastra")>()),
  getMastra: () => getMastra(),
}));

import { buildPluginRequestContext, createPluginMCPClient, resolvePluginTools } from "@/mastra/mcp/client";
import { POST } from "./route";

/* -------------------------------------------------------------------------- */
/* A real MCP server, and its execution log                                    */
/* -------------------------------------------------------------------------- */

type Executed = { tool: string; args: Record<string, unknown> };

async function startRealPlugin(toolNames: string[]) {
  /** THE audit signal. Appended inside the server's own tool handler, so a
   * name in here means the call genuinely arrived. */
  const executed: Executed[] = [];

  const http: Server = createServer((req, res) => {
    void (async () => {
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const server = new McpServer({ name: "real-plugin", version: "1.0.0" });
      for (const name of toolNames) {
        server.registerTool(
          name,
          { description: name, inputSchema: { title: z.string().optional() } },
          async (args) => {
            executed.push({ tool: name, args: args as Record<string, unknown> });
            return { content: [{ type: "text" as const, text: `executed ${name}` }] };
          }
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
    executed,
    close: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections?.();
        http.close(() => resolve());
      }),
  };
}

/** Calls one tool once, then talks. Deterministic because the subject under
 * test is the gate, not the model's willingness to try. */
function modelCallingOnce(toolName: string, toolCallId: string) {
  let step = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      step += 1;
      const isFirst = step === 1;
      const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
      if (isFirst) {
        parts.push({
          type: "tool-call",
          toolCallId,
          toolName,
          input: JSON.stringify({ title: "victim-doc" }),
        });
      } else {
        parts.push({ type: "text-start", id: "t0" });
        parts.push({ type: "text-delta", id: "t0", delta: "done" });
        parts.push({ type: "text-end", id: "t0" });
      }
      parts.push({
        type: "finish",
        finishReason: isFirst ? "tool-calls" : "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      } as never;
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
  vi.clearAllMocks();
});

const WRITE_TOOL = "gws-mcp__docs_create";
const TOOL_CALL_ID = "call-victim";

async function setup() {
  const plugin = await startRealPlugin(["docs_create"]);
  cleanups.push(plugin.close);

  const client = createPluginMCPClient(
    [
      {
        slug: "gws-mcp",
        containerPort: plugin.port,
        // Present so the URL resolves to the local test server rather than the
        // in-cluster hostname the production shape uses.
        githubRepoUrl: "https://github.com/datatorag/gws-mcp",
      },
    ],
    { id: `own-${Date.now()}-${Math.random()}` }
  );
  cleanups.push(() => client.disconnect());

  const tools = await resolvePluginTools(
    buildPluginRequestContext({ userId: USER_A, tokensByServer: { "gws-mcp": "t" } }),
    { client, listAllowedToolNames: async () => new Set([WRITE_TOOL]) }
  );

  const storage = new InMemoryStore();
  const agent = new Agent({
    id: "datatorag-playground",
    name: "playground",
    instructions: "test",
    model: () => modelCallingOnce(WRITE_TOOL, TOOL_CALL_ID) as never,
    tools: () => tools as never,
    memory: new Memory({ storage, options: { lastMessages: 5 } }),
  });
  const mastra = new Mastra({
    storage,
    agents: { "datatorag-playground": agent },
    logger: false,
  });
  getMastra.mockReturnValue(mastra);

  return { plugin, mastra, agent, tools, storage };
}

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/playground/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function drain(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

const OPENING_MESSAGES = [{ id: "u1", role: "user", parts: [{ type: "text", text: "go" }] }];

/** An approval response in the shape a client sends one: inline, on the last
 * assistant message, with no separate resume endpoint involved. */
function approvalMessages(approvalId: string) {
  return [
    ...OPENING_MESSAGES,
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: `tool-${WRITE_TOOL}`,
          toolCallId: TOOL_CALL_ID,
          state: "approval-responded",
          input: { title: "victim-doc" },
          approval: { id: approvalId, approved: true },
        },
      ],
    },
  ];
}

/** User A opens a turn that stops at the gated write, and hands back the
 * approval id the client would later echo. */
async function suspendAsUserA(plugin: { executed: Executed[] }): Promise<string> {
  getSessionUserId.mockResolvedValue(USER_A);
  const chunks = await drain(await POST(post({ messages: OPENING_MESSAGES, id: "chat-1" })));
  const approval = chunks.find((c) => c.type === "tool-approval-request");

  expect(approval).toBeDefined();
  // Suspended, and the server has not been asked to do anything.
  expect(plugin.executed).toEqual([]);
  return approval!.approvalId as string;
}

/* -------------------------------------------------------------------------- */

describe("approval ownership", () => {
  it("does not let user B execute a write suspended by user A", async () => {
    const { plugin } = await setup();
    const approvalId = await suspendAsUserA(plugin);

    // B forges the approval that would resolve A's run: A's run id and A's
    // tool-call id, taken verbatim out of the approval id, answered "approved".
    // Everything else is B's — B's session, B's conversation id.
    getSessionUserId.mockResolvedValue(USER_B);
    const response = await POST(post({ messages: approvalMessages(approvalId), id: "chat-b" }));

    expect(response.status).toBe(403);
    // The verdict. Not the status code, not the absence of a stream part —
    // the server was never asked to create the document.
    expect(plugin.executed).toEqual([]);
  });

  it("still lets user A execute their own suspended write", async () => {
    const { plugin } = await setup();
    const approvalId = await suspendAsUserA(plugin);

    // The control. Without this, "B cannot execute" would also be satisfied by
    // a route that had simply stopped working.
    getSessionUserId.mockResolvedValue(USER_A);
    await drain(await POST(post({ messages: approvalMessages(approvalId), id: "chat-1" })));

    expect(plugin.executed).toEqual([{ tool: "docs_create", args: { title: "victim-doc" } }]);
  });

  it("rejects an approval whose run id was never minted here", async () => {
    const { plugin } = await setup();
    await suspendAsUserA(plugin);

    // Not a stolen id — an invented one. The tag cannot be produced without
    // the process key, so no user owns it, including the one asking.
    getSessionUserId.mockResolvedValue(USER_A);
    const response = await POST(
      post({ messages: approvalMessages(`fabricated~tag::${TOOL_CALL_ID}`), id: "chat-1" })
    );

    expect(response.status).toBe(403);
    expect(plugin.executed).toEqual([]);
  });

  it("rejects a batch where only one approval is foreign", async () => {
    const { plugin } = await setup();
    const approvalId = await suspendAsUserA(plugin);

    // All-or-nothing: A's own approval rides along with one that is not
    // theirs, and the whole request is refused rather than partially honoured.
    getSessionUserId.mockResolvedValue(USER_A);
    const messages = approvalMessages(approvalId);
    (messages[1] as { parts: unknown[] }).parts.push({
      type: `tool-${WRITE_TOOL}`,
      toolCallId: "call-other",
      state: "approval-responded",
      input: {},
      approval: { id: `someone-else~tag::call-other`, approved: true },
    });
    const response = await POST(post({ messages, id: "chat-1" }));

    expect(response.status).toBe(403);
    expect(plugin.executed).toEqual([]);
  });
});

describe("why the gate exists — the framework's own behaviour", () => {
  it("resumes another user's suspended run when the route gate is bypassed", async () => {
    const { plugin, mastra } = await setup();
    const approvalId = await suspendAsUserA(plugin);

    // The SAME forgery as the first test, handed straight to the framework
    // with B's identity on it — no route, no gate. Nothing in the runtime
    // compares the run against the caller: the run id is the only credential,
    // so B's "yes" resolves A's write.
    const stream = await handleChatStream({
      mastra,
      agentId: "datatorag-playground",
      version: "v6",
      params: {
        messages: approvalMessages(approvalId),
        memory: { thread: "thread-b", resource: USER_B },
      } as never,
    });
    // Read via a reader rather than `for await`: the stream type is only
    // async-iterable at runtime, not in its declaration.
    const reader = (stream as unknown as ReadableStream<unknown>).getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }

    // If this ever goes green as an empty array, the framework has grown its
    // own ownership check and the route gate has a second opinion backing it
    // up. Until then the gate is the only thing standing here.
    expect(plugin.executed).toEqual([{ tool: "docs_create", args: { title: "victim-doc" } }]);
  });
});
