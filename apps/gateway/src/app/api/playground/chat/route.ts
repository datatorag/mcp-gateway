import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { getEnv } from "@datatorag-mcp/config";
import { getPlaygroundLlm } from "@/lib/llm";
import {
  runPlaygroundTurn,
  resumePlaygroundTurn,
  type EngineEvent,
  type TurnResult,
} from "@/gateway/playground/engine";
import {
  listUserEngineTools,
  executeUserTool,
} from "@/gateway/playground/tools";
import { claimPlaygroundMessage, refundPlaygroundMessage } from "@/gateway/playground/cap";
import { putPending, takePending } from "@/gateway/playground/pending";
import {
  trackPlaygroundMessage,
  trackPlaygroundToolCall,
  trackPlaygroundCapHit,
  trackPlaygroundConfirm,
} from "@/gateway/track";
import { logAndGenericError } from "@/lib/errors";

type ChatMessage = { role: string; content: string };

// The engine deps common to both entry points (fresh turn + resume). tools,
// isWrite (both from listUserEngineTools), messages, emit and shouldStop differ
// per path and are supplied at the call.
function engineBase(userId: string, llm: NonNullable<ReturnType<typeof getPlaygroundLlm>>) {
  return {
    llm,
    model: getEnv().PLAYGROUND_MODEL,
    executeTool: (name: string, args: Record<string, unknown>) => {
      void trackPlaygroundToolCall(db, userId, name);
      return executeUserTool(db, userId, name, args);
    },
  };
}

// A paused turn returns awaiting_confirmation — persist it and hand the user
// the pending writes to approve/deny. complete/aborted need nothing (the
// engine already emitted `done`).
function handleTurnResult(
  userId: string,
  result: TurnResult,
  emit: (e: EngineEvent) => void
): void {
  if (result.status === "awaiting_confirmation") {
    const token = putPending(userId, result.messages, result.batch, result.pending);
    emit({ type: "confirm", resumeToken: token, pending: result.pending });
    void trackPlaygroundConfirm(db, userId, "shown", result.pending.length);
  }
}

// Wraps a turn's work in the SSE ReadableStream + emit plumbing. `clientGone`
// tracks an aborted controller (enqueue throws); `workStarted` whether any
// event reached the client — both gate the caller's refund decision so an
// abort mid-stream can't become a free, uncapped turn.
function streamResponse(
  work: (ctx: {
    emit: (e: EngineEvent) => void;
    clientGone: () => boolean;
    workStarted: () => boolean;
    shouldStop: () => boolean;
  }) => Promise<void>,
  signal: AbortSignal | undefined
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let clientGone = false;
      let workStarted = false;
      const emit = (e: EngineEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          workStarted = true;
        } catch {
          // Controller already closed/errored — the client went away. Never
          // let this propagate into the engine loop.
          clientGone = true;
        }
      };
      try {
        await work({
          emit,
          clientGone: () => clientGone,
          workStarted: () => workStarted,
          // Stops the loop (and pending tool execution) as soon as the client
          // is gone or the request aborted — otherwise the loop runs to the
          // iteration cap against a dead stream, executing real side effects.
          shouldStop: () => clientGone || signal?.aborted === true,
        });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed/errored (client gone) — nothing to do.
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// Coerce the client's decisions payload to a plain object. The per-value
// meaning (approve vs deny) is enforced downstream by the engine's strict
// `=== "approve"` check — safe-default deny — so this only guarantees the
// engine receives an object (never undefined, which would skip the gate).
function decisionMap(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

// POST /api/playground/chat — capped, streaming (SSE) playground chat turn.
// With { resumeToken, decisions } it instead resumes a turn paused at a write
// (no new cap claim — same logical turn).
export const POST = withRoute(async (userId, request) => {
  const llm = getPlaygroundLlm();
  if (!llm) {
    return NextResponse.json({ error: "playground_disabled" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    messages?: ChatMessage[];
    resumeToken?: string;
    decisions?: unknown;
  } | null;

  if (typeof body?.resumeToken === "string") {
    return handleResume(request, userId, llm, body.resumeToken, body.decisions);
  }

  const messages = body?.messages;
  if (!messages?.length || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const cap = getEnv().PLAYGROUND_MESSAGE_CAP;
  if (!(await claimPlaygroundMessage(db, userId, cap))) {
    void trackPlaygroundCapHit(db, userId);
    return NextResponse.json({ error: "cap_exceeded", cap }, { status: 429 });
  }
  void trackPlaygroundMessage(db, userId);

  let tools, isWrite;
  try {
    ({ tools, isWrite } = await listUserEngineTools(db, userId));
  } catch (err) {
    // Pre-stream failure after the claim landed — refund so this doesn't burn
    // one of the user's lifetime playground messages.
    await refundPlaygroundMessage(db, userId);
    return NextResponse.json(
      { error: logAndGenericError("[playground] tool listing failed", err) },
      { status: 500 }
    );
  }

  return streamResponse(async ({ emit, clientGone, workStarted, shouldStop }) => {
    try {
      const result = await runPlaygroundTurn({
        ...engineBase(userId, llm),
        tools,
        isWrite,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        emit,
        shouldStop,
      });
      handleTurnResult(userId, result, emit);
    } catch (err) {
      // Engine/provider failure with no work delivered yet: refund. Not if the
      // client already went away or any event was delivered — that work (and
      // the tokens spent) is real.
      if (!clientGone() && !workStarted()) {
        await refundPlaygroundMessage(db, userId);
      }
      emit({
        type: "error",
        message: logAndGenericError("[playground] turn failed", err),
      });
    }
  }, request.signal);
});

async function handleResume(
  request: NextRequest,
  userId: string,
  llm: NonNullable<ReturnType<typeof getPlaygroundLlm>>,
  resumeToken: string,
  rawDecisions: unknown
): Promise<Response> {
  const decisions = decisionMap(rawDecisions);
  const pending = takePending(userId, resumeToken);
  if (!pending) {
    // Unknown/expired/foreign token — one-shot error stream (no claim to refund).
    return streamResponse(async ({ emit }) => {
      emit({
        type: "error",
        message: "This confirmation expired — please run the prompt again.",
      });
    }, request.signal);
  }

  // The gated writes were classified at pause time and stored — track the
  // user's decision from them, no re-classification needed.
  const anyApproved = pending.writes.some((w) => decisions[w.id] === "approve");
  void trackPlaygroundConfirm(
    db,
    userId,
    anyApproved ? "approved" : "denied",
    pending.writes.length
  );

  return streamResponse(async ({ emit, shouldStop }) => {
    try {
      const { tools, isWrite } = await listUserEngineTools(db, userId);
      const result = await resumePlaygroundTurn({
        ...engineBase(userId, llm),
        tools,
        isWrite,
        messages: pending.messages,
        batch: pending.batch,
        decisions,
        emit,
        shouldStop,
      });
      handleTurnResult(userId, result, emit);
    } catch (err) {
      // No cap was claimed on resume, so nothing to refund.
      emit({
        type: "error",
        message: logAndGenericError("[playground] resume failed", err),
      });
    }
  }, request.signal);
}
