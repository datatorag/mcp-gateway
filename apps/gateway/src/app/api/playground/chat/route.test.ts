import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { UIMessageChunk } from "ai";

/**
 * The route's own responsibilities, and only those.
 *
 * The agent loop is not one of them any more — history, tool calls, the pause
 * at a gated write and the resume after a decision all belong to the runtime,
 * and mocking the runtime to re-test them here would only assert that the mock
 * behaves like the mock. What is genuinely ours is the envelope: who the
 * caller is, whether they may spend a turn, what gets refunded when nothing
 * happened, what we count, and — critically — how much of the request body is
 * allowed to reach the runtime at all.
 *
 * The two claims that cannot honestly be made against a mock are made
 * elsewhere against real infrastructure: approval ownership in
 * `route.ownership.test.ts`, judged on an MCP server's execution log, and
 * prompt caching in `mastra/prompt-cache.test.ts`, judged on the bytes of the
 * outgoing provider request.
 */

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({ getSessionUserId: () => getSessionUserId() }));

const getEnv = vi.fn();
vi.mock("@datatorag-mcp/config", () => ({ getEnv: () => getEnv() }));

const claimPlaygroundMessage = vi.fn();
const refundPlaygroundMessage = vi.fn();
vi.mock("@/gateway/playground/cap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/gateway/playground/cap")>()),
  claimPlaygroundMessage: (...args: unknown[]) => claimPlaygroundMessage(...args),
  refundPlaygroundMessage: (...args: unknown[]) => refundPlaygroundMessage(...args),
}));

const trackPlaygroundMessage = vi.fn();
const trackPlaygroundToolCall = vi.fn();
const trackPlaygroundCapHit = vi.fn();
const trackPlaygroundConfirm = vi.fn();
vi.mock("@/gateway/track", () => ({
  trackPlaygroundMessage: (...a: unknown[]) => trackPlaygroundMessage(...a),
  trackPlaygroundToolCall: (...a: unknown[]) => trackPlaygroundToolCall(...a),
  trackPlaygroundCapHit: (...a: unknown[]) => trackPlaygroundCapHit(...a),
  trackPlaygroundConfirm: (...a: unknown[]) => trackPlaygroundConfirm(...a),
}));

vi.mock("@/lib/db", () => ({ db: {}, getDb: () => ({}) }));

vi.mock("@/mastra", () => ({
  getMastra: () => ({ mastra: true }),
  DATATORAG_AGENT_ID: "datatorag-playground",
}));

vi.mock("@/mastra/mcp/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/mastra/mcp/client")>()),
  listPluginServers: async () => [
    { slug: "gws-mcp", containerPort: 1, githubRepoUrl: null },
    { slug: "atlassian-mcp", containerPort: 2, githubRepoUrl: null },
  ],
  loadUserPluginTokens: async (_db: unknown, userId: string) => ({
    "gws-mcp": `gws-token-for-${userId}`,
  }),
}));

const handleChatStream = vi.fn();
vi.mock("@mastra/ai-sdk", () => ({
  handleChatStream: (...args: unknown[]) => handleChatStream(...args),
}));

import { mintRunId } from "@/mastra/run-ownership";
import { USER_ID_CONTEXT_KEY, userTokenContextKey } from "@/mastra/mcp/client";
import { POST } from "./route";

const USER = "user-1";

function post(body: unknown, init?: { signal?: AbortSignal }): NextRequest {
  return new NextRequest("http://localhost/api/playground/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: init?.signal,
  });
}

function chunkStream(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** Emits what it is given, then dies — a provider failing mid-turn.
 *
 * Pull-based, and it has to be: `controller.error()` resets the queue, so
 * enqueueing everything up front and then erroring in `start` delivers NOTHING
 * and silently turns every "content was already delivered" case into "nothing
 * was delivered". Handing chunks out one read at a time is both the honest
 * model of a real stream and the only shape in which these tests mean what
 * they say. */
function failingStream(before: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < before.length) {
        controller.enqueue(before[index++]!);
        return;
      }
      controller.error(new Error("provider exploded"));
    },
  });
}

async function drain(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

const USER_TURN = [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }];

/** An approval decision as a client sends one: inline on the trailing
 * assistant message, carrying a run id this process really minted. */
function approvalTurn(ownerId: string) {
  return [
    ...USER_TURN,
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-gws-mcp__docs_create",
          toolCallId: "call-1",
          state: "approval-responded",
          input: {},
          approval: { id: `${mintRunId(ownerId)}::call-1`, approved: true },
        },
      ],
    },
  ];
}

/** The `params` the route handed the runtime on the most recent call. */
function lastParams(): Record<string, unknown> {
  const call = handleChatStream.mock.calls.at(-1)?.[0] as { params: Record<string, unknown> };
  return call.params;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionUserId.mockResolvedValue(USER);
  getEnv.mockReturnValue({
    ANTHROPIC_API_KEY: "test-key",
    PLAYGROUND_MODEL: "claude-haiku-4-5",
    PLAYGROUND_MESSAGE_CAP: 20,
  });
  claimPlaygroundMessage.mockResolvedValue(true);
  refundPlaygroundMessage.mockResolvedValue(undefined);
  handleChatStream.mockResolvedValue(chunkStream([{ type: "start" }, { type: "finish" }]));
});

