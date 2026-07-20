import { describe, it, expect, vi } from "vitest";
import {
  runPlaygroundTurn,
  resumePlaygroundTurn,
  MAX_TOOL_ITERATIONS,
  type EngineEvent,
  type EngineTool,
  type TurnResult,
} from "./engine";

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
    // Default: nothing is a write, so existing tool tests never pause.
    isWrite: () => false,
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

  it("handles multiple tool_use blocks in a single LLM response (parallel tool calls)", async () => {
    const emit = vi.fn();
    const parallelToolMsg = {
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Let me check multiple things." },
        { type: "tool_use", id: "tu_1", name: "gws-mcp__gmail_search", input: { query: "is:unread" } },
        { type: "tool_use", id: "tu_2", name: "tools-b", input: { param: "value" } },
      ],
    };
    const llm = scriptedLlm([parallelToolMsg, textMsg]);
    const executeTool = vi.fn(async (name: string) => {
      if (name === "gws-mcp__gmail_search") return { text: "5 unread emails", isError: false };
      return { text: "result from tool B", isError: false };
    });
    const multiToolConfig = [
      { name: "gws-mcp__gmail_search", description: "search gmail", input_schema: {} },
      { name: "tools-b", description: "tool b", input_schema: {} },
    ];
    const opts = baseOpts({ llm: llm as any, executeTool, emit, tools: multiToolConfig });
    await runPlaygroundTurn(opts as any);

    // Verify executeTool called twice, in order
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenNthCalledWith(1, "gws-mcp__gmail_search", { query: "is:unread" });
    expect(executeTool).toHaveBeenNthCalledWith(2, "tools-b", { param: "value" });

    // Verify emit contains tool_start/tool_done for both tools
    expect(emit.mock.calls.map((c) => c[0])).toEqual([
      { type: "text", text: "Let me check multiple things." },
      { type: "tool_start", name: "gws-mcp__gmail_search" },
      { type: "tool_done", name: "gws-mcp__gmail_search", isError: false },
      { type: "tool_start", name: "tools-b" },
      { type: "tool_done", name: "tools-b", isError: false },
      { type: "text", text: "hi there" },
      { type: "done", stopReason: "end_turn" },
    ] satisfies EngineEvent[]);

    // Verify second create() call's messages end with a user turn containing two tool_result blocks
    expect(llm.messages.create).toHaveBeenCalledTimes(2);
    const secondCallArgs = llm.messages.create.mock.calls[1][0];
    const lastMessage = secondCallArgs.messages[secondCallArgs.messages.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content).toHaveLength(2);
    expect(lastMessage.content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "tu_1",
      content: "5 unread emails",
    });
    expect(lastMessage.content[1]).toEqual({
      type: "tool_result",
      tool_use_id: "tu_2",
      content: "result from tool B",
    });

    // Verify the assistant turn with parallel tool_use blocks was pushed before the user tool_result turn
    const assistantMessage = secondCallArgs.messages[secondCallArgs.messages.length - 2];
    expect(assistantMessage.role).toBe("assistant");
    expect(assistantMessage.content).toEqual(parallelToolMsg.content);
  });

  it("stops before the next iteration when shouldStop flips true (client abort)", async () => {
    const emit = vi.fn();
    // Iteration 1: create() -> toolMsg, shouldStop checked at top of iter 1
    // (false) and before the single tool executes (false); loop then goes to
    // check shouldStop at the top of iteration 2, which returns true.
    const shouldStop = vi
      .fn()
      .mockReturnValueOnce(false) // top of iteration 1
      .mockReturnValueOnce(false) // before tool execution in iteration 1
      .mockReturnValue(true); // top of iteration 2 -> stop
    const llm = scriptedLlm([toolMsg, textMsg]);
    const executeTool = vi.fn(async () => ({ text: "3 emails", isError: false }));
    const opts = baseOpts({ llm: llm as any, executeTool, emit, shouldStop });
    await runPlaygroundTurn(opts as any);

    expect(llm.messages.create).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledTimes(1);
    const lastEvent = emit.mock.calls[emit.mock.calls.length - 1][0];
    expect(lastEvent).toEqual({ type: "done", stopReason: "aborted" });
  });

  it("stops before executing a remaining tool in the same response when shouldStop flips true mid-batch", async () => {
    const emit = vi.fn();
    const parallelToolMsg = {
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "tu_1", name: "gws-mcp__gmail_search", input: { query: "is:unread" } },
        { type: "tool_use", id: "tu_2", name: "tools-b", input: { param: "value" } },
      ],
    };
    // shouldStop is false at the top of the (only) iteration and before the
    // first tool, then flips true right before the second tool would run.
    const shouldStop = vi
      .fn()
      .mockReturnValueOnce(false) // top of iteration
      .mockReturnValueOnce(false) // before tool 1
      .mockReturnValue(true); // before tool 2 -> stop
    const llm = scriptedLlm([parallelToolMsg]);
    const executeTool = vi.fn(async () => ({ text: "ok", isError: false }));
    const opts = baseOpts({ llm: llm as any, executeTool, emit, shouldStop });
    await runPlaygroundTurn(opts as any);

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith("gws-mcp__gmail_search", { query: "is:unread" });
    expect(llm.messages.create).toHaveBeenCalledTimes(1);
    const lastEvent = emit.mock.calls[emit.mock.calls.length - 1][0];
    expect(lastEvent).toEqual({ type: "done", stopReason: "aborted" });
  });
});

