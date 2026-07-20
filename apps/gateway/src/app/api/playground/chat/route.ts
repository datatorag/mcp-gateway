import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { getEnv } from "@datatorag-mcp/config";
import { getPlaygroundLlm, isPlaygroundEnabled } from "@/lib/llm";
import { runPlaygroundTurn, type EngineEvent } from "@/gateway/playground/engine";
import { listUserEngineTools, executeUserTool } from "@/gateway/playground/tools";
import { claimPlaygroundMessage, refundPlaygroundMessage } from "@/gateway/playground/cap";
import {
  trackPlaygroundMessage,
  trackPlaygroundToolCall,
  trackPlaygroundCapHit,
} from "@/gateway/track";

type ChatMessage = { role: string; content: string };

// POST /api/playground/chat — capped, streaming (SSE) playground chat turn.
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPlaygroundEnabled()) {
    return NextResponse.json({ error: "playground_disabled" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    messages?: ChatMessage[];
  } | null;
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
  let llm;
  try {
    tools = await listUserEngineTools(db, userId);
    llm = getPlaygroundLlm();
    if (!llm) throw new Error("Playground LLM unavailable");
  } catch (err) {
    // Pre-stream failure after the claim landed — refund so this doesn't
    // burn one of the user's lifetime playground messages.
    await refundPlaygroundMessage(db, userId);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // clientGone: the client aborted (unmount / superseded send) and the
      // controller can no longer be enqueued to. workStarted: at least one
      // event was actually delivered to the client. Both gate the refund
      // below — once the client has gone away or work has been delivered,
      // a later throw (enqueue-on-closed-controller, most commonly) must
      // NOT refund, or aborting mid-stream becomes a free, uncapped turn.
      let clientGone = false;
      let workStarted = false;
      const emit = (e: EngineEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          workStarted = true;
        } catch {
          // Controller already closed/errored — the client went away.
          // Never let this propagate into the engine loop.
          clientGone = true;
        }
      };
      try {
        await runPlaygroundTurn({
          llm: llm!,
          model: getEnv().PLAYGROUND_MODEL,
          tools,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          executeTool: (name, args) => {
            void trackPlaygroundToolCall(db, userId, name);
            return executeUserTool(db, userId, name, args);
          },
          emit,
        });
      } catch (err) {
        // Engine/provider-level failure (e.g. Anthropic outage) with no work
        // delivered yet: refund the claimed message so a provider-side error
        // never burns the user's cap. Do NOT refund if the client already
        // went away or any event was already delivered — that work (and any
        // tokens spent producing it) is real, not something to undo.
        if (!clientGone && !workStarted) {
          await refundPlaygroundMessage(db, userId);
        }
        const message = err instanceof Error ? err.message : "Unknown error";
        emit({ type: "done", stopReason: `error: ${message}` });
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
