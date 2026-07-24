import { describe, it, expect, vi } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import {
  buildToolSet, streamEngineTurn, detectPause, executeWriteBatch,
  TOOL_OUTPUT_CAP, type EngineDeps, type EngineTool,
} from "./engine";

const tools: EngineTool[] = [
  { name: "gws-mcp__gmail_search", description: "search gmail", input_schema: { type: "object" } },
  { name: "gws-mcp__gmail_send", description: "send mail", input_schema: { type: "object" } },
];
const isWrite = (n: string) => n === "gws-mcp__gmail_send";

// NOTE (Step 1 finding): the installed @ai-sdk/provider v3 LanguageModelV3Usage
// and LanguageModelV3FinishReason shapes are nested objects, not the flat
// { inputTokens, outputTokens, totalTokens } / bare-string shapes the brief
// assumed (that flatter shape is what `result.usage` / `result.finishReason`
// resolve TO at the streamText level — not what a mock model's raw `finish`
// chunk must emit). See task-4-report.md for the full deviation list.
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const textStream = (text: string) => [
  { type: "stream-start", warnings: [] },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: text },
  { type: "text-end", id: "t1" },
  { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
];
const toolCallStream = (calls: { id: string; name: string; input: object }[]) => [
  { type: "stream-start", warnings: [] },
  ...calls.map((c) => ({
    type: "tool-call", toolCallId: c.id, toolName: c.name, input: JSON.stringify(c.input),
  })),
  { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
];

/** Model that plays scripted step streams in order (streamText calls doStream once per step).
 * Chunks are cast to `any` — the LanguageModelV3StreamPart union is exact-object-typed
 * (e.g. `{ type: "stream-start"; warnings: [] }`) and doesn't infer cleanly from a plain
 * object literal array; the runtime shapes are verified against the installed provider
 * types in Step 1 (see task-4-report.md). */
function scriptedModel(steps: object[][]) {
  let i = 0;
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: steps[Math.min(i++, steps.length - 1)] as any }),
    }),
  });
}

function deps(model: MockLanguageModelV3, executeTool = vi.fn(async () => ({ text: "ok", isError: false }))): EngineDeps {
  return { model, tools, isWrite, executeTool };
}

describe("streamEngineTurn + detectPause", () => {
  it("plain text turn: streams text, no pause", async () => {
    const d = deps(scriptedModel([textStream("hi there")]));
    const result = streamEngineTurn(d, [{ role: "user", content: "hi" }]);
    expect(await result.text).toBe("hi there");
    expect(await detectPause(d, [{ role: "user", content: "hi" }], result)).toBeNull();
  });

  it("read tool loop: executes the read, feeds result back, finishes with text, no pause", async () => {
    const executeTool = vi.fn(async () => ({ text: "3 emails", isError: false }));
    const d = deps(
      scriptedModel([
        toolCallStream([{ id: "tc1", name: "gws-mcp__gmail_search", input: { query: "is:unread" } }]),
        textStream("You have 3 unread."),
      ]),
      executeTool
    );
    const result = streamEngineTurn(d, [{ role: "user", content: "unread?" }]);
    expect(await result.text).toContain("3 unread");
    expect(executeTool).toHaveBeenCalledWith("gws-mcp__gmail_search", { query: "is:unread" });
    expect(await detectPause(d, [{ role: "user", content: "unread?" }], result)).toBeNull();
  });

  it("mixed batch: read executes, write does NOT — pause carries only the write", async () => {
    const executeTool = vi.fn(async () => ({ text: "found it", isError: false }));
    const d = deps(
      scriptedModel([
        toolCallStream([
          { id: "tc_r", name: "gws-mcp__gmail_search", input: { query: "q" } },
          { id: "tc_w", name: "gws-mcp__gmail_send", input: { to: "a@b.c" } },
        ]),
      ]),
      executeTool
    );
    const history = [{ role: "user" as const, content: "send it" }];
    const result = streamEngineTurn(d, history);
    const pause = await detectPause(d, history, result);
    expect(pause).not.toBeNull();
    expect(pause!.pending).toEqual([{ id: "tc_w", name: "gws-mcp__gmail_send", input: { to: "a@b.c" } }]);
    // The read ran; the write never did.
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith("gws-mcp__gmail_search", { query: "q" });
    // Paused messages include history + the assistant tool-call step(s).
    expect(pause!.messages.length).toBeGreaterThan(history.length);
  });

  it("caps tool output fed back to the model at TOOL_OUTPUT_CAP", async () => {
    const executeTool = vi.fn(async () => ({ text: "x".repeat(TOOL_OUTPUT_CAP + 500), isError: false }));
    const d = deps(
      scriptedModel([
        toolCallStream([{ id: "tc1", name: "gws-mcp__gmail_search", input: {} }]),
        textStream("done"),
      ]),
      executeTool
    );
    const result = streamEngineTurn(d, [{ role: "user", content: "go" }]);
    await result.text;
    const msgs = (await result.response).messages;
    const toolMsg = JSON.stringify(msgs);
    expect(toolMsg).not.toContain("x".repeat(TOOL_OUTPUT_CAP + 1));
  });

  it("stops at the iteration cap", async () => {
    // Model that ALWAYS asks for another read → loop must stop at 8 steps.
    const d = deps(
      scriptedModel([toolCallStream([{ id: "tc", name: "gws-mcp__gmail_search", input: {} }])])
    );
    const result = streamEngineTurn(d, [{ role: "user", content: "loop" }]);
    await result.text;
    expect((await result.steps).length).toBe(8);
  });
});

