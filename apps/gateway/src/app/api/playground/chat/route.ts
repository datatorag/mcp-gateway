import { NextRequest, NextResponse } from "next/server";
import {
  createUIMessageStream, createUIMessageStreamResponse,
  type UIMessageStreamWriter, type UIMessageChunk, type ModelMessage,
} from "ai";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { getEnv } from "@datatorag-mcp/config";
import { getPlaygroundModel } from "@/lib/llm";
import {
  streamEngineTurn, detectPause, executeWriteBatch, isApproved, type EngineDeps,
} from "@/gateway/playground/engine";
import { buildModelHistory } from "@/gateway/playground/history";
import { listUserEngineTools, executeUserTool } from "@/gateway/playground/tools";
import { claimPlaygroundMessage, refundPlaygroundMessage } from "@/gateway/playground/cap";
import { putPending, takePending } from "@/gateway/playground/pending";
import {
  trackPlaygroundMessage, trackPlaygroundToolCall, trackPlaygroundCapHit, trackPlaygroundConfirm,
} from "@/gateway/track";
import { logAndGenericError } from "@/lib/errors";

// Engine deps shared by both entry points; executeTool carries the tool-call
// tracking so reads (inside streamText) and approved writes (resume batch)
// are tracked identically.
function engineDeps(
  userId: string,
  model: NonNullable<ReturnType<typeof getPlaygroundModel>>,
  tools: Awaited<ReturnType<typeof listUserEngineTools>>,
  abortSignal: AbortSignal | undefined
): EngineDeps {
  return {
    model,
    tools: tools.tools,
    isWrite: tools.isWrite,
    executeTool: (name, args) => {
      void trackPlaygroundToolCall(db, userId, name);
      return executeUserTool(db, userId, name, args);
    },
    abortSignal,
  };
}

// UI-message-stream chunk types that are pure protocol bookkeeping (turn
// start/end framing, or an error announcement converted from a fullStream
// error part) rather than real assistant output. `start` in particular is
// enqueued unconditionally the instant the stream opens — before the model
// has been called at all — so counting it (or any of these) as "delivered"
// would make the refund tap never fire, even on a turn that fails outright
// before a single token or tool call reaches the client.
//
// Typed against `UIMessageChunk["type"]` (ai@6.0.235) rather than a bare
// `Set<string>` so a future `ai` upgrade that adds a new chunk type here
// (or removes one) fails `tsc`, instead of the new type silently falling
// through as "content" (or, if added here by mistake, silently suppressing
// the refund tap) with nothing catching it at build time.
const NON_CONTENT_CHUNK_TYPES: Set<UIMessageChunk["type"]> = new Set([
  "start", "start-step", "finish-step", "finish", "abort", "message-metadata", "error",
]);

/** Tap a UIMessage-chunk stream so the route knows whether any REAL content
 * (text, reasoning, a tool call/result, or a source/file) reached the
 * response — the successor of the old `workStarted` flag; it gates the
 * refund decision (a turn that dies with zero content parts delivered
 * refunds). Structural/bookkeeping chunks never flip it.
 *
 * Note: this does NOT cover `data-confirm` / `data-write-outcome` — those
 * are written directly to the writer (below), bypassing this tap entirely.
 * That's harmless in practice: a pause always pushes at least one
 * tool-input chunk through the tap before `data-confirm` is written, and
 * the resume path's follow-up turn passes a no-op `markDelivered` (resume
 * never claims a cap message, so there's nothing to refund there). */
function tapDelivered(
  stream: ReadableStream<UIMessageChunk>,
  onFirst: () => void
): ReadableStream<UIMessageChunk> {
  let fired = false;
  return stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        if (!fired && !NON_CONTENT_CHUNK_TYPES.has(chunk.type)) {
          fired = true;
          onFirst();
        }
        controller.enqueue(chunk);
      },
    })
  );
}

/** Runs one engine stream into the writer; on pause persists the hold and
 * emits data-confirm. Returns nothing — errors propagate to the stream's
 * onError.
 *
 * Drains the tapped UI-message-chunk stream into the writer with a plain
 * read loop rather than `writer.merge()`. `merge()` kicks off its own
 * background consumption and returns immediately — racing it against the
 * `detectPause` call below is NOT safe: `detectPause` awaits the engine
 * result's own `finishReason`/`toolCalls`/etc. promises, which resolve off
 * the SAME underlying provider stream (typically via an internal tee) and
 * can settle — and reject, in an engine-level failure — before the tapped
 * stream's transform has processed even its first chunk. That race was
 * observed directly in route.test.ts ("does NOT refund when the turn fails
 * after real content was already delivered" flaked without this fix): the
 * refund tap must see `delivered` flip before any failure can be decided,
 * so we fully drain the tap ourselves — and only then call detectPause. */
