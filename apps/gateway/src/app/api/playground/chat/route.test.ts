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

import { FREE_MONTHLY_AGENT_RUNS as RUN_CAP } from "@/gateway/billing/plans";

const claimAgentRun = vi.fn();
const capExempt = vi.fn();
const refundAgentRun = vi.fn();
vi.mock("@/gateway/usage/period", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/gateway/usage/period")>()),
  claimAgentRun: (...args: unknown[]) => claimAgentRun(...args),
  capExempt: (...args: unknown[]) => capExempt(...args),
  refundAgentRun: (...args: unknown[]) => refundAgentRun(...args),
}));

const trackPlaygroundMessage = vi.fn();
const trackPlaygroundCapHit = vi.fn();
const trackPlaygroundConfirm = vi.fn();
const trackAgentRun = vi.fn();
const trackToolCall = vi.fn();
vi.mock("@/gateway/track", () => ({
  trackPlaygroundMessage: (...a: unknown[]) => trackPlaygroundMessage(...a),
  trackPlaygroundCapHit: (...a: unknown[]) => trackPlaygroundCapHit(...a),
  trackPlaygroundConfirm: (...a: unknown[]) => trackPlaygroundConfirm(...a),
  trackAgentRun: (...a: unknown[]) => trackAgentRun(...a),
  trackToolCall: (...a: unknown[]) => trackToolCall(...a),
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

import { mintRunId } from "@/gateway/playground/run-ownership";
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
  claimAgentRun.mockResolvedValue({ ok: true, used: 1, remaining: 24 });
  capExempt.mockResolvedValue(false);
  refundAgentRun.mockResolvedValue(undefined);
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
    expect(claimAgentRun).not.toHaveBeenCalled();
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
    claimAgentRun.mockResolvedValue({ ok: false, used: RUN_CAP });
    const response = await POST(post({ messages: USER_TURN }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "cap_exceeded", cap: RUN_CAP });
    expect(trackPlaygroundCapHit).toHaveBeenCalledWith({}, USER);
    expect(handleChatStream).not.toHaveBeenCalled();
  });

  it("counts an internal account's run but never refuses it", async () => {
    // Dogfooding is the only sustained use this surface has, so a live
    // allowance would interrupt our own testing long before it met a
    // customer. Counted, not capped: the counter still has to move or the
    // allowance stops being readable for the people using it most.
    capExempt.mockResolvedValue(true);
    claimAgentRun.mockResolvedValue({ ok: true, used: 900, remaining: null });
    const response = await POST(post({ messages: USER_TURN }));

    expect(claimAgentRun).toHaveBeenCalledWith({}, USER, null);
    // No paywall headers, because there is no wall to report.
    expect(response.headers.get("x-playground-runs-cap")).toBeNull();
    expect(response.headers.get("x-playground-runs-remaining")).toBeNull();
    await drain(response);
  });

  it("claims and counts one message on a fresh turn", async () => {
    await drain(await POST(post({ messages: USER_TURN })));

    expect(claimAgentRun).toHaveBeenCalledWith({}, USER, RUN_CAP);
    expect(trackPlaygroundMessage).toHaveBeenCalledWith({}, USER);
  });

  it("reports the runs left on the response of the turn that spent one", async () => {
    claimAgentRun.mockResolvedValue({ ok: true, used: RUN_CAP - 3, remaining: 3 });
    const response = await POST(post({ messages: USER_TURN }));

    expect(response.headers.get("x-playground-runs-remaining")).toBe("3");
    expect(response.headers.get("x-playground-runs-cap")).toBe(String(RUN_CAP));
    await drain(response);
  });

  it("reports the quota even when the turn suspends and never emits `finish`", async () => {
    // The reason this is a HEADER and not part of the finish payload: a turn
    // gated on a write stops at the approval request, so a stream that legally
    // never finishes must still be able to say the user is out of runs.
    claimAgentRun.mockResolvedValue({ ok: true, used: RUN_CAP, remaining: 0 });
    handleChatStream.mockResolvedValue(
      chunkStream([
        { type: "start" },
        { type: "tool-input-available", toolCallId: "call-1", toolName: "gws-mcp__docs_create", input: {} },
        { type: "tool-approval-request", toolCallId: "call-1", approvalId: "run::call-1" },
      ])
    );
    const response = await POST(post({ messages: USER_TURN }));

    expect(response.headers.get("x-playground-runs-remaining")).toBe("0");
    const chunks = await drain(response);
    expect(chunks.some((c) => c.type === "finish")).toBe(false);
  });

  it("reports no quota on an approval decision, which spends nothing", async () => {
    const response = await POST(post({ messages: approvalTurn(USER) }));

    expect(response.headers.get("x-playground-runs-remaining")).toBeNull();
    expect(response.headers.get("x-playground-runs-cap")).toBeNull();
    await drain(response);
  });

  it("claims nothing on an approval decision — it continues a paid turn", async () => {
    await drain(await POST(post({ messages: approvalTurn(USER) })));

    expect(claimAgentRun).not.toHaveBeenCalled();
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
    expect(refundAgentRun).toHaveBeenCalledWith({}, USER);
  });

  it("refunds when the stream fails having delivered only bookkeeping", async () => {
    // `start` is enqueued before the model is even called, so a turn that
    // fails right after it has produced nothing the user can see.
    handleChatStream.mockResolvedValue(failingStream([{ type: "start" }]));
    const chunks = await drain(await POST(post({ messages: USER_TURN })));

    expect(chunks.some((c) => c.type === "error")).toBe(true);
    expect(refundAgentRun).toHaveBeenCalledWith({}, USER);
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
    expect(refundAgentRun).not.toHaveBeenCalled();
  });

  it("does NOT refund an aborted request, however early it died", async () => {
    const controller = new AbortController();
    controller.abort();
    handleChatStream.mockResolvedValue(failingStream([{ type: "start" }]));
    await drain(await POST(post({ messages: USER_TURN }, { signal: controller.signal })));

    // Otherwise "POST a large history, abort at once" is a free loop: real
    // provider input tokens burned while the cap never moves.
    expect(refundAgentRun).not.toHaveBeenCalled();
  });

  it("never refunds on an approval decision — no claim was made to undo", async () => {
    handleChatStream.mockRejectedValue(new Error("nope"));
    await POST(post({ messages: approvalTurn(USER) }));

    expect(refundAgentRun).not.toHaveBeenCalled();
  });
});

