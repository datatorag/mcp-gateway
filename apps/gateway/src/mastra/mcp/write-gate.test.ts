import { afterEach, describe, expect, it } from "vitest";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { Memory } from "@mastra/memory";
import { MockLanguageModelV3 } from "ai/test";
import { buildPluginRequestContext, wrapMcpTools } from "./client";

/**
 * The write gate, tested the only way a write gate can honestly be tested:
 * judged by the record of what actually crossed the tool boundary.
 *
 * Every softer signal is theatre here. A stream chunk saying "approval
 * requested" is a claim about intent; a UI card is a claim about a claim. The
 * question this file answers is the only one that matters to a user whose
 * mailbox is on the other end — did the call cross? Under SCRUM-188 the
 * boundary is the in-process MCP client's callTool: beyond it is the MCP
 * server's own dispatch, which has its own suites. So the recorder below sits
 * exactly there, and every assertion is made on that array. If a tool name is
 * in it, the call genuinely left the agent runtime, and no amount of
 * correct-looking machinery upstream can put it there.
 */

function modelCallingOnce(toolName: string, input: Record<string, unknown>) {
  let step = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      step += 1;
      const isFirst = step === 1;
      const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
      if (isFirst) {
        parts.push({
          type: "tool-call",
          toolCallId: `call-${toolName}`,
          toolName,
          input: JSON.stringify(input),
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

const RESOURCE_ID = "gate-user";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** The agent's tool set as SCRUM-188 builds it: MCP tool definitions wrapped
 * with the gateway-side approval policy, execute forwarding to the recorded
 * boundary. Definitions mirror what the MCP server lists, namespaced names
 * and all. `docs_delete` is the tool that lies: a mutating tool whose MCP
 * annotation claims read-only — the exact claim the gate exists to ignore
 * (annotations never reach the classifier, which judges names only). */
function buildGateway() {
  const executed: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const defs = [
    { name: "gws-mcp__docs_get", description: "read", inputSchema: { type: "object", properties: { title: { type: "string" }, account: { type: "string" } } } },
    { name: "gws-mcp__docs_create", description: "write", inputSchema: { type: "object", properties: { title: { type: "string" } } } },
    { name: "gws-mcp__docs_delete", description: "liar", inputSchema: { type: "object", properties: { title: { type: "string" } } } },
  ];
  const tools = wrapMcpTools(defs, async (name, args) => {
    executed.push({ tool: name, args });
    return { content: [{ type: "text", text: "ok" }] };
  });

  const requestContext = buildPluginRequestContext({ userId: RESOURCE_ID });
  const storage = new InMemoryStore();

  async function turn(toolName: string, input: Record<string, unknown>, threadId: string) {
    const agent = new Agent({
      id: "gate-agent",
      name: "gate",
      instructions: "gate",
      model: () => modelCallingOnce(toolName, input) as never,
      tools: () => tools,
      memory: new Memory({ storage, options: { lastMessages: 5 } }),
    });
    const mastra = new Mastra({
      storage,
      agents: { "gate-agent": agent },
      logger: false,
    });
    const bound = mastra.getAgent("gate-agent");
    const stream = await bound.stream("go", {
      requestContext,
      memory: { thread: threadId, resource: RESOURCE_ID },
    });
    for await (const _part of stream.fullStream) void _part;
    return bound;
  }

  return { executed, tools, requestContext, turn };
}

describe("the playground write gate (SCRUM-188: at the wrapped MCP boundary)", () => {
  it("marks writes for approval and leaves reads alone", () => {
    const { tools } = buildGateway();
    const requireApproval = Object.fromEntries(
      Object.entries(tools).map(([name, tool]) => [
        name,
        (tool as { requireApproval?: unknown }).requireApproval,
      ])
    );
    expect(requireApproval).toEqual({
      "gws-mcp__docs_get": false,
      "gws-mcp__docs_create": true,
      // Annotated read-only by its definition. Gated anyway: the classifier
      // judges names, never annotations a server could lie in.
      "gws-mcp__docs_delete": true,
    });
  });

  it("lets a read cross, with the account argument travelling THROUGH (SCRUM-188)", async () => {
    const { executed, turn } = buildGateway();

    await turn(
      "gws-mcp__docs_get",
      { title: "hello", account: "someone@example.com" },
      "t-read"
    );

    // DELIBERATE INVERSION of the old expectation: the agent used to strip
    // `account` because it bound one account's token per session. As an MCP
    // client it forwards the argument and the SERVER resolves it — which is
    // what makes multi-account addressing work from the agent at all. The
    // server only ever resolves accounts belonging to the session user, so
    // forwarding is not a confused-deputy path.
    expect(executed).toEqual([
      {
        tool: "gws-mcp__docs_get",
        args: { title: "hello", account: "someone@example.com" },
      },
    ]);
  });

  it("suspends a write with nothing at all having crossed the boundary", async () => {
    const { executed, turn } = buildGateway();

    const agent = await turn("gws-mcp__docs_create", { title: "draft" }, "t-write");

    expect(executed).toEqual([]);
    const { runs } = await agent.listSuspendedRuns({
      threadId: "t-write",
      resourceId: RESOURCE_ID,
    });
    expect(runs).toHaveLength(1);
  });

  it("gates a mutating tool that annotates itself read-only", async () => {
    const { executed, turn } = buildGateway();

    const agent = await turn("gws-mcp__docs_delete", { title: "doomed" }, "t-liar");

    expect(executed).toEqual([]);
    const { runs } = await agent.listSuspendedRuns({
      threadId: "t-liar",
      resourceId: RESOURCE_ID,
    });
    expect(runs).toHaveLength(1);
  });

  it("runs the tool once, and only once, after approval", async () => {
    const { executed, requestContext, turn } = buildGateway();

    const agent = await turn("gws-mcp__docs_create", { title: "draft" }, "t-approve");
    const { runs } = await agent.listSuspendedRuns({
      threadId: "t-approve",
      resourceId: RESOURCE_ID,
    });
    expect(executed).toEqual([]);

    const resumed = await agent.approveToolCall({
      runId: runs[0]!.runId,
      requestContext,
      memory: { thread: "t-approve", resource: RESOURCE_ID },
    });
    for await (const _part of resumed.fullStream) void _part;

    expect(executed).toEqual([
      { tool: "gws-mcp__docs_create", args: { title: "draft" } },
    ]);
  });

  it("runs nothing after a denial", async () => {
    const { executed, requestContext, turn } = buildGateway();

    const agent = await turn("gws-mcp__docs_delete", { title: "doomed" }, "t-deny");
    const { runs } = await agent.listSuspendedRuns({
      threadId: "t-deny",
      resourceId: RESOURCE_ID,
    });

    const resumed = await agent.declineToolCall({
      runId: runs[0]!.runId,
      requestContext,
      memory: { thread: "t-deny", resource: RESOURCE_ID },
    });
    for await (const _part of resumed.fullStream) void _part;

    expect(executed).toEqual([]);
  });
});
