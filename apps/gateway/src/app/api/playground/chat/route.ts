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
  loadUserPluginCredentials,
} from "@/mastra/mcp/client";
import {
  deriveThreadId, findApprovalTargets, mintRunId, ownsRunId,
} from "@/gateway/playground/run-ownership";
import {
  RUNS_CAP_HEADER,
  RUNS_REMAINING_HEADER,
  THREAD_ID_HEADER,
} from "@/gateway/playground/quota-headers";
import { setThreadTitleIfEmpty, userOwnsThread } from "@/gateway/playground/threads";
import { threadTitle } from "@/gateway/playground/thread-title";
import {
  trackAgentRun,
  trackPlaygroundMessage, trackPlaygroundCapHit, trackPlaygroundConfirm,
} from "@/gateway/track";
import { FREE_MONTHLY_AGENT_RUNS } from "@/gateway/billing/plans";
import { capExempt, claimAgentRun, refundAgentRun } from "@/gateway/usage/period";
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
  /** A write was gated and is now waiting on the user. */
  onApprovalShown: () => void;
  /** The stream died. Receives the error; returns the text to send on. */
  onFailure: (err: unknown) => string;
  /** The stream ended, cleanly or not. Fires once. */
  onClosed?: () => void;
};

/** Wraps the runtime's stream so the route can count what went past and notice
 * a failure, without owning the loop that produced it.
 *
 * This no longer meters tool calls. It used to, and the reason it stopped is
 * that a chunk carries a tool NAME and nothing else: no connector, no account,
 * no duration. Metering moved to the tool's own `execute` wrapper, which has
 * all three. What survives here is the property that made the old placement
 * defensible in the first place, and it survives for free: a gated write that
 * the user declines never executes, so it is never counted. */
