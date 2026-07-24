import { NextRequest, NextResponse } from "next/server";
import {
  createUIMessageStream, createUIMessageStreamResponse, type UIMessageStreamWriter,
} from "ai";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { getEnv } from "@datatorag-mcp/config";
import { getPlaygroundModel } from "@/lib/llm";
import {
  streamEngineTurn, detectPause, executeWriteBatch, type EngineDeps,
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
const NON_CONTENT_CHUNK_TYPES = new Set([
  "start", "start-step", "finish-step", "finish", "abort", "message-metadata", "error",
]);

/** Tap a UIMessage-chunk stream so the route knows whether any REAL content
 * (text, reasoning, a tool call/result, a source/file, or a custom data
 * part) reached the response — the successor of the old `workStarted` flag;
 * it gates the refund decision (a turn that dies with zero content parts
 * delivered refunds). Structural/bookkeeping chunks never flip it. */
function tapDelivered<T extends { type: string }>(
  stream: ReadableStream<T>,
  onFirst: () => void
): ReadableStream<T> {
  let fired = false;
  return stream.pipeThrough(
    new TransformStream<T, T>({
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
  history: Parameters<typeof streamEngineTurn>[1],
  writer: UIMessageStreamWriter,
  markDelivered: () => void
): Promise<void> {
  const result = streamEngineTurn(deps, history);
  const tapped = tapDelivered(result.toUIMessageStream(), markDelivered);
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
      if (!delivered) void refundPlaygroundMessage(db, userId);
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

  const anyApproved = pending.writes.some((w) => decisions[w.id] === "approve");
  void trackPlaygroundConfirm(
    db, userId, anyApproved ? "approved" : "denied", pending.writes.length
  );

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const tools = await listUserEngineTools(db, userId);
      const deps = engineDeps(userId, model, tools, request.signal);
      const { toolMessage, outcomes } = await executeWriteBatch(deps, pending.writes, decisions);
      writer.write({ type: "data-write-outcome", data: { outcomes } });
      const history = [...pending.messages, toolMessage];
      await runTurnIntoStream(userId, deps, history, writer, () => {});
    },
    // No cap was claimed on resume, so nothing to refund.
    onError: (err) => logAndGenericError("[playground] resume failed", err),
  });
  return createUIMessageStreamResponse({ stream });
}
