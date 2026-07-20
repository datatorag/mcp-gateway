import { describe, it, expect, vi } from "vitest";
import {
  runPlaygroundTurn,
  MAX_TOOL_ITERATIONS,
  type EngineEvent,
  type EngineTool,
} from "./engine.js";

function scriptedLlm(responses: object[]) {
  let i = 0;
  return { messages: { create: vi.fn(async (_req: any) => responses[i++]) } };
}

const textMsg = { stop_reason: "end_turn", content: [{ type: "text", text: "hi there" }] };
const toolMsg = {
  stop_reason: "tool_use",
  content: [
    { type: "text", text: "Let me check." },
    { type: "tool_use", id: "tu_1", name: "gws-mcp__gmail_search", input: { query: "is:unread" } },
  ],
};

const tools: EngineTool[] = [
  { name: "gws-mcp__gmail_search", description: "search gmail", input_schema: {} },
];

function baseOpts(overrides: Partial<Parameters<typeof runPlaygroundTurn>[0]> = {}) {
  return {
    llm: scriptedLlm([textMsg]) as any,
    model: "claude-sonnet-5",
    tools,
    messages: [{ role: "user", content: "hi" }],
    executeTool: vi.fn(async () => ({ text: "3 emails", isError: false })),
    emit: vi.fn(),
    ...overrides,
  };
}

describe("runPlaygroundTurn", () => {
  it("emits text and done for a plain response", async () => {
    const emit = vi.fn();
    const opts = baseOpts({ emit });
    await runPlaygroundTurn(opts as any);

    expect(emit.mock.calls.map((c) => c[0])).toEqual([
      { type: "text", text: "hi there" },
      { type: "done", stopReason: "end_turn" },
    ] satisfies EngineEvent[]);
  });

  it("runs the tool loop: tool_use -> executeTool -> feeds tool_result back -> final text", async () => {
    const emit = vi.fn();
    const llm = scriptedLlm([toolMsg, textMsg]);
    const executeTool = vi.fn(async () => ({ text: "3 emails", isError: false }));
    const opts = baseOpts({ llm: llm as any, executeTool, emit });
    await runPlaygroundTurn(opts as any);

    expect(emit.mock.calls.map((c) => c[0])).toEqual([
      { type: "text", text: "Let me check." },
      { type: "tool_start", name: "gws-mcp__gmail_search" },
      { type: "tool_done", name: "gws-mcp__gmail_search", isError: false },
      { type: "text", text: "hi there" },
      { type: "done", stopReason: "end_turn" },
    ] satisfies EngineEvent[]);

    expect(executeTool).toHaveBeenCalledWith("gws-mcp__gmail_search", { query: "is:unread" });

    // second create() call's messages should end with a user turn whose
    // content[0] is the tool_result block.
    expect(llm.messages.create).toHaveBeenCalledTimes(2);
    const secondCallArgs = llm.messages.create.mock.calls[1][0];
    const lastMessage = secondCallArgs.messages[secondCallArgs.messages.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "tu_1",
      content: "3 emails",
    });

    // the assistant turn (tool_use content) must have been pushed before the
    // user tool_result turn.
    const assistantMessage = secondCallArgs.messages[secondCallArgs.messages.length - 2];
    expect(assistantMessage.role).toBe("assistant");
    expect(assistantMessage.content).toEqual(toolMsg.content);
  });

  it("stops after MAX_TOOL_ITERATIONS and emits done with stopReason 'max_iterations'", async () => {
    const emit = vi.fn();
    const llm = scriptedLlm(Array(20).fill(toolMsg));
    const opts = baseOpts({ llm: llm as any, emit });
    await runPlaygroundTurn(opts as any);

    expect(llm.messages.create).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS);
    expect(MAX_TOOL_ITERATIONS).toBe(8);
    const lastEvent = emit.mock.calls[emit.mock.calls.length - 1][0];
    expect(lastEvent).toEqual({ type: "done", stopReason: "max_iterations" });
  });

  it("feeds tool errors back as is_error tool_result and keeps going", async () => {
    const emit = vi.fn();
    const llm = scriptedLlm([toolMsg, textMsg]);
    const executeTool = vi.fn(async () => {
      throw new Error("boom: tool failed");
    });
    const opts = baseOpts({ llm: llm as any, executeTool, emit });
    await runPlaygroundTurn(opts as any);

    expect(emit.mock.calls.map((c) => c[0])).toEqual([
      { type: "text", text: "Let me check." },
      { type: "tool_start", name: "gws-mcp__gmail_search" },
      { type: "tool_done", name: "gws-mcp__gmail_search", isError: true },
      { type: "text", text: "hi there" },
      { type: "done", stopReason: "end_turn" },
    ] satisfies EngineEvent[]);

    const secondCallArgs = llm.messages.create.mock.calls[1][0];
    const lastMessage = secondCallArgs.messages[secondCallArgs.messages.length - 1];
    expect(lastMessage.content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "tu_1",
      content: "boom: tool failed",
      is_error: true,
    });
  });

  it("marks the last tool and the system block with ephemeral cache_control", async () => {
    const emit = vi.fn();
    const llm = scriptedLlm([textMsg]);
    const manyTools: EngineTool[] = [
      { name: "tool_a", description: "a", input_schema: {} },
      { name: "tool_b", description: "b", input_schema: {} },
      { name: "tool_c", description: "c", input_schema: {} },
    ];
    const opts = baseOpts({ llm: llm as any, emit, tools: manyTools });
    await runPlaygroundTurn(opts as any);

    const callArgs = llm.messages.create.mock.calls[0][0];
    expect(callArgs.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(callArgs.tools[callArgs.tools.length - 1].cache_control).toEqual({ type: "ephemeral" });
    expect(callArgs.tools[0].cache_control).toBeUndefined();
    expect(callArgs.tools[1].cache_control).toBeUndefined();
  });
});
