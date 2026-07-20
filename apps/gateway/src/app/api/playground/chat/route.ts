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
      const emit = (e: EngineEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
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
        // Engine-level failure (e.g. Anthropic outage): refund the claimed
        // message so a provider-side error never burns the user's cap.
        await refundPlaygroundMessage(db, userId);
        const message = err instanceof Error ? err.message : "Unknown error";
        emit({ type: "done", stopReason: `error: ${message}` });
      } finally {
        controller.close();
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
