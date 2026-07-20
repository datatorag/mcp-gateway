import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { getEnv } from "@datatorag-mcp/config";
import { getPlaygroundLlm } from "@/lib/llm";
import {
  runPlaygroundTurn,
  resumePlaygroundTurn,
  type EngineEvent,
  type TurnResult,
  type Decision,
} from "@/gateway/playground/engine";
import {
  listUserEngineTools,
  executeUserTool,
  isWriteTool,
} from "@/gateway/playground/tools";
import { claimPlaygroundMessage, refundPlaygroundMessage } from "@/gateway/playground/cap";
import { putPending, takePending } from "@/gateway/playground/pending";
import {
  trackPlaygroundMessage,
  trackPlaygroundToolCall,
  trackPlaygroundCapHit,
  trackPlaygroundConfirm,
} from "@/gateway/track";

type ChatMessage = { role: string; content: string };

// A tool executor bound to one user, tracking each call.
function makeExecuteTool(userId: string) {
  return (name: string, args: Record<string, unknown>) => {
    void trackPlaygroundToolCall(db, userId, name);
    return executeUserTool(db, userId, name, args);
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
    const token = putPending(userId, result.messages, result.batch);
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

function normalizeDecisions(raw: unknown): Record<string, Decision> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, Decision> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    out[id] = v === "approve" ? "approve" : "deny";
  }
  return out;
}

// POST /api/playground/chat — capped, streaming (SSE) playground chat turn.
// With { resumeToken, decisions } it instead resumes a turn paused at a write
// (no new cap claim — same logical turn).
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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

  let tools;
  try {
    tools = await listUserEngineTools(db, userId);
  } catch (err) {
    // Pre-stream failure after the claim landed — refund so this doesn't burn
    // one of the user's lifetime playground messages.
    await refundPlaygroundMessage(db, userId);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const model = getEnv().PLAYGROUND_MODEL;
  return streamResponse(async ({ emit, clientGone, workStarted, shouldStop }) => {
    try {
      const result = await runPlaygroundTurn({
        llm,
        model,
        tools,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        executeTool: makeExecuteTool(userId),
        emit,
        isWrite: isWriteTool,
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
      const message = err instanceof Error ? err.message : "Unknown error";
      emit({ type: "error", message });
    }
  }, request.signal);
}

async function handleResume(
  request: NextRequest,
  userId: string,
  llm: NonNullable<ReturnType<typeof getPlaygroundLlm>>,
  resumeToken: string,
  rawDecisions: unknown
): Promise<Response> {
  const decisions = normalizeDecisions(rawDecisions);
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

  const writes = pending.batch.filter((tu) => isWriteTool(tu.name));
  const anyApproved = writes.some((tu) => decisions[tu.id] === "approve");
  void trackPlaygroundConfirm(
    db,
    userId,
    anyApproved ? "approved" : "denied",
    writes.length
  );

  const model = getEnv().PLAYGROUND_MODEL;
  return streamResponse(async ({ emit, shouldStop }) => {
    try {
      const tools = await listUserEngineTools(db, userId);
      const result = await resumePlaygroundTurn({
        llm,
        model,
        tools,
        messages: pending.messages,
        batch: pending.batch,
        decisions,
        executeTool: makeExecuteTool(userId),
        emit,
        isWrite: isWriteTool,
        shouldStop,
      });
      handleTurnResult(userId, result, emit);
    } catch (err) {
      // No cap was claimed on resume, so nothing to refund.
      const message = err instanceof Error ? err.message : "Unknown error";
      emit({ type: "error", message });
    }
  }, request.signal);
}
