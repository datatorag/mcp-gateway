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

import { FREE_MONTHLY_AGENT_RUNS as RUN_CAP, planLimits } from "@/gateway/billing/plans";
import {
  RunTokenCeilingError,
  RUN_CEILING_MESSAGE,
} from "@/mastra/run-token-budget";

const claimAgentRun = vi.fn();
const capExempt = vi.fn();
const refundAgentRun = vi.fn();
vi.mock("@/gateway/usage/period", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/gateway/usage/period")>()),
  claimAgentRun: (...args: unknown[]) => claimAgentRun(...args),
  capExempt: (...args: unknown[]) => capExempt(...args),
  refundAgentRun: (...args: unknown[]) => refundAgentRun(...args),
}));

/** SCRUM-251: the route reads the run's weighted total between steps. The
 * rest of the module (the ceiling error, its message) stays real. */
const runTokensUsed = vi.fn((_runId: string): number => 0);
vi.mock("@/mastra/run-token-budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/mastra/run-token-budget")>()),
  runTokensUsed: (runId: string) => runTokensUsed(runId),
}));

const trackPlaygroundMessage = vi.fn();
const trackPlaygroundCapHit = vi.fn();
const trackPlaygroundConfirm = vi.fn();
const trackPlaygroundRunCeilingHit = vi.fn();
const trackAgentRun = vi.fn();
const trackToolCall = vi.fn();
vi.mock("@/gateway/track", () => ({
  trackPlaygroundMessage: (...a: unknown[]) => trackPlaygroundMessage(...a),
  trackPlaygroundCapHit: (...a: unknown[]) => trackPlaygroundCapHit(...a),
  trackPlaygroundConfirm: (...a: unknown[]) => trackPlaygroundConfirm(...a),
  trackPlaygroundRunCeilingHit: (...a: unknown[]) =>
    trackPlaygroundRunCeilingHit(...a),
  trackAgentRun: (...a: unknown[]) => trackAgentRun(...a),
  trackToolCall: (...a: unknown[]) => trackToolCall(...a),
}));

/** The route reads users.plan for the plan-aware run allowance (SCRUM-84);
 * the db mock answers exactly that select chain and nothing else. The
 * reference to `planRows` stays inside an arrow, same deferral as every
 * other hoisted mock in this file. */
const planRows = vi.fn();
vi.mock("@/lib/db", () => {
  const chain = {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => planRows() }) }),
    }),
  };
  return { db: chain, getDb: () => chain };
});

/** SCRUM-240: the run message carries the user's accounts, and the route
 * recomputes it from the same rows. Empty by default so the existing
 * skill-run cases keep building the message with no accounts. */
const listConnectedAccounts = vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []);
vi.mock("@/gateway/connected-accounts", () => ({
  listConnectedAccounts: (...args: unknown[]) => listConnectedAccounts(...args),
}));

const userOwnsThread = vi.fn();
vi.mock("@/gateway/playground/threads", () => ({
  userOwnsThread: (...args: unknown[]) => userOwnsThread(...args),
  setThreadTitleIfEmpty: async () => {},
}));

vi.mock("@/mastra", () => ({
  getMastra: () => ({ mastra: true }),
  DATATORAG_AGENT_ID: "datatorag-playground",
}));

// The route only needs the context builder from the client module (SCRUM-188
// removed credential loading); the real builder is cheap and side-effect-free.

const handleChatStream = vi.fn();
vi.mock("@mastra/ai-sdk", () => ({
  handleChatStream: (...args: unknown[]) => handleChatStream(...args),
}));

import { mintRunId } from "@/gateway/playground/run-ownership";
import { USER_ID_CONTEXT_KEY } from "@/mastra/mcp/client";
import { readSkillFiles, runAccountsFrom, skillContinueMessage, skillRunMessage } from "@/lib/skills";
import { CHAT_MAX_STEPS, SKILL_RUN_MAX_STEPS } from "@/mastra/run-steps";
import { THREAD_ID_HEADER } from "@/gateway/playground/quota-headers";
import { resetRunRegistry, runStatus } from "@/gateway/playground/run-registry";
import { KEEPALIVE_INTERVAL_MS } from "./keepalive";
import { RUN_SOFT_CEILING, SKILL_RUN_EFFORT } from "@/gateway/billing/plans";
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
  runTokensUsed.mockReturnValue(0);
  getSessionUserId.mockResolvedValue(USER);
  getEnv.mockReturnValue({
    ANTHROPIC_API_KEY: "test-key",
    PLAYGROUND_MODEL: "claude-haiku-4-5",
    PLAYGROUND_MESSAGE_CAP: 20,
  });
  claimAgentRun.mockResolvedValue({ ok: true, used: 1, remaining: 24 });
  capExempt.mockResolvedValue(false);
  planRows.mockResolvedValue([{ plan: "free" }]);
  refundAgentRun.mockResolvedValue(undefined);
  handleChatStream.mockResolvedValue(chunkStream([{ type: "start" }, { type: "finish" }]));
  userOwnsThread.mockResolvedValue(true);
});


