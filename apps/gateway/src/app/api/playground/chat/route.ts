import { NextResponse } from "next/server";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { handleChatStream } from "@mastra/ai-sdk";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { getEnv } from "@datatorag-mcp/config";
import { getMastra, DATATORAG_AGENT_ID } from "@/mastra";
import { RUN_ID_CONTEXT_KEY } from "@/mastra/llm-usage";
import {
  buildPluginRequestContext,
  listPluginServers,
  loadUserPluginTokens,
} from "@/mastra/mcp/client";
import {
  deriveThreadId, findApprovalTargets, mintRunId, ownsRunId,
} from "@/gateway/playground/run-ownership";
import { RUNS_CAP_HEADER, RUNS_REMAINING_HEADER } from "@/gateway/playground/quota-headers";
import {
  trackAgentRun, trackToolCall,
  trackPlaygroundMessage, trackPlaygroundCapHit, trackPlaygroundConfirm,
} from "@/gateway/track";
import { FREE_MONTHLY_AGENT_RUNS } from "@/gateway/billing/plans";
import { claimAgentRun, refundAgentRun } from "@/gateway/usage/period";
import { logAndGenericError } from "@/lib/errors";

/**
 * The playground chat turn.
 *
 * The whole loop — history, tool calls, the pause at a write, the resume after
 * the user decides — belongs to the agent runtime now. What is left here is
 * the part that is ours and cannot be delegated: who the caller is, whether
 * they may spend a turn, whether they may approve the run they are pointing
 * at, and what we count.
 *
 * There is no resume endpoint and no resume token. A decision on a gated write
 * comes back as an ordinary chat request whose last assistant message carries
 * the answer inline; the runtime notices and resumes instead of starting a new
 * turn. That is why the ownership check below is on this one path rather than
 * on a separate route — there is no separate route to put it on.
 */

/** Mastra's output protocol, which is NOT this app's AI SDK version.
 *
 * The app is on the v7 client line. `v6` here names the protocol the agent
 * runtime EMITS, and it is the only choice: the runtime has no v7 emitter, and
 * the parameter accepts nothing else. It is also the choice we want. On v5 an
 * approval arrives only as a custom data part; v6 additionally emits a native
 * `tool-approval-request`, which is precisely what let the hand-rolled
 * approval protocol this replaced be deleted rather than ported.
 *
 * The two lines interoperate: every chunk type the runtime emits has an
 * identical field set in both SDK versions, and v7's part vocabulary is a
 * superset of v6's — the approval parts differ only by optional additive
 * fields. So this is not a leftover to clean up. DO NOT "fix" it to 'v7'; that
 * is not a value this parameter accepts, and changing it to 'v5' silently
 * removes the native approval part the client binds to. When a release ships a
 * v7 emitter, this one string flips. */
const MASTRA_STREAM_VERSION = "v6" as const;

/** Chunk types that are protocol bookkeeping rather than assistant output.
 *
 * Feeds one decision: whether a turn that failed had already produced anything
 * real, and therefore whether it should be refunded. `start` in particular is
 * enqueued the instant the stream opens, before the model has been called, so
 * counting it would disable the refund entirely.
 *
 * Written as a total `Record` over the chunk union rather than a `Set` of
 * exclusions, and deliberately so: a `Set` only type-checks what is put INTO
 * it and cannot notice a union member nobody listed, so an SDK upgrade adding
 * a bookkeeping chunk would fall through as "content" and quietly disable the
 * refund. The `Record` fails `tsc` on both an added and a removed variant.
 * That guarantee has already been cashed in once, on the last SDK major.
 *
 * `data-*` chunks — including the runtime's own `data-tool-call-approval` —
 * land on the type's `data-${string}` index signature and need no entry, hence
 * the `=== true` test at the call site rather than a truthiness check. */
const NON_CONTENT_CHUNK_TYPES: Record<UIMessageChunk["type"], boolean> = {
  // Protocol bookkeeping — never real assistant output.
  start: true,
  "start-step": true,
  "finish-step": true,
  finish: true,
  abort: true,
  "message-metadata": true,
  error: true,
  // Real content: text, reasoning, tool activity, sources, files.
  "text-start": false,
  "text-delta": false,
  "text-end": false,
  "reasoning-start": false,
  "reasoning-delta": false,
  "reasoning-end": false,
  "reasoning-file": false,
  custom: false,
  "tool-input-start": false,
  "tool-input-delta": false,
  "tool-input-available": false,
  "tool-input-error": false,
  "tool-approval-request": false,
  "tool-approval-response": false,
  "tool-output-available": false,
  "tool-output-error": false,
  "tool-output-denied": false,
  "source-url": false,
  "source-document": false,
  file: false,
};

/* -------------------------------------------------------------------------- */
/* Stream instrumentation                                                      */
/* -------------------------------------------------------------------------- */

