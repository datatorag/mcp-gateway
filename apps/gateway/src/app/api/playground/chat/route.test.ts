import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({
  getSessionUserId: () => getSessionUserId(),
}));

const getPlaygroundModel = vi.fn();
vi.mock("@/lib/llm", () => ({
  getPlaygroundModel: () => getPlaygroundModel(),
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

// history.ts is NOT mocked — it's a pure function with no external deps, so
// the 400 "Bad request" contract is exercised against the real
// buildModelHistory, on real UIMessage-shaped ({ role, parts }) bodies.

const streamEngineTurn = vi.fn();
const detectPause = vi.fn();
const executeWriteBatch = vi.fn();
// `isApproved` is NOT mocked — like `buildModelHistory` above, it's a pure
// function with no external deps, and the route's `anyApproved` computation
// (exercised below) is meant to run against its real deny-by-default logic.
vi.mock("@/gateway/playground/engine", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/gateway/playground/engine")>();
  return {
    ...actual,
    streamEngineTurn: (...args: unknown[]) => streamEngineTurn(...args),
    detectPause: (...args: unknown[]) => detectPause(...args),
    executeWriteBatch: (...args: unknown[]) => executeWriteBatch(...args),
  };
});

const putPending = vi.fn();
const takePending = vi.fn();
vi.mock("@/gateway/playground/pending", () => ({
  putPending: (...args: unknown[]) => putPending(...args),
  takePending: (...args: unknown[]) => takePending(...args),
}));

const trackPlaygroundMessage = vi.fn();
const trackPlaygroundToolCall = vi.fn();
const trackPlaygroundCapHit = vi.fn();
const trackPlaygroundConfirm = vi.fn();
vi.mock("@/gateway/track", () => ({
  trackPlaygroundMessage: (...args: unknown[]) => trackPlaygroundMessage(...args),
  trackPlaygroundToolCall: (...args: unknown[]) => trackPlaygroundToolCall(...args),
  trackPlaygroundCapHit: (...args: unknown[]) => trackPlaygroundCapHit(...args),
  trackPlaygroundConfirm: (...args: unknown[]) => trackPlaygroundConfirm(...args),
}));

vi.mock("@/lib/db", () => ({ db: {} }));

import { POST } from "./route";

function chatRequest(body: unknown, init?: { signal?: AbortSignal }): NextRequest {
  return new NextRequest("http://localhost/api/playground/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: init?.signal,
  });
}

// UIMessage-shaped body matching buildModelHistory's real contract
// ({ role, parts: [{ type: "text", text }] }) — the successor of the old
// client's flat { role, content } shape.
const validBody = { messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] };

type FakeChunk = { type: string; [key: string]: unknown };

/** Turns an array of UIMessage-stream-chunk-shaped objects into a real
 * ReadableStream, standing in for `StreamTextResult#toUIMessageStream()`. */
function chunkStream(chunks: FakeChunk[]): ReadableStream<FakeChunk> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

/** Minimal stand-in for the `StreamTextResult` the route consumes — only
 * `toUIMessageStream()` is called on it (detectPause is mocked separately
 * and never inspects this object for real). Ignores whatever options the
 * route passes (e.g. the `onError` added for finding 4) — irrelevant to a
 * fake source that never errors. */
function fakeResult(chunks: FakeChunk[]) {
  return { toUIMessageStream: () => chunkStream(chunks) };
}

/** Same idea as `chunkStream`, but pull-based with a per-chunk delay so the
 * route's internal write loop paces itself in real time instead of draining
 * synchronously — giving a test a real window to read the first chunk off
 * the response and cancel mid-stream, the way an actual client disconnect
 * would land partway through a turn. */
function slowChunkStream(chunks: FakeChunk[], delayMs: number): ReadableStream<FakeChunk> {
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      controller.enqueue(chunks[i++]);
    },
  });
}

/** Parses the SSE body back into the UI-message chunks the route wrote, so a
 * test can assert on chunk shape/order instead of substring-matching JSON. */
function sseChunks(body: string): FakeChunk[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .filter((payload) => payload !== "[DONE]")
    .map((payload) => JSON.parse(payload) as FakeChunk);
}