describe("POST /api/playground/chat — metering taps", () => {
  it("does NOT meter tool calls from the route", async () => {
    // Metering moved to the tool's own execute wrapper (mastra/mcp/client.ts),
    // which can see the connector, the account and the real duration. This
    // vantage point cannot, and it produced rows that were permanently null
    // and zero in a customer-facing table.
    //
    // The assertion is that the route stays out of it: re-adding a tap here
    // would not replace that metering, it would DOUBLE it, and a double count
    // is invisible in aggregate until someone reconciles a bill.
    handleChatStream.mockResolvedValue(
      chunkStream([
        { type: "start" },
        { type: "tool-input-available", toolCallId: "c1", toolName: "gws-mcp__docs_get", input: {} },
        { type: "tool-output-available", toolCallId: "c1", output: "ok" },
        { type: "finish" },
      ])
    );
    await drain(await POST(post({ messages: USER_TURN })));

    expect(trackToolCall).not.toHaveBeenCalled();
  });

  it("still records that a gated write was shown to the user", async () => {
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

    // A declined write never executes, so it is never metered — that property
    // now holds by construction rather than by this tap being careful.
    expect(trackToolCall).not.toHaveBeenCalled();
    expect(trackPlaygroundConfirm).toHaveBeenCalledWith({}, USER, "shown", 1);
  });
});