function instrumentStream(
  source: ReadableStream<UIMessageChunk>,
  taps: StreamTaps
): ReadableStream<UIMessageChunk> {
  const reader = source.getReader();
  let delivered = false;

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      let result;
      try {
        result = await reader.read();
      } catch (err) {
        controller.enqueue({ type: "error", errorText: taps.onFailure(err) });
        controller.close();
        taps.onClosed?.();
        return;
      }
      if (result.done) {
        controller.close();
        taps.onClosed?.();
        return;
      }
      const chunk = result.value;
      if (!delivered && NON_CONTENT_CHUNK_TYPES[chunk.type] !== true) {
        delivered = true;
        taps.onDelivered();
      }
      if (chunk.type === "tool-approval-request") taps.onApprovalShown();
      controller.enqueue(chunk);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** The text of the first user message in the posted conversation, for the
 * title. Reads the same wire shape the client sends: parts carrying text, with
 * a flat `content` string as the older fallback. Returns null when there is
 * nothing readable, and the caller then leaves the thread for the date
 * fallback rather than inventing a label. */
function firstUserMessageText(messages: unknown[]): string | null {
  for (const message of messages) {
    const m = message as { role?: unknown; parts?: unknown; content?: unknown };
    if (m?.role !== "user") continue;
    if (Array.isArray(m.parts)) {
      const text = m.parts
        .filter(
          (p): p is { type: string; text: string } =>
            typeof p === "object" &&
            p !== null &&
            (p as { type?: unknown }).type === "text" &&
            typeof (p as { text?: unknown }).text === "string"
        )
        .map((p) => p.text)
        .join(" ");
      if (text.trim() !== "") return text;
    }
    if (typeof m.content === "string" && m.content.trim() !== "") {
      return m.content;
    }
  }
  return null;
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
    messages?: unknown; id?: unknown; trigger?: unknown; threadId?: unknown;
  } | null;
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  /* WHICH CONVERSATION THIS TURN BELONGS TO.
   *
   * Two paths, and the split is forced rather than stylistic.
   *
   * A NEW conversation derives its id server-side from the session user, so a
   * caller cannot write into a thread it does not own: the id it would need is
   * not something it can supply. That is ownership by construction and it stays.
   *
   * RESUMING an existing one cannot work that way. The derivation is a one-way
   * hash, so the client id behind a stored thread is unrecoverable, and a
   * resumed turn must land in the SAME thread the user is looking at or it
   * silently forks a new one. So a resumed turn names its thread and we prove
   * ownership through the same gate the read routes use, once, before any work
   * or spend happens. An id that is not this user's is refused as not found,
   * exactly as reading it would be: answering differently here would turn the
   * chat endpoint into the existence oracle the read routes are careful not to
   * be. */
  const namedThread =
    typeof body?.threadId === "string" && body.threadId !== ""
      ? body.threadId
      : null;
  if (namedThread && !(await userOwnsThread(userId, namedThread))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const threadForTurn =
    namedThread ??
    deriveThreadId(userId, typeof body?.id === "string" ? body.id : "");

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
  //
  // The thread id rides on EVERY turn, because the first turn of a new
  // conversation is exactly when the client does not know it — and the inline
  // Connect control needs it to route the OAuth round trip back here.
  const quotaHeaders: Record<string, string> = {
    [THREAD_ID_HEADER]: threadForTurn,
  };
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
    // Internal accounts are counted but never refused. Dogfooding is the only
    // sustained use this surface has, so a live allowance would interrupt our
    // own testing long before it ever met a customer. See `capExempt` for why
    // that predicate is safe for skipping a cap and unsafe for anything else.
    const cap = (await capExempt(db, userId)) ? null : FREE_MONTHLY_AGENT_RUNS;
    const claim = await claimAgentRun(db, userId, cap);
    if (!claim.ok) {
      void trackPlaygroundCapHit(db, userId);
      return NextResponse.json({ error: "cap_exceeded", cap }, { status: 429 });
    }
    runsUsed = claim.used;
    // No headers when uncapped: the client raises its paywall off these, and
    // reporting a cap that does not apply would show one to the exempt.
    if (cap !== null && claim.remaining !== null) {
      quotaHeaders[RUNS_REMAINING_HEADER] = String(claim.remaining);
      quotaHeaders[RUNS_CAP_HEADER] = String(cap);
    }
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
  // Same lifetime as `stream`: computed inside the try, consumed by the tap on
  // the response below, which is outside it.
  let pendingTitle: string | null = null;
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
    const credentials = await loadUserPluginCredentials(
      db,
      userId,
      servers.map((s) => s.slug)
    );
    const requestContext = buildPluginRequestContext({
      userId,
      tokensByServer: credentials.tokensByServer,
      // The account each token was resolved for rides beside it, so tool
      // metering can stamp the identity the call actually runs as.
      accountsByServer: credentials.accountsByServer,
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

    // NAME THE CONVERSATION, ONCE, FROM WHAT THE USER ALREADY TYPED.
    //
    // Computed here, WRITTEN WHEN THE STREAM CLOSES. On a brand new
    // conversation the thread row does not exist until the runtime has written
    // it, so titling before the turn finds nothing to title, the ownership
    // check correctly refuses, and a single-turn conversation would sit on the
    // date fallback forever. Deferring to the close is what makes the first
    // turn the one that names it.
    //
    // Fire and forget, never awaited: a label on a list must not be able to
    // delay or fail a turn. `setThreadTitleIfEmpty` is a no-op once a title
    // exists, so re-running it on later turns costs a read and changes nothing.
    pendingTitle = threadTitle(firstUserMessageText(messages));

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
          thread: threadForTurn,
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
      // NO TOOL METERING HERE, DELIBERATELY. It used to live on this tap, and
      // the vantage point was the problem: a stream chunk knows a tool's name
      // and nothing else, so every agent row reached `usage_events` with a null
      // connector and a zero latency. Metering now wraps the tool's `execute`
      // in `mastra/mcp/client.ts`, where the connector, the account and the
      // real duration are all in scope. Putting it back here would double-count
      // every call.
      onApprovalShown: () => { void trackPlaygroundConfirm(db, userId, "shown", 1); },
      onFailure: (err) => {
        refundIfWasted();
        return logAndGenericError("[playground] turn failed", err);
      },
      // The thread row exists by now, which is the whole reason this waits.
      onClosed: () => {
        if (!pendingTitle) return;
        void setThreadTitleIfEmpty(userId, threadForTurn, pendingTitle).catch(
          () => {
            // A missing title is cosmetic and the list falls back to the
            // thread's date. Not worth surfacing to the user.
          }
        );
      },
    }),
  });
});