const START: FakeChunk = { type: "start" };
const FINISH: FakeChunk = { type: "finish", finishReason: "stop" };

// A real content turn: start/finish bookkeeping bracketing an actual
// text-delta — the shape the refund tap must recognize as "delivered".
const textChunks = (text: string): FakeChunk[] => [
  START,
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: text },
  { type: "text-end", id: "t1" },
  FINISH,
];

describe("POST /api/playground/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionUserId.mockResolvedValue("user-1");
    getEnv.mockReturnValue({ PLAYGROUND_MESSAGE_CAP: 20 });
    getPlaygroundModel.mockReturnValue({ modelId: "fake-model" });
    claimPlaygroundMessage.mockResolvedValue(true);
    listUserEngineTools.mockResolvedValue({ tools: [], isWrite: () => false });
    executeUserTool.mockResolvedValue({ text: "ok", isError: false });
    streamEngineTurn.mockImplementation(() => fakeResult(textChunks("hi there")));
    detectPause.mockResolvedValue(null);
    executeWriteBatch.mockResolvedValue({
      toolMessage: { role: "tool", content: [] },
      outcomes: [],
    });
    putPending.mockReturnValue("resume-token-abc");
    takePending.mockReturnValue(null);
    trackPlaygroundMessage.mockResolvedValue(undefined);
    trackPlaygroundToolCall.mockResolvedValue(undefined);
    trackPlaygroundCapHit.mockResolvedValue(undefined);
    trackPlaygroundConfirm.mockResolvedValue(undefined);
    refundPlaygroundMessage.mockResolvedValue(undefined);
  });

  it("401s without a session", async () => {
    getSessionUserId.mockResolvedValue(null);
    const res = await POST(chatRequest(validBody));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("403s when the playground is disabled (no model configured)", async () => {
    getPlaygroundModel.mockReturnValue(null);
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
      chatRequest({ messages: [{ role: "assistant", parts: [{ type: "text", text: "hi" }] }] })
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
    expect(streamEngineTurn).not.toHaveBeenCalled();
  });

  it("returns a UI message stream (text/event-stream) response on the happy path", async () => {
    const res = await POST(chatRequest(validBody));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(trackPlaygroundMessage).toHaveBeenCalledWith({}, "user-1");
    // Drain the stream so the async execute() body runs to completion.
    const text = await res.text();
    expect(text).toContain('"type":"text-delta"');
    expect(text).toContain("hi there");
    expect(streamEngineTurn).toHaveBeenCalledTimes(1);
  });

  it("threads request.signal into EngineDeps.abortSignal on the fresh-turn path", async () => {
    const res = await POST(chatRequest(validBody));
    await res.text();
    const deps = streamEngineTurn.mock.calls[0][0];
    expect(deps.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("wires executeTool to track-then-execute (covers reads and, identically, approved writes)", async () => {
    const res = await POST(chatRequest(validBody));
    await res.text();
    const deps = streamEngineTurn.mock.calls[0][0];
    await deps.executeTool("gws-mcp__gmail_search", { q: "x" });
    expect(trackPlaygroundToolCall).toHaveBeenCalledWith({}, "user-1", "gws-mcp__gmail_search");
    expect(executeUserTool).toHaveBeenCalledWith({}, "user-1", "gws-mcp__gmail_search", { q: "x" });
  });

  it("refunds the claim when listUserEngineTools fails before streaming", async () => {
    listUserEngineTools.mockRejectedValue(new Error("db down"));
    const res = await POST(chatRequest(validBody));
    expect(res.status).toBe(500);
    expect(refundPlaygroundMessage).toHaveBeenCalledWith({}, "user-1");
  });

  it("refunds the claim when the turn fails before any real content is delivered", async () => {
    // Only bookkeeping chunks reach the writer (no text/tool activity), then
    // the turn fails — the provider-outage case the refund tap exists for.
    streamEngineTurn.mockImplementation(() => fakeResult([START]));
    detectPause.mockRejectedValue(new Error("anthropic outage"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(chatRequest(validBody));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"error"');
    // The raw provider message must never reach the client (SEC-7) — it's
    // logged server-side and replaced with a generic message.
    expect(text).not.toContain("anthropic outage");
    expect(text).toContain("Something went wrong");
    expect(errSpy).toHaveBeenCalled();
    expect(refundPlaygroundMessage).toHaveBeenCalledWith({}, "user-1");
    errSpy.mockRestore();
  });

  // The next two cases pin BOTH timings of "the client aborted, then the
  // turn failed" — after real content, and before any content at all. They
  // deliberately agree (neither refunds): a client abort never refunds,
  // regardless of when it lands. That's a product decision, not an
  // oversight — see the `!request.signal.aborted` comment in route.ts. The
  // `!delivered` branch alone already covers "after content" (tokens were
  // genuinely spent); the abort exclusion specifically closes the "before
  // content" loophole (abort immediately after the request is sent, before
  // a single output token, to farm free-but-not-really-free provider calls
  // against the user's cap without ever decrementing it).

  it("does NOT refund when the turn fails after real content was already delivered", async () => {
    // e.g. tokens were spent and text was already streamed (a client abort
    // mid-generation would surface the same way: content first, failure
    // after) before a later failure.
    streamEngineTurn.mockImplementation(() => fakeResult(textChunks("partial answer")));
    detectPause.mockRejectedValue(new Error("stream interrupted"));
    const res = await POST(chatRequest(validBody));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"text-delta"');
    expect(text).toContain("partial answer");
    expect(text).toContain('"type":"error"');
    expect(refundPlaygroundMessage).not.toHaveBeenCalled();
  });

  it("does NOT refund when the client aborts BEFORE any content is delivered", async () => {
    // The DoS-shaped loophole this exists to close: POST a large history,
    // abort as soon as headers return — before a single content chunk —
    // and (pre-fix) the cap claim would be refunded every time, letting an
    // authenticated user loop that indefinitely while real provider input
    // tokens (the full prompt + tool list) are still spent. The abort here
    // is a REAL AbortSignal firing (not just "the engine happened to
    // throw"), landing before any content reaches the tap.
    const controller = new AbortController();
    const req = chatRequest(validBody, { signal: controller.signal });
    streamEngineTurn.mockImplementation(() => {
      // Simulates the client disconnecting right as the turn starts.
      controller.abort();
      return fakeResult([START]); // zero content chunks reach the tap
    });
    detectPause.mockRejectedValue(new Error("aborted"));
    const res = await POST(req);
    await res.text();
    expect(refundPlaygroundMessage).not.toHaveBeenCalled();
  });

  it("does NOT refund on a turn that completes with only bookkeeping chunks and no error", async () => {
    // Degenerate but non-failing case (e.g. the model produced nothing):
    // no refund is warranted because nothing THREW — refunds are only for
    // genuine failures, not "the model said nothing".
    streamEngineTurn.mockImplementation(() => fakeResult([START, FINISH]));
    const res = await POST(chatRequest(validBody));
    await res.text();
    expect(refundPlaygroundMessage).not.toHaveBeenCalled();
  });

  it("client disconnect mid-stream: no error escapes the route, and refund fires at most once", async () => {
    // A slow, pull-based source so the write loop paces itself in real time,
    // giving this test a genuine window to read the first chunk off the
    // response and cancel before the (mocked) turn has finished producing —
    // unlike the other tests, which drain the whole response synchronously.
    streamEngineTurn.mockImplementation(() => ({
      toUIMessageStream: () => slowChunkStream(textChunks("a longer streamed reply"), 15),
    }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(chatRequest(validBody));
    const reader = res.body!.getReader();
    await reader.read(); // consume the first SSE chunk — response has started
    await reader.cancel(); // simulate the client disconnecting mid-stream

    // The internal write loop keeps running against the now-torn-down
    // response controller (createUIMessageStream's own `safeEnqueue` is
    // documented to swallow those writes) until the mocked turn finishes —
    // give it time to do so, and to hit anything that would throw.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const turnFailedLogged = errSpy.mock.calls.some(
      ([msg]) => typeof msg === "string" && msg.includes("[playground] turn failed")
    );
    expect(turnFailedLogged).toBe(false);
    expect(refundPlaygroundMessage.mock.calls.length).toBeLessThanOrEqual(1);
    errSpy.mockRestore();
  });

  it("stores the paused turn and emits a data-confirm part when the engine awaits confirmation", async () => {
    const pausedMessages = [{ role: "assistant", content: [] }];
    const pending = [{ id: "w_1", name: "gws-mcp__gmail_send", input: { to: "a@b.com" } }];
    streamEngineTurn.mockImplementation(() => fakeResult(textChunks("let me check")));
    detectPause.mockResolvedValue({ messages: pausedMessages, pending });

    const res = await POST(chatRequest(validBody));
    const text = await res.text();

    expect(putPending).toHaveBeenCalledWith("user-1", pausedMessages, pending);
    expect(text).toContain('"type":"data-confirm"');
    expect(text).toContain("resume-token-abc");
    expect(text).toContain("gws-mcp__gmail_send");
    expect(trackPlaygroundConfirm).toHaveBeenCalledWith({}, "user-1", "shown", 1);
  });

  it("resume: does NOT claim a message, runs the write batch, and continues with a second turn", async () => {
    takePending.mockReturnValue({
      userId: "user-1",
      messages: [{ role: "assistant", content: [] }],
      writes: [{ id: "w_1", name: "gws-mcp__gmail_send", input: {} }],
      createdAt: 0,
    });
    executeWriteBatch.mockResolvedValue({
      toolMessage: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "w_1",
            toolName: "gws-mcp__gmail_send",
            output: { type: "text", value: "sent" },
          },
        ],
      },
      outcomes: [{ name: "gws-mcp__gmail_send", isError: false, denied: false }],
    });
    streamEngineTurn.mockImplementation(() => fakeResult(textChunks("done")));

    const res = await POST(
      chatRequest({ resumeToken: "resume-token-abc", decisions: { w_1: "approve" } })
    );
    const text = await res.text();

    expect(claimPlaygroundMessage).not.toHaveBeenCalled();
    expect(trackPlaygroundMessage).not.toHaveBeenCalled();
    expect(takePending).toHaveBeenCalledWith("user-1", "resume-token-abc");
    expect(executeWriteBatch).toHaveBeenCalledTimes(1);
    expect(executeWriteBatch).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
      [{ id: "w_1", name: "gws-mcp__gmail_send", input: {} }],
      { w_1: "approve" }
    );
    expect(trackPlaygroundConfirm).toHaveBeenCalledWith({}, "user-1", "approved", 1);
    expect(text).toContain('"type":"data-write-outcome"');
    expect(text).toContain('"type":"text-delta"');
    expect(text).toContain("done");
    // The follow-up turn runs against pending.messages + the write outcome
    // tool message, not a fresh cap claim's history.
    expect(streamEngineTurn).toHaveBeenCalledTimes(1);
  });

  it("resume: tracks confirm as 'denied' when no write was approved, and never refunds (no claim was made)", async () => {
    takePending.mockReturnValue({
      userId: "user-1",
      messages: [{ role: "assistant", content: [] }],
      writes: [{ id: "w_1", name: "gws-mcp__gmail_send", input: {} }],
      createdAt: 0,
    });
    const res = await POST(
      chatRequest({ resumeToken: "resume-token-abc", decisions: { w_1: "deny" } })
    );
    await res.text();
    expect(trackPlaygroundConfirm).toHaveBeenCalledWith({}, "user-1", "denied", 1);
    expect(refundPlaygroundMessage).not.toHaveBeenCalled();
  });

  it("resume: emits a terminal tool chunk for EVERY pending write, approved and denied", async () => {
    // `streamText` enqueues the tool-call chunk before it checks
    // `tool.execute != null`, so a gated write already reached the client as
    // a `dynamic-tool` part in state `input-available` ("Running", pulsing
    // clock). The route — not the SDK — executes these, so the route is what
    // has to close them out; without this the card spins forever, including
    // after a Deny.
    takePending.mockReturnValue({
      userId: "user-1",
      messages: [{ role: "assistant", content: [] }],
      writes: [
        { id: "w_ok", name: "gws-mcp__gmail_send", input: {} },
        { id: "w_no", name: "gws-mcp__docs_create", input: {} },
      ],
      createdAt: 0,
    });
    executeWriteBatch.mockResolvedValue({
      toolMessage: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "w_ok",
            toolName: "gws-mcp__gmail_send",
            output: { type: "text", value: "sent" },
          },
          {
            type: "tool-result",
            toolCallId: "w_no",
            toolName: "gws-mcp__docs_create",
            output: { type: "error-text", value: "User declined this action." },
          },
        ],
      },
      outcomes: [
        { name: "gws-mcp__gmail_send", isError: false, denied: false },
        { name: "gws-mcp__docs_create", isError: true, denied: true },
      ],
    });

    const res = await POST(
      chatRequest({ resumeToken: "resume-token-abc", decisions: { w_ok: "approve" } })
    );
    const chunks = sseChunks(await res.text());

    // Approved write → output-available, carrying the real tool output.
    expect(chunks).toContainEqual({
      type: "tool-output-available",
      toolCallId: "w_ok",
      output: "sent",
    });
    // Denied write → output-denied, so the card lands on "Denied" (orange),
    // not "Running" and not a red "Error" — the user pressed Deny, nothing
    // failed. The chunk carries no message by design; the reason is conveyed
    // by the badge plus the data-write-outcome row asserted below.
    expect(chunks).toContainEqual({
      type: "tool-output-denied",
      toolCallId: "w_no",
    });
    expect(chunks.some((c) => c.type === "tool-output-error")).toBe(false);
    // Every pending write is accounted for — none left dangling.
    const terminal = chunks.filter(
      (c) =>
        c.type === "tool-output-available" ||
        c.type === "tool-output-error" ||
        c.type === "tool-output-denied"
    );
    expect(terminal.map((c) => c.toolCallId)).toEqual(["w_ok", "w_no"]);
    // The badge stream the client renders separately is untouched.
    expect(chunks.some((c) => c.type === "data-write-outcome")).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Resume continues the SAME assistant message (no duplicate render)
  //
  // Manual e2e caught this: after Deny, the tool card, the "Action denied"
  // line and the write-outcome badges rendered TWICE, in two separate
  // assistant messages. Cause: `createUIMessageStream` injects a freshly
  // generated `messageId` onto the `start` chunk (ai@6.0.235 dist/index.js
  // :8977 -> :6397-6412). Client-side that id lands in
  // `state.message.id` (:6309-6311) and `AbstractChat.makeRequest`'s
  // `write()` compares it against `lastMessage.id` to pick `replaceMessage`
  // vs `pushMessage` (:14003-14011) — a different id pushes a SECOND
  // message that was structuredClone'd from the paused one, so every part
  // it already had renders again.
  //
  // Three static review passes predicted this mechanism and then concluded
  // it wasn't triggered, by reasoning from `toUIMessageStream` (which
  // really does stay silent without `generateMessageId`) and missing the
  // outer `createUIMessageStream`. So these assert on the REAL stream and
  // the REAL client, never on the SDK source.

  it("resume: the start chunk carries NO message id, so the client cannot pushMessage", async () => {
    takePending.mockReturnValue({
      userId: "user-1",
      messages: [{ role: "assistant", content: [] }],
      writes: [{ id: "w_no", name: "gws-mcp__docs_create", input: {} }],
      createdAt: 0,
    });
    executeWriteBatch.mockResolvedValue({
      toolMessage: { role: "tool", content: [] },
      outcomes: [{ name: "gws-mcp__docs_create", isError: true, denied: true }],
    });
    streamEngineTurn.mockImplementation(() => fakeResult(textChunks("declined")));

    const res = await POST(
      chatRequest({ resumeToken: "resume-token-abc", decisions: { w_no: "deny" } })
    );
    const chunks = sseChunks(await res.text());

    const starts = chunks.filter((c) => c.type === "start");
    expect(starts).toHaveLength(1);
    // Absent — NOT merely different. A present-but-different id is exactly
    // the bug; a present-and-equal id would only be safe if the server knew
    // the paused message's id, and it deliberately does not (see the
    // security note in route.ts: the resume body carries the token and the
    // decisions, nothing else).
    expect(starts[0]).not.toHaveProperty("messageId");

    // Full order, so a regression that reintroduces an id — or reorders the
    // terminal tool chunk / badge row that must precede the continuation —
    // is caught here rather than in manual testing.
    expect(chunks).toEqual([
      { type: "tool-output-denied", toolCallId: "w_no" },
      {
        type: "data-write-outcome",
        data: { outcomes: [{ name: "gws-mcp__docs_create", isError: true, denied: true }] },
      },
      { type: "start" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "declined" },
      { type: "text-end", id: "t1" },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  it("fresh turn: the start chunk DOES carry a message id, so each turn is its own message", async () => {
    // The other half of the contract — the fix is resume-only.
    const res = await POST(chatRequest(validBody));
    const chunks = sseChunks(await res.text());
    const start = chunks.find((c) => c.type === "start");
    expect(start).toBeDefined();
    expect(typeof start!.messageId).toBe("string");
    expect(start!.messageId).not.toBe("");
  });

  it("resume: the real SDK client appends into the paused message instead of pushing a duplicate", async () => {
    // End-to-end at the client level, since the browser session can't be
    // driven from here: a real `Chat` (the class `useChat` wraps) seeded
    // with a paused assistant message, talking to the real route over the
    // real DefaultChatTransport, with the same `prepareSendMessagesRequest`
    // shape playground.tsx uses. Asserts what the DOM would show — how many
    // assistant messages exist and which parts each one carries.
    const { Chat } = await import("@ai-sdk/react");
    const { DefaultChatTransport } = await import("ai");

    takePending.mockReturnValue({
      userId: "user-1",
      messages: [{ role: "assistant", content: [] }],
      writes: [{ id: "w_no", name: "gws-mcp__docs_create", input: {} }],
      createdAt: 0,
    });
    executeWriteBatch.mockResolvedValue({
      toolMessage: { role: "tool", content: [] },
      outcomes: [{ name: "gws-mcp__docs_create", isError: true, denied: true }],
    });
    streamEngineTurn.mockImplementation(() =>
      fakeResult(textChunks("I attempted to create the Google Doc"))
    );

    const pending = [{ id: "w_no", name: "gws-mcp__docs_create", input: {} }];
    const chat = new Chat({
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "make a doc" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "step-start" },
            {
              type: "dynamic-tool",
              toolName: "gws-mcp__docs_create",
              toolCallId: "w_no",
              state: "input-available",
              input: {},
            },
            {
              type: "data-confirm",
              data: { resumeToken: "resume-token-abc", pending },
            },
          ],
        },
      ],
      transport: new DefaultChatTransport({
        api: "http://localhost/api/playground/chat",
        fetch: (async (_url: unknown, init: { body?: unknown }) =>
          POST(chatRequest(JSON.parse(String(init.body))))) as never,
        prepareSendMessagesRequest: ({ body }: { body?: Record<string, unknown> }) => ({
          body: { resumeToken: body?.resumeToken, decisions: body?.decisions },
        }),
      }),
      // Mirrors playground.tsx's resolveConfirm: no user message is appended.
    } as never);

    await chat.sendMessage(undefined, {
      body: { resumeToken: "resume-token-abc", decisions: { w_no: "deny" } },
    });

    // Two messages, not three: the continuation replaced `a1` in place.
    expect(chat.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    // And `a1` holds ONE of each part — the duplicate render was a second
    // message carrying a clone of exactly these.
    expect(chat.messages[1].parts.map((p) => p.type)).toEqual([
      "step-start",
      "dynamic-tool",
      "data-confirm",
      "data-write-outcome",
      "text",
    ]);
  });

  it("resume with an unknown/expired token emits an error and never resumes", async () => {
    takePending.mockReturnValue(null);
    const res = await POST(
      chatRequest({ resumeToken: "gone", decisions: { w_1: "approve" } })
    );
    const text = await res.text();

    expect(executeWriteBatch).not.toHaveBeenCalled();
    expect(streamEngineTurn).not.toHaveBeenCalled();
    expect(text).toContain('"type":"error"');
    expect(text).toContain("This confirmation expired — please run the prompt again.");
  });
});