describe("buildToolSet", () => {
  it("gives reads an execute function and writes none", () => {
    const d = deps(scriptedModel([textStream("x")]));
    const set = buildToolSet(d);
    expect(typeof set["gws-mcp__gmail_search"]?.execute).toBe("function");
    expect(set["gws-mcp__gmail_send"]?.execute).toBeUndefined();
  });
});

describe("executeWriteBatch", () => {
  const writes = [
    { id: "w1", name: "gws-mcp__gmail_send", input: { to: "a@b.c" } },
    { id: "w2", name: "gws-mcp__docs_create", input: { title: "t" } },
  ];

  it("runs approved writes through executeTool; denies everything else by default", async () => {
    const executeTool = vi.fn(async () => ({ text: "sent", isError: false }));
    const d = { ...deps(scriptedModel([textStream("x")])), executeTool };
    const { toolMessage, outcomes } = await executeWriteBatch(d, writes, { w1: "approve" });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith("gws-mcp__gmail_send", { to: "a@b.c" });
    expect(outcomes).toEqual([
      { name: "gws-mcp__gmail_send", isError: false, denied: false },
      { name: "gws-mcp__docs_create", isError: true, denied: true },
    ]);
    const s = JSON.stringify(toolMessage);
    expect(s).toContain("User declined this action.");
    expect(s).toContain("sent");
  });

  it("treats arbitrary decision values as deny", async () => {
    const executeTool = vi.fn(async () => ({ text: "sent", isError: false }));
    const d = { ...deps(scriptedModel([textStream("x")])), executeTool };
    const { outcomes } = await executeWriteBatch(d, writes, { w1: "APPROVE", w2: true });
    expect(executeTool).not.toHaveBeenCalled();
    expect(outcomes.every((o) => o.denied)).toBe(true);
  });

  it("stops before each write when the abort signal fired", async () => {
    const ac = new AbortController();
    ac.abort();
    const executeTool = vi.fn(async () => ({ text: "sent", isError: false }));
    const d = { ...deps(scriptedModel([textStream("x")])), executeTool, abortSignal: ac.signal };
    await executeWriteBatch(d, writes, { w1: "approve", w2: "approve" });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("caps write output and converts executor throws to error results", async () => {
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ text: "y".repeat(TOOL_OUTPUT_CAP + 500), isError: false })
      .mockRejectedValueOnce(new Error("boom"));
    const d = { ...deps(scriptedModel([textStream("x")])), executeTool };
    const { toolMessage, outcomes } = await executeWriteBatch(d, writes, { w1: "approve", w2: "approve" });
    const s = JSON.stringify(toolMessage);
    expect(s).not.toContain("y".repeat(TOOL_OUTPUT_CAP + 1));
    expect(s).toContain("boom");
    expect(outcomes[1]).toEqual({ name: "gws-mcp__docs_create", isError: true, denied: false });
  });

  it("converts a non-Error throw to a well-formed error result", async () => {
    const executeTool = vi.fn().mockRejectedValueOnce("boom");
    const d = { ...deps(scriptedModel([textStream("x")])), executeTool };
    const { toolMessage, outcomes } = await executeWriteBatch(d, [writes[0]], { w1: "approve" });
    expect(outcomes[0]).toEqual({ name: "gws-mcp__gmail_send", isError: true, denied: false });
    const result = toolMessage.content[0] as { output: { type: string; value: string } };
    expect(result.output).toEqual({ type: "error-text", value: "boom" });
  });
});