describe("POST /api/playground/chat — guards", () => {
  it("401s with no session", async () => {
    getSessionUserId.mockResolvedValue(null);
    expect((await POST(post({ messages: USER_TURN }))).status).toBe(401);
  });

  it("403s when no model is configured", async () => {
    getEnv.mockReturnValue({ ANTHROPIC_API_KEY: "", PLAYGROUND_MESSAGE_CAP: 20 });
    const response = await POST(post({ messages: USER_TURN }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "playground_disabled" });
    // Nothing charged for a turn that could never have run.
    expect(claimPlaygroundMessage).not.toHaveBeenCalled();
  });

  it("400s on a body with no usable messages", async () => {
    for (const body of [{}, { messages: [] }, { messages: "nope" }]) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect(handleChatStream).not.toHaveBeenCalled();
  });

  it("400s on unparseable JSON", async () => {
    const request = new NextRequest("http://localhost/api/playground/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    expect((await POST(request)).status).toBe(400);
  });
});

describe("POST /api/playground/chat — the turn cap", () => {
  it("429s with cap_exceeded when the claim fails, and records the hit", async () => {
    claimPlaygroundMessage.mockResolvedValue(false);
    const response = await POST(post({ messages: USER_TURN }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "cap_exceeded", cap: 20 });
    expect(trackPlaygroundCapHit).toHaveBeenCalledWith({}, USER);
    expect(handleChatStream).not.toHaveBeenCalled();
  });

  it("claims and counts one message on a fresh turn", async () => {
    await drain(await POST(post({ messages: USER_TURN })));

    expect(claimPlaygroundMessage).toHaveBeenCalledWith({}, USER, 20);
    expect(trackPlaygroundMessage).toHaveBeenCalledWith({}, USER);
  });

  it("claims nothing on an approval decision — it continues a paid turn", async () => {
    await drain(await POST(post({ messages: approvalTurn(USER) })));

    expect(claimPlaygroundMessage).not.toHaveBeenCalled();
    expect(trackPlaygroundConfirm).toHaveBeenCalledWith({}, USER, "approved", 1);
  });

  it("records a decision of 'denied' when nothing in the batch was approved", async () => {
    const messages = approvalTurn(USER);
    (messages[1] as { parts: Array<{ approval: { approved: boolean } }> }).parts[0]!
      .approval.approved = false;
    await drain(await POST(post({ messages })));

    expect(trackPlaygroundConfirm).toHaveBeenCalledWith({}, USER, "denied", 1);
  });
});

describe("POST /api/playground/chat — refunds", () => {
  it("refunds when the turn dies before it produced anything", async () => {
    handleChatStream.mockRejectedValue(new Error("nope"));
    const response = await POST(post({ messages: USER_TURN }));

    expect(response.status).toBe(500);
    expect(refundPlaygroundMessage).toHaveBeenCalledWith({}, USER);
  });

  it("refunds when the stream fails having delivered only bookkeeping", async () => {
    // `start` is enqueued before the model is even called, so a turn that
    // fails right after it has produced nothing the user can see.
    handleChatStream.mockResolvedValue(failingStream([{ type: "start" }]));
    const chunks = await drain(await POST(post({ messages: USER_TURN })));

    expect(chunks.some((c) => c.type === "error")).toBe(true);
    expect(refundPlaygroundMessage).toHaveBeenCalledWith({}, USER);
  });

  it("does NOT refund once real content has reached the client", async () => {
    handleChatStream.mockResolvedValue(
      failingStream([
        { type: "start" },
        { type: "text-start", id: "t0" },
        { type: "text-delta", id: "t0", delta: "partial answer" },
      ])
    );
    await drain(await POST(post({ messages: USER_TURN })));

    // The tokens were really spent. A failure afterwards is not a reason to
    // hand the turn back.
    expect(refundPlaygroundMessage).not.toHaveBeenCalled();
  });

  it("does NOT refund an aborted request, however early it died", async () => {
    const controller = new AbortController();
    controller.abort();
    handleChatStream.mockResolvedValue(failingStream([{ type: "start" }]));
    await drain(await POST(post({ messages: USER_TURN }, { signal: controller.signal })));

    // Otherwise "POST a large history, abort at once" is a free loop: real
    // provider input tokens burned while the cap never moves.
    expect(refundPlaygroundMessage).not.toHaveBeenCalled();
  });

  it("never refunds on an approval decision — no claim was made to undo", async () => {
    handleChatStream.mockRejectedValue(new Error("nope"));
    await POST(post({ messages: approvalTurn(USER) }));

    expect(refundPlaygroundMessage).not.toHaveBeenCalled();
  });
});

describe("POST /api/playground/chat — metering taps", () => {
  it("counts a tool call when it produced a result, naming it from the call", async () => {
    handleChatStream.mockResolvedValue(
      chunkStream([
        { type: "start" },
        { type: "tool-input-available", toolCallId: "c1", toolName: "gws-mcp__docs_get", input: {} },
        { type: "tool-output-available", toolCallId: "c1", output: "ok" },
        { type: "finish" },
      ])
    );
    await drain(await POST(post({ messages: USER_TURN })));

    expect(trackPlaygroundToolCall).toHaveBeenCalledWith({}, USER, "gws-mcp__docs_get");
  });

  it("does NOT count a gated write that was announced but never ran", async () => {
    handleChatStream.mockResolvedValue(
      chunkStream([
        { type: "start" },
        {
          type: "tool-input-available",
          toolCallId: "c1",
          toolName: "gws-mcp__docs_create",
          input: {},
        },
        { type: "tool-approval-request", approvalId: "r::c1", toolCallId: "c1" },
      ])
    );
    await drain(await POST(post({ messages: USER_TURN })));

    // Billing for an action the user has not allowed yet — and may decline —
    // would be charging for intent.
    expect(trackPlaygroundToolCall).not.toHaveBeenCalled();
    expect(trackPlaygroundConfirm).toHaveBeenCalledWith({}, USER, "shown", 1);
  });

  it("counts a tool call whose result was an error", async () => {
    handleChatStream.mockResolvedValue(
      chunkStream([
        { type: "start" },
        { type: "tool-input-available", toolCallId: "c1", toolName: "gws-mcp__docs_get", input: {} },
        { type: "tool-output-error", toolCallId: "c1", errorText: "boom" },
      ])
    );
    await drain(await POST(post({ messages: USER_TURN })));

    // The call reached the plugin; failing there does not un-spend it.
    expect(trackPlaygroundToolCall).toHaveBeenCalledWith({}, USER, "gws-mcp__docs_get");
  });
});

describe("POST /api/playground/chat — what reaches the runtime", () => {
  it("streams back a UI message stream on the happy path", async () => {
    const response = await POST(post({ messages: USER_TURN }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await drain(response)).toEqual([{ type: "start" }, { type: "finish" }]);
  });

  it("names the agent and the runtime's v6 output protocol", async () => {
    await drain(await POST(post({ messages: USER_TURN })));
    const call = handleChatStream.mock.calls[0]![0] as Record<string, unknown>;

    expect(call.agentId).toBe("datatorag-playground");
    // NOT the app's SDK version — the runtime's emitter. v6 is what carries a
    // native approval part; v5 silently falls back to a custom data part.
    expect(call.version).toBe("v6");
  });

  it("carries the caller's identity and per-plugin tokens in params", async () => {
    await drain(await POST(post({ messages: USER_TURN })));
    const context = lastParams().requestContext as { get: (k: string) => unknown };

    expect(context.get(USER_ID_CONTEXT_KEY)).toBe(USER);
    // Keyed PER PLUGIN. One shared key would hand the Atlassian plugin the
    // user's Google token.
    expect(context.get(userTokenContextKey("gws-mcp"))).toBe(`gws-token-for-${USER}`);
    expect(context.get(userTokenContextKey("atlassian-mcp"))).toBeUndefined();
  });

  it("mints a run id for a fresh turn and none for an approval decision", async () => {
    await drain(await POST(post({ messages: USER_TURN })));
    expect(typeof lastParams().runId).toBe("string");

    // On a decision the runtime takes the run id off the approval itself.
    await drain(await POST(post({ messages: approvalTurn(USER) })));
    expect(lastParams().runId).toBeUndefined();
  });

  it("never forwards a client-supplied runId or resumeData", async () => {
    await drain(
      await POST(
        post({ messages: USER_TURN, runId: "attacker-run-id", resumeData: { approved: true } })
      )
    );
    const params = lastParams();

    // Both are direct resume primitives on the runtime's API. The route
    // constructs its own or sends neither; it never relays the body's.
    expect(params.runId).not.toBe("attacker-run-id");
    expect(params.resumeData).toBeUndefined();
  });

  it("namespaces the conversation thread by user, so an id cannot cross accounts", async () => {
    await drain(await POST(post({ messages: USER_TURN, id: "shared-chat-id" })));
    const asUserOne = (lastParams().memory as { thread: string }).thread;

    getSessionUserId.mockResolvedValue("user-2");
    await drain(await POST(post({ messages: USER_TURN, id: "shared-chat-id" })));
    const memory = lastParams().memory as { thread: string; resource: string };

    expect(memory.resource).toBe("user-2");
    // Same conversation id from the browser, two different threads.
    expect(memory.thread).not.toBe(asUserOne);
  });

  it("rejects an approval whose run id belongs to somebody else", async () => {
    const response = await POST(post({ messages: approvalTurn("someone-else") }));

    expect(response.status).toBe(403);
    // The runtime is never handed the request at all — the refusal lands
    // before anything that could resume.
    expect(handleChatStream).not.toHaveBeenCalled();
  });
});