async function runTurnIntoStream(
  userId: string,
  deps: EngineDeps,
  history: ModelMessage[],
  writer: UIMessageStreamWriter,
  markDelivered: () => void
): Promise<void> {
  const result = streamEngineTurn(deps, history);
  const tapped = tapDelivered(
    // DO NOT add `generateMessageId` to these options. The client's
    // approve/deny resume depends on this stream NOT carrying a message id:
    // `toUIMessageStream` emits `messageId` on its `start` chunk only when
    // `generateMessageId` is configured, and `processUIMessageStream`'s
    // `start` handler does `state.message.id = chunk.messageId` when one is
    // present. On a resume the SDK seeds its streaming state from the paused
    // assistant message (createStreamingUIMessageState reuses `lastMessage`
    // when it is an assistant message), so with no id the continuation keeps
    // that message's id and is written back with `replaceMessage` — it flows
    // into the SAME message. Add `generateMessageId` and the id changes
    // mid-stream, the id check fails, and the SDK `pushMessage`s a DUPLICATE
    // message that still carries every part cloned from the original: the
    // confirmation card and all tool cards would render a second time.
    result.toUIMessageStream({
      // Without this, an in-band stream error (a fullStream `error` part —
      // e.g. a zero-step provider failure) is converted to a chunk carrying
      // the SDK's default "An error occurred." and never touches
      // logAndGenericError, so it's neither logged server-side nor worded
      // consistently with the route's own onError below (which the client
      // would ALSO see, once the failure additionally rejects the engine
      // result — the client would get both messages back to back).
      onError: (err) => logAndGenericError("[playground] stream error", err),
    }),
    markDelivered
  );
  const reader = tapped.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    writer.write(value);
  }
  const pause = await detectPause(deps, history, result);
  if (pause) {
    const token = putPending(userId, pause.messages, pause.pending);
    writer.write({ type: "data-confirm", data: { resumeToken: token, pending: pause.pending } });
    void trackPlaygroundConfirm(db, userId, "shown", pause.pending.length);
  }
}