describe("resuming a conversation someone else owns", () => {
  // The by-check half of ownership, on the WRITE path. Without this the only
  // thing stopping a foreign thread being seeded into a model call and
  // appended to is a line with no test behind it, in a repo with no CI —
  // deleting that line left the whole suite green.
  it("404s, and never reaches the model or the run claim", async () => {
    userOwnsThread.mockResolvedValue(false);
    const response = await POST(
      post({ messages: USER_TURN, threadId: "someone-elses-thread" })
    );
    expect(response.status).toBe(404);
    expect(handleChatStream, "a foreign thread reached the model").not.toHaveBeenCalled();
    expect(claimAgentRun, "a foreign thread spent a run").not.toHaveBeenCalled();
  });

  it("answers a foreign thread exactly as it would an unknown one", async () => {
    // Any difference makes this endpoint an oracle for whether a given
    // conversation exists on someone else's account, which is the property the
    // read routes are careful to avoid.
    userOwnsThread.mockResolvedValue(false);
    const foreign = await POST(post({ messages: USER_TURN, threadId: "theirs" }));
    const missing = await POST(post({ messages: USER_TURN, threadId: "never-existed" }));
    expect(foreign.status).toBe(missing.status);
    expect(await foreign.text()).toBe(await missing.text());
  });

  it("proceeds normally for a thread the user does own", async () => {
    userOwnsThread.mockResolvedValue(true);
    const response = await POST(post({ messages: USER_TURN, threadId: "mine" }));
    expect(response.status).toBe(200);
    expect(handleChatStream).toHaveBeenCalled();
  });

  it("meters a resumed turn exactly like a fresh one", async () => {
    userOwnsThread.mockResolvedValue(true);
    await POST(post({ messages: USER_TURN, threadId: "mine" }));
    const resumed = claimAgentRun.mock.calls.length;
    claimAgentRun.mockClear();
    await POST(post({ messages: USER_TURN }));
    expect(claimAgentRun.mock.calls.length).toBe(resumed);
  });
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
    expect(trackPlaygroundCapHit).toHaveBeenCalledWith(expect.anything(), USER);
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

    expect(claimAgentRun).toHaveBeenCalledWith(expect.anything(), USER, null);
    // No paywall headers, because there is no wall to report.
    expect(response.headers.get("x-playground-runs-cap")).toBeNull();
    expect(response.headers.get("x-playground-runs-remaining")).toBeNull();
    await drain(response);
  });

  it("claims and counts one message on a fresh turn", async () => {
    await drain(await POST(post({ messages: USER_TURN })));

    expect(claimAgentRun).toHaveBeenCalledWith(expect.anything(), USER, RUN_CAP);
    expect(trackPlaygroundMessage).toHaveBeenCalledWith(expect.anything(), USER);
  });

  /* SCRUM-223: a skill run names its skill in the body, validated against the
   * catalogue, so the run event carries the slug and the trigger. A slug the
   * catalogue does not know is dropped, never echoed: the event must not be
   * able to claim a skill that does not exist. */
  it("stamps a valid skill slug and its trigger on the run event when the turn IS the skill's run message", async () => {
    const skill = readSkillFiles().find((s) => s.slug === "morning-brief")!;
    const turn = [{ id: "u1", role: "user", parts: [{ type: "text", text: skillRunMessage(skill) }] }];
    await drain(
      await POST(post({ messages: turn, skill: "morning-brief", skillTrigger: "manual" }))
    );
    expect(trackAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      USER,
      expect.objectContaining({ skill: "morning-brief", trigger: "manual" })
    );
  });

  it("recognises the message built with the user's own accounts, and not one built with others (SCRUM-240)", async () => {
    const skill = readSkillFiles().find((s) => s.slug === "morning-brief")!;
    const rows = [
      { connectorType: "google-workspace", accountEmail: "a@example.com", isDefault: true },
      { connectorType: "google-workspace", accountEmail: "b@example.com", isDefault: false },
    ];
    listConnectedAccounts.mockResolvedValue(rows);
    const mine = skillRunMessage(skill, runAccountsFrom(rows));
    await drain(
      await POST(post({ messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: mine }] }], skill: "morning-brief", skillTrigger: "manual" }))
    );
    expect(trackAgentRun).toHaveBeenLastCalledWith(
      expect.anything(),
      USER,
      expect.objectContaining({ skill: "morning-brief", trigger: "manual" })
    );

    const theirs = skillRunMessage(skill, runAccountsFrom([rows[0]!]));
    await drain(
      await POST(post({ messages: [{ id: "u2", role: "user", parts: [{ type: "text", text: theirs }] }], skill: "morning-brief", skillTrigger: "manual" }))
    );
    expect(trackAgentRun).toHaveBeenLastCalledWith(
      expect.anything(),
      USER,
      expect.objectContaining({ skill: null })
    );
    listConnectedAccounts.mockResolvedValue([]);
  });

  it("the exact text beside a NON-TEXT part is an ordinary turn too", async () => {
    const skill = readSkillFiles().find((s) => s.slug === "morning-brief")!;
    const turn = [
      {
        id: "u1",
        role: "user",
        parts: [
          { type: "text", text: skillRunMessage(skill) },
          { type: "file", mediaType: "text/plain", url: "data:text/plain;base64,aGk=" },
        ],
      },
    ];
    await drain(await POST(post({ messages: turn, skill: "morning-brief", skillTrigger: "manual" })));
    expect(trackAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      USER,
      expect.objectContaining({ skill: null })
    );
  });

  it("a valid slug beside ARBITRARY text is an ordinary turn: no skill, no trigger", async () => {
    // The no-gates policy is scoped to the catalogue's own run message. A
    // caller naming a real skill next to text of their own gets the gated
    // turn everyone gets.
    await drain(
      await POST(post({ messages: USER_TURN, skill: "morning-brief", skillTrigger: "manual" }))
    );
    expect(trackAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      USER,
      expect.objectContaining({ skill: null })
    );
  });

  it("drops an unknown skill slug and a foreign trigger value", async () => {
    await drain(
      await POST(post({ messages: USER_TURN, skill: "no-such-skill", skillTrigger: "cron" }))
    );
    expect(trackAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      USER,
      expect.objectContaining({ skill: null })
    );
    const props = trackAgentRun.mock.calls[0]![2] as Record<string, unknown>;
    expect(props.trigger).toBeUndefined();
  });

  it("the run allowance is PLAN-AWARE — Pro claims against the allowance Pro paid for", async () => {
    // This REVERSES the earlier plan-independent pin, on the terms that pin
    // itself set: it existed to make a per-plan allowance "a decision, not a
    // drift", and the decision has now been made (SCRUM-84, ruled with a
    // measured per-run token ceiling bounding the cost). The route reads
    // users.plan and claims against planLimits(plan).agentRuns; the era of a
    // paying subscriber hitting the free wall is what this test now forbids.
    planRows.mockResolvedValue([{ plan: "pro" }]);
    await drain(await POST(post({ messages: USER_TURN })));
    expect(claimAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      USER,
      planLimits("pro").agentRuns
    );
    expect(planLimits("pro").agentRuns).toBeGreaterThan(RUN_CAP);
  });

  it("a free user still claims against the free allowance", async () => {
    planRows.mockResolvedValue([{ plan: "free" }]);
    await drain(await POST(post({ messages: USER_TURN })));
    expect(claimAgentRun).toHaveBeenCalledWith(expect.anything(), USER, RUN_CAP);
  });

  it("an unknown plan value falls to the free allowance, and a missing row does too", async () => {
    // Least privilege, matching planLimits' own default branch: a plan value
    // this build does not know must never claim like Pro.
    planRows.mockResolvedValue([{ plan: "plan-from-the-future" }]);
    await drain(await POST(post({ messages: USER_TURN })));
    expect(claimAgentRun).toHaveBeenCalledWith(expect.anything(), USER, RUN_CAP);

    planRows.mockResolvedValue([]);
    await drain(await POST(post({ messages: USER_TURN })));
    expect(claimAgentRun).toHaveBeenLastCalledWith(
      expect.anything(),
      USER,
      RUN_CAP
    );
  });

  it("a run stopped at the token ceiling reads as a product state, not a generic error", async () => {
    // The ceiling refuses the NEXT model call mid-run (SCRUM-84); by then the
    // stream is live, so the refusal surfaces through the failure tap. The
    // user must read the ceiling message, not the generic error line — a run
    // dying silently at a token limit looks like a product bug. And the
    // claim STANDS: the run really spent its budget, so no refund.
    let sent = 0;
    handleChatStream.mockResolvedValue(
      new ReadableStream<UIMessageChunk>({
        pull(controller) {
          if (sent === 0) {
            sent++;
            controller.enqueue({ type: "text-delta", id: "t1", delta: "partial" } as UIMessageChunk);
            return;
          }
          controller.error(new RunTokenCeilingError(150_000));
        },
      })
    );

    const chunks = await drain(await POST(post({ messages: USER_TURN })));
    const errorChunk = chunks.find((c) => c.type === "error");
    expect(errorChunk?.errorText).toBe(RUN_CEILING_MESSAGE);
    expect(trackPlaygroundRunCeilingHit).toHaveBeenCalledWith(
      expect.anything(),
      USER,
      expect.objectContaining({ reason: "hard" })
    );
    expect(refundAgentRun).not.toHaveBeenCalled();
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
    expect(trackPlaygroundConfirm).toHaveBeenCalledWith(expect.anything(), USER, "approved", 1);
  });

  it("records a decision of 'denied' when nothing in the batch was approved", async () => {
    const messages = approvalTurn(USER);
    (messages[1] as { parts: Array<{ approval: { approved: boolean } }> }).parts[0]!
      .approval.approved = false;
    await drain(await POST(post({ messages })));

    expect(trackPlaygroundConfirm).toHaveBeenCalledWith(expect.anything(), USER, "denied", 1);
  });
});

