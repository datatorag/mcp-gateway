import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { handleChatStream } from "@mastra/ai-sdk";

vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({ ANTHROPIC_API_KEY: "test-key", PLAYGROUND_MODEL: "claude-haiku-4-5" }),
}));

import { buildPluginRequestContext, wrapMcpTools } from "./mcp/client";
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

type CapturedBlock = { type?: string; cache_control?: { type?: string } };
type CapturedBody = {
  system?: Array<{ text?: string; cache_control?: { type?: string } }>;
  tools?: Array<{ name?: string; cache_control?: { type?: string } }>;
  messages?: Array<{ role?: string; content?: string | CapturedBlock[] }>;
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

/** An Anthropic streaming response that calls one tool with empty input, so
 * the agent loop runs a second step and sends a second request. */
function anthropicToolUseResponse(toolName: string): Response {
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
    event({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: toolName, input: {} } }),
    event({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }),
    event({ type: "content_block_stop", index: 0 }),
    event({
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 1 },
    }),
    event({ type: "message_stop" }),
  ].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
/** When set, the first provider call answers with this tool call and every
 * later one with plain text: a two-step turn. */
let firstCallUsesTool: string | null = null;

beforeEach(() => {
  captured.length = 0;
  firstCallUsesTool = null;
  const realFetch = globalThis.fetch;
  // Only the provider call is intercepted. The MCP traffic below runs over the
  // same global `fetch` and has to keep working, so anything that is not
  // Anthropic is passed straight through.
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!String(url).includes("api.anthropic.com")) return realFetch(url, init);
    captured.push(JSON.parse(String(init?.body ?? "{}")) as CapturedBody);
    if (captured.length === 1 && firstCallUsesTool) return anthropicToolUseResponse(firstCallUsesTool);
    return anthropicStreamResponse();
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** One real turn through the real agent, returning the body it sent.
 * Tools come through wrapMcpTools, the SCRUM-188 path: the definitions are
 * what the in-process MCP server would list, and the breakpoint treatment
 * under test is applied by that wrapper. */
async function captureTurn(toolNames: string[]): Promise<CapturedBody> {
  const requestContext = buildPluginRequestContext({ userId: "cache-user" });
  const tools = wrapMcpTools(
    toolNames.map((n) => ({
      name: `gws-mcp__${n}`,
      description: n,
      inputSchema: { type: "object", properties: {} },
    })),
    async () => ({ content: [{ type: "text", text: "ok" }] })
  );

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

  expect(captured).toHaveLength(firstCallUsesTool ? 2 : 1);
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

/* SCRUM-241: a third breakpoint, on the latest message, moved every step.
 * With only the system prompt and the tool schemas cached, every tool result
 * of a run was uncached input again on each later step; a seven-mailbox pass
 * was paid in full on every step after the one that read it. */
describe("the moving breakpoint on the latest message (SCRUM-241)", () => {
  /** The message blocks that carry a cache mark, as [messageIndex, blockIndex]. */
  function marked(body: CapturedBody): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    (body.messages ?? []).forEach((m, mi) => {
      if (!Array.isArray(m.content)) return;
      m.content.forEach((b, bi) => {
        if (b.cache_control) out.push([mi, bi]);
      });
    });
    return out;
  }
  function lastBlock(body: CapturedBody): [number, number] {
    const messages = body.messages ?? [];
    const last = messages[messages.length - 1]!;
    const blocks = Array.isArray(last.content) ? last.content : [];
    return [messages.length - 1, blocks.length - 1];
  }

  it("marks the last block of the last message, and only that, on a one-step turn", async () => {
    const body = await captureTurn(["gmail_search"]);
    expect(marked(body)).toEqual([lastBlock(body)]);
    // The two existing breakpoints are untouched, and nothing leaks to the top level.
    expect(body.system?.[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(body.tools?.[body.tools.length - 1]?.cache_control).toEqual({ type: "ephemeral" });
    expect(body.cache_control).toBeUndefined();
  });

  it("moves the mark to the tool result on the second step, leaving exactly one mark", async () => {
    firstCallUsesTool = "gws-mcp__gmail_search";
    await captureTurn(["gmail_search"]);
    const [first, second] = captured as [CapturedBody, CapturedBody];
    expect(marked(first)).toEqual([lastBlock(first)]);
    // Step two carries the assistant tool call and its result after the user
    // message. The mark sits on the newest block, the tool result; the runtime
    // hands a tool part's metadata to its call block as well, so that adjacent
    // block may carry it too, and nothing earlier does: the user message's
    // mark from step one is gone.
    const messages = second.messages ?? [];
    expect(messages.length).toBeGreaterThan((first.messages ?? []).length);
    const marks = marked(second);
    expect(marks[marks.length - 1]).toEqual(lastBlock(second));
    expect(marks.length).toBeLessThanOrEqual(2);
    for (const [mi] of marks) expect(mi).toBeGreaterThanOrEqual(messages.length - 2);
    expect(marks.some(([mi]) => mi === 0)).toBe(false);
    expect(second.system?.[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(second.tools?.[second.tools.length - 1]?.cache_control).toEqual({ type: "ephemeral" });
    expect(second.cache_control).toBeUndefined();
  });
});