// POST /api/playground/chat — capped, streaming (AI SDK UIMessage stream)
// playground chat turn. With { resumeToken, decisions } it instead resumes a
// turn paused at a write (no new cap claim — same logical turn).
export const POST = withRoute(async (userId, request) => {
  const model = getPlaygroundModel();
  if (!model) {
    return NextResponse.json({ error: "playground_disabled" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    messages?: unknown; resumeToken?: string; decisions?: unknown;
  } | null;

  if (typeof body?.resumeToken === "string") {
    return handleResume(request, userId, model, body.resumeToken, body.decisions);
  }

  const history = buildModelHistory(body?.messages);
  if (!history) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const cap = getEnv().PLAYGROUND_MESSAGE_CAP;
  if (!(await claimPlaygroundMessage(db, userId, cap))) {
    void trackPlaygroundCapHit(db, userId);
    return NextResponse.json({ error: "cap_exceeded", cap }, { status: 429 });
  }
  void trackPlaygroundMessage(db, userId);

  let tools;
  try {
    tools = await listUserEngineTools(db, userId);
  } catch (err) {
    // Pre-stream failure after the claim landed — refund so this doesn't
    // burn one of the user's lifetime playground messages.
    await refundPlaygroundMessage(db, userId);
    return NextResponse.json(
      { error: logAndGenericError("[playground] tool listing failed", err) },
      { status: 500 }
    );
  }

  let delivered = false;
  const stream = createUIMessageStream({
    execute: ({ writer }) =>
      runTurnIntoStream(
        userId,
        engineDeps(userId, model, tools, request.signal),
        history,
        writer,
        () => { delivered = true; }
      ),
    onError: (err) => {
      // Engine/provider failure with no real content delivered: refund. Once
      // any content reached the client, the work (and tokens) were real.
      //
      // EXCEPT a client abort (`request.signal.aborted`): refunding an
      // aborted request would let an authenticated user loop "POST a large
      // history, abort as soon as headers return" indefinitely — burning
      // real provider input tokens (the full prompt + tool list) while their
      // cap never decrements. Product decision (Manuel, this fix round): an
      // abort NEVER refunds, regardless of how early it lands. The accepted
      // trade-off is that a user who legitimately hits Stop within the first
      // instant — before a single output token — is charged one of their
      // lifetime playground messages anyway. Do not "fix" this back; the
      // refund exists for genuine provider/infra failures, not for aborts.
      //
      // onError must return synchronously (its return value is the error
      // text sent to the client), so this can't be awaited — but it also
      // can't be a bare `void` fire-and-forget: an unhandled rejection here
      // (e.g. a DB blip during the same outage that triggered the refund)
      // would both permanently strand the user's claim AND surface as an
      // unhandled promise rejection. Attach a catch instead.
      if (!delivered && !request.signal.aborted) {
        refundPlaygroundMessage(db, userId).catch((refundErr) =>
          console.error("[playground] refund failed", refundErr)
        );
      }
      return logAndGenericError("[playground] turn failed", err);
    },
  });
  return createUIMessageStreamResponse({ stream });
});

async function handleResume(
  request: NextRequest,
  userId: string,
  model: NonNullable<ReturnType<typeof getPlaygroundModel>>,
  resumeToken: string,
  rawDecisions: unknown
): Promise<Response> {
  const decisions =
    rawDecisions && typeof rawDecisions === "object"
      ? (rawDecisions as Record<string, unknown>)
      : {};
  const pending = takePending(userId, resumeToken);
  if (!pending) {
    // Unknown/expired/foreign token — one-shot error stream (no claim to refund).
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({
          type: "error",
          errorText: "This confirmation expired — please run the prompt again.",
        });
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  // Shares `isApproved` with engine.ts's actual write gate (single source of
  // truth) even though this particular read only feeds analytics — so the
  // two never have a chance to diverge.
  const anyApproved = pending.writes.some((w) => isApproved(decisions, w.id));
  void trackPlaygroundConfirm(
    db, userId, anyApproved ? "approved" : "denied", pending.writes.length
  );

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const tools = await listUserEngineTools(db, userId);
      const deps = engineDeps(userId, model, tools, request.signal);
      const { toolMessage, outcomes } = await executeWriteBatch(deps, pending.writes, decisions);

      // Close out each gated write's tool card. `streamText` enqueues the
      // tool-call chunk BEFORE it checks `tool.execute != null` (ai@6.0.235
      // dist/index.js ~:6819), so an unexecuted write still reached the
      // client as a `dynamic-tool` part in state `input-available` — i.e.
      // rendered as a pulsing "Running" forever, even after a Deny, because
      // the route (not the SDK) is what actually runs these. `outcomes` is
      // produced by `executeWriteBatch` one-per-write in `pending.writes`
      // order, so index i lines up with `pending.writes[i].id`.
      //
      // `processUIMessageStream`'s `getToolInvocation` falls back to a
      // backwards scan over ALL of the message's parts (dist/index.js
      // ~:5822-5833), so these resolve their parts across the step boundary
      // even though the tool call was emitted on the previous request.
      //
      // `data-write-outcome` stays as-is below — the client renders its
      // approved/denied badges off that, independently of the tool cards.
      //
      // Three terminal states, not two. A DENIED write is not an error: the
      // SDK's `tool-output-denied` puts the part in state `output-denied`,
      // which tool.tsx already maps to an orange "Denied" badge rather than a
      // red "Error". That chunk carries only a toolCallId (no message field),
      // so the card body renders empty — which is right here: the user is the
      // one who pressed Deny, the header says "Denied", and the
      // `data-write-outcome` row adds a per-write `denied` badge. The text we
      // drop ("User declined this action.") was written for the MODEL, and it
      // still goes to the model via `toolMessage`.
      pending.writes.forEach((w, i) => {
        const outcome = outcomes[i];
        if (outcome === undefined) return;
        if (outcome.denied) {
          writer.write({ type: "tool-output-denied", toolCallId: w.id });
          return;
        }
        const result = toolMessage.role === "tool" ? toolMessage.content[i] : undefined;
        const text =
          result?.type === "tool-result" && "value" in result.output
            ? String(result.output.value)
            : "";
        writer.write(
          outcome.isError
            ? { type: "tool-output-error", toolCallId: w.id, errorText: text }
            : { type: "tool-output-available", toolCallId: w.id, output: text }
        );
      });

      writer.write({ type: "data-write-outcome", data: { outcomes } });
      const history = [...pending.messages, toolMessage];
      await runTurnIntoStream(userId, deps, history, writer, () => {});
    },
    // No cap was claimed on resume, so nothing to refund.
    onError: (err) => logAndGenericError("[playground] resume failed", err),
  });
  return createUIMessageStreamResponse({ stream });
}
