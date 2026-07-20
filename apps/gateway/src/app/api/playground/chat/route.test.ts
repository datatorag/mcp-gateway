import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({
  getSessionUserId: () => getSessionUserId(),
}));

const getPlaygroundLlm = vi.fn();
vi.mock("@/lib/llm", () => ({
  getPlaygroundLlm: () => getPlaygroundLlm(),
}));

const getEnv = vi.fn();
vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => getEnv(),
}));

const claimPlaygroundMessage = vi.fn();
const refundPlaygroundMessage = vi.fn();
vi.mock("@/gateway/playground/cap", () => ({
  claimPlaygroundMessage: (...args: unknown[]) => claimPlaygroundMessage(...args),
  refundPlaygroundMessage: (...args: unknown[]) => refundPlaygroundMessage(...args),
}));

const listUserEngineTools = vi.fn();
const executeUserTool = vi.fn();
vi.mock("@/gateway/playground/tools", () => ({
  listUserEngineTools: (...args: unknown[]) => listUserEngineTools(...args),
  executeUserTool: (...args: unknown[]) => executeUserTool(...args),
}));

const runPlaygroundTurn = vi.fn();
vi.mock("@/gateway/playground/engine", () => ({
  runPlaygroundTurn: (...args: unknown[]) => runPlaygroundTurn(...args),
}));

const trackPlaygroundMessage = vi.fn();
const trackPlaygroundToolCall = vi.fn();
const trackPlaygroundCapHit = vi.fn();
vi.mock("@/gateway/track", () => ({
  trackPlaygroundMessage: (...args: unknown[]) => trackPlaygroundMessage(...args),
  trackPlaygroundToolCall: (...args: unknown[]) => trackPlaygroundToolCall(...args),
  trackPlaygroundCapHit: (...args: unknown[]) => trackPlaygroundCapHit(...args),
}));

vi.mock("@/lib/db", () => ({ db: {} }));

import { POST } from "./route";

function chatRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/playground/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = { messages: [{ role: "user", content: "hi" }] };

describe("POST /api/playground/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionUserId.mockResolvedValue("user-1");
    getEnv.mockReturnValue({ PLAYGROUND_MESSAGE_CAP: 20, PLAYGROUND_MODEL: "claude-sonnet-5" });
    claimPlaygroundMessage.mockResolvedValue(true);
    listUserEngineTools.mockResolvedValue([]);
    getPlaygroundLlm.mockReturnValue({ messages: { create: vi.fn() } });
    runPlaygroundTurn.mockImplementation(async ({ emit }) => {
      emit({ type: "done", stopReason: "end_turn" });
    });
    trackPlaygroundMessage.mockResolvedValue(undefined);
    trackPlaygroundToolCall.mockResolvedValue(undefined);
    trackPlaygroundCapHit.mockResolvedValue(undefined);
    refundPlaygroundMessage.mockResolvedValue(undefined);
  });

  it("401s without a session", async () => {
    getSessionUserId.mockResolvedValue(null);
    const res = await POST(chatRequest(validBody));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("403s when the playground is disabled (no LLM configured)", async () => {
    getPlaygroundLlm.mockReturnValue(null);
    const res = await POST(chatRequest(validBody));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "playground_disabled" });
  });

  it("400s on an empty messages body", async () => {
    const res = await POST(chatRequest({ messages: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Bad request" });
  });

  it("400s when the last turn is not from the user", async () => {
    const res = await POST(
      chatRequest({ messages: [{ role: "assistant", content: "hi" }] })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Bad request" });
  });

  it("400s on unparseable JSON", async () => {
    const req = new NextRequest("http://localhost/api/playground/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("429s with cap_exceeded when the claim fails", async () => {
    claimPlaygroundMessage.mockResolvedValue(false);
    const res = await POST(chatRequest(validBody));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "cap_exceeded", cap: 20 });
    expect(trackPlaygroundCapHit).toHaveBeenCalledWith({}, "user-1");
    expect(runPlaygroundTurn).not.toHaveBeenCalled();
  });

  it("returns a text/event-stream response on the happy path", async () => {
    const res = await POST(chatRequest(validBody));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(trackPlaygroundMessage).toHaveBeenCalledWith({}, "user-1");
    // Drain the stream so the async start() body runs to completion.
    const text = await res.text();
    expect(text).toContain('"type":"done"');
    expect(runPlaygroundTurn).toHaveBeenCalledTimes(1);
  });

  it("refunds the claim when listUserEngineTools fails before streaming", async () => {
    listUserEngineTools.mockRejectedValue(new Error("db down"));
    const res = await POST(chatRequest(validBody));
    expect(res.status).toBe(500);
    expect(refundPlaygroundMessage).toHaveBeenCalledWith({}, "user-1");
  });

  it("refunds the claim on engine-level failure during streaming (no work delivered)", async () => {
    // Provider fails before a single event reaches the client — the outage
    // case the refund exists for.
    runPlaygroundTurn.mockRejectedValue(new Error("anthropic outage"));
    const res = await POST(chatRequest(validBody));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain("anthropic outage");
    expect(refundPlaygroundMessage).toHaveBeenCalledWith({}, "user-1");
  });

  it("does NOT refund when the engine throws after work was already delivered", async () => {
    // e.g. Anthropic tokens were spent and text was already streamed before
    // a later failure (including a client abort surfacing as a throw).
    runPlaygroundTurn.mockImplementation(async ({ emit }) => {
      emit({ type: "text", text: "partial answer" });
      throw new Error("stream interrupted");
    });
    const res = await POST(chatRequest(validBody));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"text"');
    expect(refundPlaygroundMessage).not.toHaveBeenCalled();
  });

  it("does NOT refund when the client aborts mid-stream (enqueue throws on a closed controller)", async () => {
    let releaseEngine!: () => void;
    const engineReleased = new Promise<void>((resolve) => {
      releaseEngine = resolve;
    });
    let capturedShouldStop: (() => boolean) | undefined;

    runPlaygroundTurn.mockImplementation(async ({ emit, shouldStop }) => {
      capturedShouldStop = shouldStop;
      emit({ type: "text", text: "first" }); // succeeds — client still attached
      await engineReleased;
      // By now the client has aborted; this enqueue throws on the closed
      // controller. The route's emit() wrapper must swallow it (clientGone)
      // rather than letting it propagate as the "genuine failure" path.
      emit({ type: "text", text: "second" });
      throw new Error("should not cause a refund");
    });

    const res = await POST(chatRequest(validBody));
    const reader = res.body!.getReader();
    await reader.read(); // consume the "first" event
    await reader.cancel(); // simulate AbortController.abort() from the client

    releaseEngine();
    // Let the route's async start()/catch finish running.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refundPlaygroundMessage).not.toHaveBeenCalled();

    // The route must wire a shouldStop callback into the engine so the loop
    // (and any pending tool execution) actually halts on abort — not just
    // the refund gate. We can't observe the real engine loop through this
    // mock, but we can prove the route passes a working predicate and that
    // it reports "stopped" once the client has gone away (clientGone was
    // set by the failed enqueue of "second" above).
    expect(typeof capturedShouldStop).toBe("function");
    expect(capturedShouldStop!()).toBe(true);
  });
});