type StreamTaps = {
  /** First chunk of real assistant output — the refund gate. */
  onDelivered: () => void;
  /** A tool actually produced a result on the server.
   *
   * Carries whether it errored, which the old signature collapsed: both
   * outcomes called the same tap with the same argument, so the emitted event
   * could not tell a working tool from a failing one. */
  onToolResult: (toolName: string, opts: { isError: boolean }) => void;
  /** A write was gated and is now waiting on the user. */
  onApprovalShown: () => void;
  /** The stream died. Receives the error; returns the text to send on. */
  onFailure: (err: unknown) => string;
};

/** Wraps the runtime's stream so the route can count what went past and notice
 * a failure, without owning the loop that produced it.
 *
 * Tool-call metering fires on the RESULT, not on the call, and that is the
 * behaviour being preserved rather than an accident: a gated write is
 * announced to the client and then may never run, so counting announcements
 * would bill for actions the user declined. The name is carried across from
 * the input chunk because the result chunk identifies the call by id only. */
function instrumentStream(
  source: ReadableStream<UIMessageChunk>,
  taps: StreamTaps
): ReadableStream<UIMessageChunk> {
  const reader = source.getReader();
  const toolNames = new Map<string, string>();
  let delivered = false;

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      let result;
      try {
        result = await reader.read();
      } catch (err) {
        controller.enqueue({ type: "error", errorText: taps.onFailure(err) });
        controller.close();
        return;
      }
      if (result.done) {
        controller.close();
        return;
      }
      const chunk = result.value;
      if (!delivered && NON_CONTENT_CHUNK_TYPES[chunk.type] !== true) {
        delivered = true;
        taps.onDelivered();
      }
      switch (chunk.type) {
        case "tool-input-available":
          toolNames.set(chunk.toolCallId, chunk.toolName);
          break;
        case "tool-output-available":
        case "tool-output-error": {
          const name = toolNames.get(chunk.toolCallId);
          if (name !== undefined) {
            taps.onToolResult(name, { isError: chunk.type === "tool-output-error" });
          }
          break;
        }
        case "tool-approval-request":
          taps.onApprovalShown();
          break;
      }
      controller.enqueue(chunk);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* The route                                                                   */
/* -------------------------------------------------------------------------- */

// POST /api/playground/chat — one capped, streaming playground turn. The same
// endpoint answers a gated write: the decision rides in on the messages array.
export const POST = withRoute(async (userId, request) => {
  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "playground_disabled" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    messages?: unknown; id?: unknown; trigger?: unknown;
  } | null;
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // NOTE what is NOT read off the body: `runId` and `resumeData`. The runtime
  // accepts both and resumes whatever they name, so forwarding a client's copy
  // would hand any caller a direct resume primitive. Everything below is
  // constructed here.
  const trigger = body?.trigger === "regenerate-message" ? "regenerate-message" : "submit-message";

  /* THE OWNERSHIP GATE.
   *
   * The runtime resumes a suspended run on the strength of the run id alone —
   * it does not compare that run against the caller. Verified by running it:
   * a second user replaying another user's approval id caused the FIRST
   * user's suspended write to execute on a real MCP server, and that server's
   * own execution log says so. `route.ownership.test.ts` keeps the
   * reproduction alongside the proof that this gate stops it.
   *
   * The check is a pure function of the id and the session user because the id
   * carries its owner in an HMAC (see `mintRunId`). It needs no storage read,
   * so it cannot fail open on a slow or unavailable store, and it rejects
   * before the runtime is handed anything at all.
   *
   * All-or-nothing on purpose: one unowned target rejects the request rather
   * than being dropped from it. A partially honoured approval batch would be a
   * much harder thing to reason about later than a refusal. */
  const approvals = findApprovalTargets(messages);
  const foreign = approvals.filter((target) => !ownsRunId(userId, target.runId));
  if (foreign.length > 0) {
    console.warn(
      `[playground] rejected ${foreign.length} approval(s) not owned by the session user`
    );
    return NextResponse.json({ error: "approval_not_found" }, { status: 403 });
  }

  // An approval decision continues the turn the user already paid for, so it
  // claims nothing. Mirrors when the runtime itself takes the resume path.
  const isApprovalLeg =
    approvals.length > 0 &&
    trigger !== "regenerate-message" &&
    (messages[messages.length - 1] as { role?: unknown })?.role === "assistant";

  // Quota headers ride on the streaming response; an approval leg claims
  // nothing and so reports nothing, leaving the client's notion of the quota
  // untouched rather than resetting it.
  const quotaHeaders: Record<string, string> = {};
  /** Runs spent in the period after this turn's claim. Reported on `agent_run`
   * so the allowance is readable from the event stream alone. */
  let runsUsed = 0;

  if (isApprovalLeg) {
    void trackPlaygroundConfirm(
      db,
      userId,
      approvals.some((target) => target.approved) ? "approved" : "denied",
      approvals.length
    );
  } else {
    // A PERIOD allowance, not a lifetime one. The counter this replaces was a
    // lifetime column explicitly excluded from billing, which was the right
    // shape for a buried demo and the wrong one for a metered surface: it
    // could only ever run out, never refill.
    const cap = FREE_MONTHLY_AGENT_RUNS;
    const claim = await claimAgentRun(db, userId, cap);
    if (!claim.ok) {
      void trackPlaygroundCapHit(db, userId);
      return NextResponse.json({ error: "cap_exceeded", cap }, { status: 429 });
    }
    runsUsed = claim.used;
    quotaHeaders[RUNS_REMAINING_HEADER] = String(claim.remaining);
    quotaHeaders[RUNS_CAP_HEADER] = String(cap);
    void trackPlaygroundMessage(db, userId);
  }

  /** Undo the claim, if this turn made one and produced nothing.
   *
   * An abort NEVER refunds, however early it lands: "POST a large history,
   * abort as soon as headers return" would otherwise burn real provider input
   * tokens on a loop while the cap never moved. A user who hits Stop in the
   * first instant is charged; that is the accepted trade, and the refund
   * exists for provider and infrastructure failures, not for aborts. */
  let delivered = false;
  const refundIfWasted = () => {
    if (isApprovalLeg || delivered || request.signal.aborted) return;
    refundAgentRun(db, userId).catch((err) =>
      console.error("[playground] refund failed", err)
    );
  };

  let stream: ReadableStream<UIMessageChunk>;
  /** Hoisted out of the try below because the stream taps close over it: the
   * tool-call events are emitted while the stream drains, long after this
   * block returns. */
  let usageRunId: string | undefined;
  try {
    // Per-request identity for the plugin connections. Built per plugin, not
    // once for the request: a plugin's token is a credential for THAT
    // plugin's upstream, and one shared key would post every plugin every
    // other plugin's token.
    const servers = await listPluginServers(db);
    const requestContext = buildPluginRequestContext({
      userId,
      tokensByServer: await loadUserPluginTokens(db, userId, servers.map((s) => s.slug)),
    });

    // The run this turn belongs to, so each model call can report its tokens
    // against it. On an approval leg the runtime resumes the ORIGINAL run, so
    // the id comes off the approval that was just verified rather than being
    // minted again — otherwise a run that paused for approval would report as
    // two runs and halve its own token total.
    usageRunId = isApprovalLeg ? approvals[0]?.runId : mintRunId(userId);
    if (usageRunId) requestContext.set(RUN_ID_CONTEXT_KEY, usageRunId);

    // One event per RUN, not per leg. An approval leg resumes a run that was
    // already counted and already claimed, so emitting here would report two
    // runs for one turn and overstate exactly the number the allowance is
    // measured in.
    if (!isApprovalLeg && usageRunId) {
      void trackAgentRun(db, userId, { runId: usageRunId, runsUsed });
    }

    stream = (await handleChatStream({
      mastra: getMastra(),
      agentId: DATATORAG_AGENT_ID,
      version: MASTRA_STREAM_VERSION,
      params: {
        messages: messages as never,
        trigger,
        // `requestContext` belongs in `params`, not in `defaultOptions`. The
        // handler spreads these options into the resume leg it starts when it
        // finds an approval, which is what carries the caller's identity —
        // and therefore their plugin tokens — across the suspend. Put it
        // anywhere else and the resumed write runs with no credentials.
        requestContext,
        // Threads are namespaced by user, so a client-supplied conversation id
        // can only ever address that user's own threads: the same id sent by
        // two users derives two different threads. Ownership by construction
        // again, for the same reason as the run id — and here it costs
        // nothing, since the derivation is stable across restarts.
        memory: {
          thread: deriveThreadId(userId, typeof body?.id === "string" ? body.id : ""),
          resource: userId,
        },
        // A fresh turn gets a run id minted for THIS user; that id is what
        // ends up inside the approval id the client sends back, and what the
        // gate above verifies. On an approval leg the runtime takes the run id
        // from the approval itself, so supplying one here would be ignored.
        ...(isApprovalLeg ? {} : { runId: usageRunId as string }),
      },
      onError: (err) => logAndGenericError("[playground] stream error", err),
    })) as ReadableStream<UIMessageChunk>;
  } catch (err) {
    // Failed before a single chunk existed — refund, since the claim landed
    // but no work happened.
    refundIfWasted();
    return NextResponse.json(
      { error: logAndGenericError("[playground] turn failed", err) },
      { status: 500 }
    );
  }

  return createUIMessageStreamResponse({
    headers: quotaHeaders,
    stream: instrumentStream(stream, {
      onDelivered: () => { delivered = true; },
      onToolResult: (toolName, { isError }) => {
        // The SAME event gateway traffic emits, distinguished by `surface`
        // rather than by a second event name, and carrying the run so a
        // turn's tool calls and its token cost can be joined.
        void trackToolCall(db, {
          userId,
          toolName,
          connectorType: null,
          accountEmail: undefined,
          latencyMs: 0,
          responseSizeBytes: null,
          errorMessage: null,
          runId: usageRunId ?? null,
          outcome: { thrown: false, isError, source: "agent", toolName },
        });
      },
      onApprovalShown: () => { void trackPlaygroundConfirm(db, userId, "shown", 1); },
      onFailure: (err) => {
        refundIfWasted();
        return logAndGenericError("[playground] turn failed", err);
      },
    }),
  });
});