describe("POST /api/playground/chat — refunds", () => {
  it("refunds when the turn dies before it produced anything", async () => {
    handleChatStream.mockRejectedValue(new Error("nope"));
    const response = await POST(post({ messages: USER_TURN }));

    expect(response.status).toBe(500);
    expect(refundAgentRun).toHaveBeenCalledWith(expect.anything(), USER);
  });

  it("refunds when the stream fails having delivered only bookkeeping", async () => {
    // `start` is enqueued before the model is even called, so a turn that
    // fails right after it has produced nothing the user can see.
    handleChatStream.mockResolvedValue(failingStream([{ type: "start" }]));
    const chunks = await drain(await POST(post({ messages: USER_TURN })));

    expect(chunks.some((c) => c.type === "error")).toBe(true);
    expect(refundAgentRun).toHaveBeenCalledWith(expect.anything(), USER);
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
    expect(trackPlaygroundConfirm).toHaveBeenCalledWith(expect.anything(), USER, "shown", 1);
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

  it("carries the caller's identity, and ONLY identity, in params (SCRUM-188)", async () => {
    await drain(await POST(post({ messages: USER_TURN })));
    const context = lastParams().requestContext as { get: (k: string) => unknown };

    expect(context.get(USER_ID_CONTEXT_KEY)).toBe(USER);
    // No per-plugin tokens, accounts, or scopes on the context any more: the
    // agent is an in-process client of our own MCP, which resolves all of
    // that per call. A credential on this context would be a second path.
    expect(context.get("userToken:gws-mcp")).toBeUndefined();
    expect(context.get("userAccount:gws-mcp")).toBeUndefined();
    expect(context.get("userScopes:gws-mcp")).toBeUndefined();
  });

  it("names the thread on every turn's response, so the client can route a connect back into it", async () => {
    const response = await POST(post({ messages: USER_TURN, id: "conv-1" }));
    const threadHeader = response.headers.get("x-playground-thread-id");
    // The value is the server-derived thread id — opaque to this test, but it
    // must exist on the FIRST turn of a new conversation, which is exactly
    // when the client cannot compute it.
    expect(threadHeader).toBeTruthy();
    await drain(response);
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

/* SCRUM-234: the step budget is ours, and no cap ends a turn silently. The
 * runtime's default was five model calls per turn, which ended a real
 * morning brief after eight tool calls with no notice at all. */
describe("step budget and the stop notice (SCRUM-234)", () => {
  const TOOL_STEP = (id: string): UIMessageChunk[] => [
    { type: "start-step" },
    { type: "tool-input-start", toolCallId: id, toolName: "gws-mcp__gmail_search" },
    { type: "tool-input-available", toolCallId: id, toolName: "gws-mcp__gmail_search", input: {} },
    { type: "tool-output-available", toolCallId: id, output: { messages: [] } },
    { type: "finish-step" },
  ];

  function skillTurn() {
    const skill = readSkillFiles().find((s) => s.slug === "morning-brief")!;
    return [{ id: "u1", role: "user", parts: [{ type: "text", text: skillRunMessage(skill) }] }];
  }

  /** Emits what it is given, then fails with the given error. */
  function failingWith(before: UIMessageChunk[], err: Error): ReadableStream<UIMessageChunk> {
    let index = 0;
    return new ReadableStream({
      pull(controller) {
        if (index < before.length) {
          controller.enqueue(before[index++]!);
          return;
        }
        controller.error(err);
      },
    });
  }

  it("passes the skill step budget for a skill turn and the chat budget otherwise", async () => {
    await drain(await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual" })));
    expect(lastParams().maxSteps).toBe(SKILL_RUN_MAX_STEPS);
    await drain(await POST(post({ messages: USER_TURN })));
    expect(lastParams().maxSteps).toBe(CHAT_MAX_STEPS);
    expect(SKILL_RUN_MAX_STEPS).toBeGreaterThan(CHAT_MAX_STEPS);
  });

  it("a turn that ends right after a tool result carries a run-stopped part before the finish", async () => {
    handleChatStream.mockResolvedValue(
      chunkStream([
        { type: "start" },
        ...TOOL_STEP("call-1"),
        ...TOOL_STEP("call-2"),
        { type: "finish", finishReason: "tool-calls" } as UIMessageChunk,
      ])
    );
    const chunks = await drain(
      await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual" }))
    );
    const stopped = chunks.findIndex((c) => c.type === "data-run-stopped");
    const finish = chunks.findIndex((c) => c.type === "finish");
    expect(stopped).toBeGreaterThan(-1);
    expect(stopped).toBeLessThan(finish);
    expect(chunks[stopped]!.data).toEqual({
      limit: "steps",
      steps: 2,
      cap: SKILL_RUN_MAX_STEPS,
      skill: "morning-brief",
    });
  });

  it("a turn that ends with prose carries no run-stopped part", async () => {
    handleChatStream.mockResolvedValue(
      chunkStream([
        { type: "start" },
        ...TOOL_STEP("call-1"),
        { type: "start-step" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Done. Here is the brief." },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "finish", finishReason: "stop" } as UIMessageChunk,
      ])
    );
    const chunks = await drain(await POST(post({ messages: USER_TURN })));
    expect(chunks.some((c) => c.type === "data-run-stopped")).toBe(false);
  });

  it("a turn that stops for an approval carries no run-stopped part: the confirm card is its notice", async () => {
    handleChatStream.mockResolvedValue(
      chunkStream([
        { type: "start" },
        ...TOOL_STEP("call-1"),
        { type: "start-step" },
        { type: "tool-input-start", toolCallId: "call-2", toolName: "gws-mcp__docs_create" },
        { type: "tool-input-available", toolCallId: "call-2", toolName: "gws-mcp__docs_create", input: {} },
        { type: "tool-approval-request", toolCallId: "call-2", approvalId: "approval-1" },
        { type: "finish", finishReason: "tool-calls" } as UIMessageChunk,
      ])
    );
    const chunks = await drain(await POST(post({ messages: USER_TURN })));
    expect(chunks.some((c) => c.type === "data-run-stopped")).toBe(false);
  });

  /** What the runtime really does with a thrown error (SCRUM-243): the AI SDK
   * catches it inside the stream it builds, asks the route's `onError` for the
   * text, and enqueues an ordinary `error` chunk. The stream never rejects, so
   * a route that only watches for a rejection sees the ceiling as one more
   * chunk on the pass-through path and injects nothing. */
  function endingInBand(before: UIMessageChunk[], err: Error) {
    return async (opts: { onError: (err: unknown) => string }) =>
      new ReadableStream<UIMessageChunk>({
        start(controller) {
          for (const chunk of before) controller.enqueue(chunk);
          controller.enqueue({ type: "error", errorText: opts.onError(err) });
          controller.close();
        },
      });
  }

  it("the size ceiling arriving as an in-band error chunk carries a run-stopped part of the size kind before it", async () => {
    handleChatStream.mockImplementation(
      endingInBand([{ type: "start" }, ...TOOL_STEP("call-1")], new RunTokenCeilingError(150_000))
    );
    const chunks = await drain(
      await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual" }))
    );
    const stopped = chunks.findIndex((c) => c.type === "data-run-stopped");
    const error = chunks.findIndex((c) => c.type === "error");
    expect(stopped).toBeGreaterThan(-1);
    expect(stopped).toBeLessThan(error);
    expect(chunks[stopped]!.data).toEqual({ limit: "size", steps: 1, cap: null, skill: "morning-brief" });
    expect(chunks[error]!.errorText).toBe(RUN_CEILING_MESSAGE);
    // One notice, whichever path delivered the error.
    expect(chunks.filter((c) => c.type === "data-run-stopped")).toHaveLength(1);
  });

  it("an in-band error that is not the ceiling carries no stop card", async () => {
    handleChatStream.mockImplementation(
      endingInBand([{ type: "start" }, ...TOOL_STEP("call-1")], new Error("upstream 502"))
    );
    const chunks = await drain(
      await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual" }))
    );
    expect(chunks.some((c) => c.type === "data-run-stopped")).toBe(false);
    expect(chunks.find((c) => c.type === "error")?.errorText).not.toBe(RUN_CEILING_MESSAGE);
  });

  it("a stream that rejects with the ceiling still carries the size-kind part exactly once", async () => {
    handleChatStream.mockResolvedValue(
      failingWith([{ type: "start" }, ...TOOL_STEP("call-1")], new RunTokenCeilingError(150_000))
    );
    const chunks = await drain(
      await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual" }))
    );
    const stopped = chunks.findIndex((c) => c.type === "data-run-stopped");
    const error = chunks.findIndex((c) => c.type === "error");
    expect(stopped).toBeGreaterThan(-1);
    expect(stopped).toBeLessThan(error);
    expect(chunks.filter((c) => c.type === "data-run-stopped")).toHaveLength(1);
  });

  it("the continuation message beside a valid slug is a skill run, so Continue keeps the no-gates policy", async () => {
    const turn = [{ id: "u1", role: "user", parts: [{ type: "text", text: skillContinueMessage("morning-brief") }] }];
    await drain(await POST(post({ messages: turn, skill: "morning-brief", skillTrigger: "manual" })));
    expect(trackAgentRun).toHaveBeenLastCalledWith(
      expect.anything(),
      USER,
      expect.objectContaining({ skill: "morning-brief", trigger: "manual" })
    );
    expect(lastParams().maxSteps).toBe(SKILL_RUN_MAX_STEPS);
  });
});

/* SCRUM-242: the route appends the clock to a recognised skill run with the
 * browser's zone and the server's time. The match stays byte for byte on the
 * text the client sent; the clock is added after it, never part of it. */
describe("the run clock (SCRUM-242)", () => {
  function skillTurn() {
    const skill = readSkillFiles().find((s) => s.slug === "morning-brief")!;
    return [{ id: "u1", role: "user", parts: [{ type: "text", text: skillRunMessage(skill) }] }];
  }
  const lastText = () => {
    const messages = lastParams().messages as Array<{ parts: Array<{ text: string }> }>;
    return messages[messages.length - 1]!.parts.map((p) => p.text).join("");
  };

  it("hands the runtime the run message ending with the clock line in the browser's zone", async () => {
    const before = Date.now();
    await drain(
      await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual", zone: "America/Los_Angeles" }))
    );
    const text = lastText();
    const skill = readSkillFiles().find((s) => s.slug === "morning-brief")!;
    expect(text.startsWith(skillRunMessage(skill))).toBe(true);
    const m = text.match(/\n\nRun started (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\. The user's time zone is America\/Los_Angeles, where it is /);
    expect(m).not.toBeNull();
    const started = Date.parse(m![1]!);
    expect(started).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(started).toBeLessThanOrEqual(Date.now());
    // Still a skill run: the step budget and the attribution are the skill's.
    expect(lastParams().maxSteps).toBe(SKILL_RUN_MAX_STEPS);
  });

  it("falls back to the unknown-zone line when the zone is not an IANA name", async () => {
    await drain(
      await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual", zone: "Mars/Olympus" }))
    );
    expect(lastText()).toMatch(/Run started .* time zone is not known/);
    expect(lastText()).not.toContain("Mars/Olympus");
  });

  it("appends the clock when no zone is sent at all", async () => {
    await drain(await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual" })));
    expect(lastText()).toMatch(/Run started .* time zone is not known/);
  });

  it("leaves an ordinary turn untouched even when a zone is sent", async () => {
    await drain(await POST(post({ messages: USER_TURN, zone: "America/Los_Angeles" })));
    expect(lastText()).toBe("hi");
  });
});

/* SCRUM-254: bytes keep flowing while a step thinks, and a viewer who leaves
 * does not end the run or lose the record of how it ended. */
describe("keepalive and the run after the viewer left (SCRUM-254)", () => {
  const TOOL_STEP = (id: string): UIMessageChunk[] => [
    { type: "start-step" },
    { type: "tool-input-start", toolCallId: id, toolName: "gws-mcp__gmail_search" },
    { type: "tool-input-available", toolCallId: id, toolName: "gws-mcp__gmail_search", input: {} },
    { type: "tool-output-available", toolCallId: id, output: { messages: [] } },
    { type: "finish-step" },
  ];

  function skillTurn() {
    const skill = readSkillFiles().find((s) => s.slug === "morning-brief")!;
    return [{ id: "u1", role: "user", parts: [{ type: "text", text: skillRunMessage(skill) }] }];
  }

  /** A runtime whose second half waits on the test, and which counts how far
   * it was read: the drain after a disconnect is asserted on that count. */
  function gatedSource(first: UIMessageChunk[], rest: UIMessageChunk[]) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const all = [...first, ...rest];
    let index = 0;
    const source = new ReadableStream<UIMessageChunk>({
      async pull(controller) {
        if (index === first.length) await gate;
        if (index < all.length) {
          controller.enqueue(all[index++]!);
          return;
        }
        controller.close();
      },
    });
    return { source, release, read: () => index, total: all.length };
  }

  const PROSE_END: UIMessageChunk[] = [
    { type: "start-step" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Here is the brief." },
    { type: "text-end", id: "t1" },
    { type: "finish-step" },
    { type: "finish", finishReason: "stop" } as UIMessageChunk,
  ];

  beforeEach(() => {
    resetRunRegistry();
  });

  it("emits a transient keepalive while the runtime is silent, and none once it has spoken again", async () => {
    vi.useFakeTimers();
    try {
      const { source, release } = gatedSource([{ type: "start" }, { type: "start-step" }], PROSE_END.slice(1));
      handleChatStream.mockResolvedValue(source);
      const res = await POST(post({ messages: USER_TURN }));
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      const pump = (async () => {
        for (;;) {
          const r = await reader.read();
          if (r.done) return;
          text += decoder.decode(r.value, { stream: true });
        }
      })();
      await vi.advanceTimersByTimeAsync(KEEPALIVE_INTERVAL_MS * 2 + 10);
      expect(text).toContain('"type":"data-keepalive"');
      expect(text).toContain('"transient":true');
      const before = (text.match(/data-keepalive/g) ?? []).length;
      expect(before).toBeGreaterThanOrEqual(2);
      release();
      await vi.advanceTimersByTimeAsync(10);
      await pump;
      expect((text.match(/data-keepalive/g) ?? []).length).toBe(before);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a viewer who leaves mid-step does not stop the run: the runtime is read to the end and the record says completed", async () => {
    const { source, release, read, total } = gatedSource(
      [{ type: "start" }, ...TOOL_STEP("call-1")],
      [...TOOL_STEP("call-2"), ...PROSE_END]
    );
    handleChatStream.mockResolvedValue(source);
    const res = await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual" }));
    const threadId = res.headers.get(THREAD_ID_HEADER)!;
    expect(runStatus(threadId)).toMatchObject({ skill: "morning-brief", cap: SKILL_RUN_MAX_STEPS, state: "running" });

    // Read one frame, then leave, the way a dropped connection cancels the body.
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel("connection dropped");
    expect(runStatus(threadId)).toMatchObject({ state: "running" });

    release();
    await vi.waitFor(() => expect(read()).toBe(total));
    await vi.waitFor(() => expect(runStatus(threadId)).toMatchObject({ state: "completed", steps: 3 }));
  });

  it("a run that stops at its size limit after the viewer left records the limit", async () => {
    const { source, release, read, total } = gatedSource(
      [{ type: "start" }, ...TOOL_STEP("call-1")],
      [...TOOL_STEP("call-2"), { type: "error", errorText: RUN_CEILING_MESSAGE } as UIMessageChunk]
    );
    handleChatStream.mockImplementation(async (opts: { onError: (e: unknown) => string }) => {
      // The runtime asks the route's hook for the text and hands on an error chunk.
      opts.onError(new RunTokenCeilingError(150_000));
      return source;
    });
    const res = await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual" }));
    const threadId = res.headers.get(THREAD_ID_HEADER)!;
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel("connection dropped");
    release();
    await vi.waitFor(() => expect(read()).toBe(total));
    await vi.waitFor(() => expect(runStatus(threadId)).toMatchObject({ state: "stopped", limit: "size", steps: 2 }));
  });

  it("with the viewer attached, the record follows the stream: stopped at the step cap, or completed", async () => {
    handleChatStream.mockResolvedValue(
      chunkStream([{ type: "start" }, ...TOOL_STEP("call-1"), ...TOOL_STEP("call-2"), { type: "finish", finishReason: "tool-calls" } as UIMessageChunk])
    );
    const res = await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual" }));
    const threadId = res.headers.get(THREAD_ID_HEADER)!;
    await drain(res);
    expect(runStatus(threadId)).toMatchObject({ state: "stopped", limit: "steps", steps: 2 });

    handleChatStream.mockResolvedValue(chunkStream([{ type: "start" }, ...PROSE_END]));
    const res2 = await POST(post({ messages: USER_TURN }));
    await drain(res2);
    expect(runStatus(res2.headers.get(THREAD_ID_HEADER)!)).toMatchObject({ state: "completed", steps: 1, skill: null, cap: CHAT_MAX_STEPS });
  });

  it("a runtime that dies mid-run records failed", async () => {
    handleChatStream.mockResolvedValue(failingStream([{ type: "start" }, ...TOOL_STEP("call-1")]));
    const res = await POST(post({ messages: USER_TURN }));
    await drain(res);
    expect(runStatus(res.headers.get(THREAD_ID_HEADER)!)).toMatchObject({ state: "failed", steps: 1 });
  });
});

/* SCRUM-248: a skill-seeded turn bounds its thinking per step; ordinary chat
 * keeps today's shape. */
describe("the thinking effort on a skill run (SCRUM-248)", () => {
  function skillTurn() {
    const skill = readSkillFiles().find((s) => s.slug === "morning-brief")!;
    return [{ id: "u1", role: "user", parts: [{ type: "text", text: skillRunMessage(skill) }] }];
  }

  it("a skill run's generation options carry adaptive thinking at the skill run effort", async () => {
    await drain(await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual" })));
    expect(lastParams().providerOptions).toEqual({
      anthropic: { thinking: { type: "adaptive" }, effort: SKILL_RUN_EFFORT },
    });
  });

  it("a chat turn's generation options carry no thinking setting at all", async () => {
    await drain(await POST(post({ messages: USER_TURN })));
    expect(lastParams().providerOptions).toBeUndefined();
  });

  it("a valid slug beside arbitrary text is a chat turn here too: no effort", async () => {
    await drain(await POST(post({ messages: USER_TURN, skill: "morning-brief" })));
    expect(lastParams().providerOptions).toBeUndefined();
  });
});

/* SCRUM-251: the soft ceiling is reported with its reason and the weighted
 * totals either side of the step that crossed it; the hard stop reports the
 * same two numbers. */
describe("the soft ceiling event (SCRUM-251)", () => {
  const TOOL_STEP = (id: string): UIMessageChunk[] => [
    { type: "start-step" },
    { type: "tool-input-start", toolCallId: id, toolName: "gws-mcp__gmail_search" },
    { type: "tool-input-available", toolCallId: id, toolName: "gws-mcp__gmail_search", input: {} },
    { type: "tool-output-available", toolCallId: id, output: { messages: [] } },
    { type: "finish-step" },
  ];
  const PROSE_END: UIMessageChunk[] = [
    { type: "start-step" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Sent." },
    { type: "text-end", id: "t1" },
    { type: "finish-step" },
    { type: "finish", finishReason: "stop" } as UIMessageChunk,
  ];
  function skillTurn() {
    const skill = readSkillFiles().find((s) => s.slug === "morning-brief")!;
    return [{ id: "u1", role: "user", parts: [{ type: "text", text: skillRunMessage(skill) }] }];
  }
  /** The accumulator as the route reads it at each step start: the value
   * reported at step n is the total after step n-1. */
  function totalsByStep(values: number[]) {
    let call = 0;
    runTokensUsed.mockImplementation(() => values[Math.min(call++, values.length - 1)] ?? 0);
  }

  it("a skill run crossing the line between two steps emits soft, once, with the totals either side", async () => {
    // Step 1 starts at 0; step 2 starts with 100k on the clock; step 3 with 130k.
    totalsByStep([0, 100_000, 130_000, 130_000]);
    handleChatStream.mockResolvedValue(
      chunkStream([{ type: "start" }, ...TOOL_STEP("c1"), ...TOOL_STEP("c2"), ...PROSE_END])
    );
    await drain(await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual" })));
    const soft = trackPlaygroundRunCeilingHit.mock.calls.filter((c) => (c[2] as { reason?: string })?.reason === "soft");
    expect(soft).toHaveLength(1);
    expect(soft[0]![2]).toMatchObject({
      reason: "soft",
      pre_step_weighted: 100_000,
      post_step_weighted: 130_000,
      skill: "morning-brief",
    });
    expect(130_000).toBeGreaterThanOrEqual(RUN_SOFT_CEILING);
    expect(100_000).toBeLessThan(RUN_SOFT_CEILING);
  });

  it("a skill run that stays under the line emits nothing", async () => {
    totalsByStep([0, 50_000, 90_000, 120_000]);
    handleChatStream.mockResolvedValue(
      chunkStream([{ type: "start" }, ...TOOL_STEP("c1"), ...TOOL_STEP("c2"), ...PROSE_END])
    );
    await drain(await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual" })));
    expect(trackPlaygroundRunCeilingHit).not.toHaveBeenCalled();
  });

  it("a chat turn crossing the line emits nothing: the closing instruction is a skill run's", async () => {
    totalsByStep([0, 100_000, 130_000, 130_000]);
    handleChatStream.mockResolvedValue(
      chunkStream([{ type: "start" }, ...TOOL_STEP("c1"), ...TOOL_STEP("c2"), ...PROSE_END])
    );
    await drain(await POST(post({ messages: USER_TURN })));
    expect(trackPlaygroundRunCeilingHit).not.toHaveBeenCalled();
  });

  it("the hard stop reports hard with the totals either side of the step that crossed", async () => {
    totalsByStep([0, 100_000, 130_000, 160_000, 160_000]);
    // The runtime asks the route's hook for the text when the ceiling
    // refuses the NEXT call, i.e. after the steps have streamed: the hook is
    // called as the error chunk is reached, not up front.
    handleChatStream.mockImplementation(async (opts: { onError: (e: unknown) => string }) => {
      const before: UIMessageChunk[] = [{ type: "start" }, ...TOOL_STEP("c1"), ...TOOL_STEP("c2"), ...TOOL_STEP("c3")];
      let index = 0;
      return new ReadableStream<UIMessageChunk>({
        pull(controller) {
          if (index < before.length) {
            controller.enqueue(before[index++]!);
            return;
          }
          if (index === before.length) {
            index++;
            const errorText = opts.onError(new RunTokenCeilingError(160_000));
            controller.enqueue({ type: "error", errorText } as UIMessageChunk);
            return;
          }
          controller.close();
        },
      });
    });
    await drain(await POST(post({ messages: skillTurn(), skill: "morning-brief", skillTrigger: "manual" })));
    const hard = trackPlaygroundRunCeilingHit.mock.calls.filter((c) => (c[2] as { reason?: string })?.reason === "hard");
    expect(hard).toHaveLength(1);
    expect(hard[0]![2]).toMatchObject({ reason: "hard", pre_step_weighted: 130_000, post_step_weighted: 160_000 });
    // The soft crossing on the way is reported too, once.
    const soft = trackPlaygroundRunCeilingHit.mock.calls.filter((c) => (c[2] as { reason?: string })?.reason === "soft");
    expect(soft).toHaveLength(1);
  });
});