const sendToolMsg = {
  stop_reason: "tool_use",
  content: [
    { type: "text", text: "I'll send that." },
    { type: "tool_use", id: "w_1", name: "gws-mcp__gmail_send", input: { to: "a@b.com" } },
  ],
};
const isWrite = (name: string) => name.includes("send") || name.includes("create");

describe("write confirmation gate", () => {
  it("pauses before a write: executes nothing, returns awaiting_confirmation", async () => {
    const emit = vi.fn();
    const executeTool = vi.fn(async () => ({ text: "sent", isError: false }));
    const llm = scriptedLlm([sendToolMsg]);
    const opts = baseOpts({ llm: llm as any, executeTool, emit, isWrite });
    const result = (await runPlaygroundTurn(opts as any)) as TurnResult;

    expect(result.status).toBe("awaiting_confirmation");
    if (result.status !== "awaiting_confirmation") throw new Error("unreachable");
    expect(result.pending).toEqual([
      { id: "w_1", name: "gws-mcp__gmail_send", input: { to: "a@b.com" } },
    ]);
    // Nothing ran, no tool chips, no done — just the assistant's text.
    expect(executeTool).not.toHaveBeenCalled();
    expect(emit.mock.calls.map((c) => c[0])).toEqual([
      { type: "text", text: "I'll send that." },
    ] satisfies EngineEvent[]);
    // The paused batch + messages (incl. the assistant tool_use msg) are returned.
    expect(result.batch).toHaveLength(1);
    const lastMsg = result.messages[result.messages.length - 1] as any;
    expect(lastMsg.role).toBe("assistant");
    expect(lastMsg.content).toEqual(sendToolMsg.content);
  });

  it("pauses the whole mixed batch (read + write) before running the read", async () => {
    const emit = vi.fn();
    const executeTool = vi.fn(async () => ({ text: "x", isError: false }));
    const mixed = {
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "r_1", name: "gws-mcp__gmail_search", input: {} },
        { type: "tool_use", id: "w_1", name: "gws-mcp__gmail_send", input: { to: "a@b.com" } },
      ],
    };
    const opts = baseOpts({ llm: scriptedLlm([mixed]) as any, executeTool, emit, isWrite });
    const result = (await runPlaygroundTurn(opts as any)) as TurnResult;

    expect(result.status).toBe("awaiting_confirmation");
    if (result.status !== "awaiting_confirmation") throw new Error("unreachable");
    // Only the write is pending, but nothing (not even the read) has run.
    expect(result.pending.map((p) => p.id)).toEqual(["w_1"]);
    expect(result.batch).toHaveLength(2);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("resume approve: runs the write, then continues to the final answer", async () => {
    const emit = vi.fn();
    const executeTool = vi.fn(async () => ({ text: "sent ok", isError: false }));
    // After the write result feeds back, the model wraps up.
    const llm = scriptedLlm([textMsg]);
    const result = (await resumePlaygroundTurn({
      llm: llm as any,
      model: "claude-sonnet-5",
      tools,
      messages: [{ role: "user", content: "send it" }, { role: "assistant", content: sendToolMsg.content }],
      batch: [{ id: "w_1", name: "gws-mcp__gmail_send", input: { to: "a@b.com" } }],
      decisions: { w_1: "approve" },
      executeTool,
      emit,
      isWrite,
    })) as TurnResult;

    expect(result.status).toBe("complete");
    expect(executeTool).toHaveBeenCalledWith("gws-mcp__gmail_send", { to: "a@b.com" });
    expect(emit.mock.calls.map((c) => c[0])).toEqual([
      { type: "tool_start", name: "gws-mcp__gmail_send" },
      { type: "tool_done", name: "gws-mcp__gmail_send", isError: false },
      { type: "text", text: "hi there" },
      { type: "done", stopReason: "end_turn" },
    ] satisfies EngineEvent[]);
    // The approved write's real result is fed back to the model.
    const contInput = llm.messages.create.mock.calls[0][0];
    const toolResultMsg = contInput.messages[contInput.messages.length - 1];
    expect(toolResultMsg.content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "w_1",
      content: "sent ok",
    });
  });

  it("resume deny: refuses the write without running it, feeds back a declined result", async () => {
    const emit = vi.fn();
    const executeTool = vi.fn(async () => ({ text: "should not run", isError: false }));
    const llm = scriptedLlm([textMsg]);
    const result = (await resumePlaygroundTurn({
      llm: llm as any,
      model: "claude-sonnet-5",
      tools,
      messages: [{ role: "user", content: "send it" }, { role: "assistant", content: sendToolMsg.content }],
      batch: [{ id: "w_1", name: "gws-mcp__gmail_send", input: { to: "a@b.com" } }],
      decisions: { w_1: "deny" },
      executeTool,
      emit,
      isWrite,
    })) as TurnResult;

    expect(result.status).toBe("complete");
    expect(executeTool).not.toHaveBeenCalled();
    expect(emit.mock.calls.map((c) => c[0])).toEqual([
      { type: "tool_start", name: "gws-mcp__gmail_send" },
      { type: "tool_done", name: "gws-mcp__gmail_send", isError: true },
      { type: "text", text: "hi there" },
      { type: "done", stopReason: "end_turn" },
    ] satisfies EngineEvent[]);
    const contInput = llm.messages.create.mock.calls[0][0];
    const toolResultMsg = contInput.messages[contInput.messages.length - 1];
    expect(toolResultMsg.content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "w_1",
      content: "User declined this action.",
      is_error: true,
    });
  });

  it("resume treats a missing decision as denied (safe default)", async () => {
    const emit = vi.fn();
    const executeTool = vi.fn(async () => ({ text: "should not run", isError: false }));
    const result = (await resumePlaygroundTurn({
      llm: scriptedLlm([textMsg]) as any,
      model: "claude-sonnet-5",
      tools,
      messages: [{ role: "assistant", content: sendToolMsg.content }],
      batch: [{ id: "w_1", name: "gws-mcp__gmail_send", input: {} }],
      decisions: {}, // no decision for w_1
      executeTool,
      emit,
      isWrite,
    })) as TurnResult;

    expect(result.status).toBe("complete");
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("resume runs reads in the paused batch regardless of decisions", async () => {
    const emit = vi.fn();
    const executeTool = vi.fn(async () => ({ text: "read result", isError: false }));
    const batch = [
      { id: "r_1", name: "gws-mcp__gmail_search", input: { q: "x" } },
      { id: "w_1", name: "gws-mcp__gmail_send", input: { to: "a@b.com" } },
    ];
    await resumePlaygroundTurn({
      llm: scriptedLlm([textMsg]) as any,
      model: "claude-sonnet-5",
      tools,
      messages: [{ role: "assistant", content: [] }],
      batch,
      decisions: { w_1: "deny" },
      executeTool,
      emit,
      isWrite,
    });

    // The read ran; the denied write did not.
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith("gws-mcp__gmail_search", { q: "x" });
  });
});
