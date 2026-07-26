// Env-gated end-to-end proof that the playground's conversation persistence
// is REAL — that a thread is written to Postgres, survives the runtime that
// created it, and is recalled from storage rather than from the request.
//
// Why this is a separate, opted-in suite: it writes to a real database. It
// runs only when PLAYGROUND_PERSISTENCE_URL is set, and deliberately does NOT
// fall back to DATABASE_URL — a fallback would mean that anyone with a shell
// configured for production runs a write test against production by typing
// `pnpm test`. Point it at a development branch and nothing else.
//
// What it does NOT claim: the process is not actually restarted here. The
// second leg builds a brand-new store, connection pool and runtime, which is
// what makes "the conversation came out of the database" checkable in one
// test — but the genuine two-process check (turns written by one `node`
// invocation, recalled by another) was run by hand against the dev branch, and
// this suite is the repeatable subset of it, not a replacement.
//
// Everything is scoped to a per-run unique user id, so concurrent runs cannot
// see each other, and the rows are deleted at the end.

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { PostgresStore } from "@mastra/pg";
import { handleChatStream } from "@mastra/ai-sdk";

vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({ ANTHROPIC_API_KEY: "test-key", PLAYGROUND_MODEL: "claude-haiku-4-5" }),
}));

import { createDatatoragAgent, DATATORAG_AGENT_ID } from "../src/mastra/agents/datatorag";
import { deriveThreadId } from "../src/gateway/playground/run-ownership";

const DB_URL = process.env.PLAYGROUND_PERSISTENCE_URL;

/** A string that can only have reached a later prompt through storage. */
const MARKER = `CODEWORD-${randomUUID().slice(0, 8)}`;

type CapturedBody = { messages?: Array<{ role: string; content: unknown }> };

const captured: CapturedBody[] = [];

function anthropicStreamResponse(text: string): Response {
  const event = (o: unknown) => `event: ${(o as { type: string }).type}\ndata: ${JSON.stringify(o)}\n\n`;
  return new Response(
    [
      event({
        type: "message_start",
        message: {
          id: "m1", type: "message", role: "assistant", model: "test", content: [],
          stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      }),
      event({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
      event({ type: "content_block_stop", index: 0 }),
      event({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      }),
      event({ type: "message_stop" }),
    ].join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

describe.runIf(!!DB_URL)("playground conversation persistence (real Postgres)", () => {
  const userId = `e2e-persistence-${randomUUID()}`;
  const threadId = deriveThreadId(userId, "client-chat-1");
  const sql = postgres(DB_URL ?? "", { max: 1 });

  afterAll(async () => {
    // Scoped to this run's thread only — never a blanket delete.
    await sql`delete from mastra_messages where thread_id = ${threadId}`;
    await sql`delete from mastra_threads where id = ${threadId}`;
    await sql.end({ timeout: 5 });
  });

  /** A runtime with its own store and pool. Building a second one is what
   * stands in for "the process that wrote this is gone". */
  function runtime() {
    const storage = new PostgresStore({
      id: `e2e-persistence-${randomUUID()}`,
      connectionString: DB_URL ?? "",
    });
    return new Mastra({
      storage,
      agents: { [DATATORAG_AGENT_ID]: createDatatoragAgent(storage, async () => ({})) },
      logger: false,
    });
  }

  async function turn(mastra: Mastra, text: string, reply: string): Promise<CapturedBody> {
    captured.length = 0;
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
      // Only the provider is stubbed; the database traffic below is real and
      // has to keep working.
      if (!String(url).includes("api.anthropic.com")) return realFetch(url, init);
      captured.push(JSON.parse(String(init?.body ?? "{}")) as CapturedBody);
      return anthropicStreamResponse(reply);
    });
    try {
      const stream = (await handleChatStream({
        mastra,
        agentId: DATATORAG_AGENT_ID,
        version: "v6",
        params: {
          messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text }] }],
          trigger: "submit-message",
          requestContext: new RequestContext(),
          memory: { thread: threadId, resource: userId },
        },
      } as never)) as ReadableStream<unknown>;
      const reader = stream.getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    } finally {
      vi.unstubAllGlobals();
    }
    expect(captured).toHaveLength(1);
    return captured[0]!;
  }

  it("writes the thread to Postgres and recalls it into a later runtime's prompt", async () => {
    // Leg one: the conversation happens.
    const opening = await turn(runtime(), `Remember the codeword: ${MARKER}.`, "noted-1");
    expect(opening.messages).toHaveLength(1);

    // The rows are really there — asserted by reading them back with an
    // ordinary Postgres client, not by trusting that no error was thrown.
    // Persistence that silently no-ops is the documented failure mode here:
    // passing a thread and resource with no memory attached logs a line and
    // stores nothing, which is indistinguishable from success at the API.
    const thread = await sql`select id, "resourceId" from mastra_threads where id = ${threadId}`;
    expect(thread).toHaveLength(1);
    expect(thread[0]!.resourceId).toBe(userId);

    const stored = await sql<Array<{ role: string; content: string }>>`
      select role, content::text as content from mastra_messages
      where thread_id = ${threadId} order by "createdAt"
    `;
    expect(stored.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(stored[0]!.content).toContain(MARKER);

    // Leg two: a runtime that has never seen this conversation, sent only a
    // new question. The codeword appears in its prompt, so it was assembled
    // out of the database.
    const resumed = await turn(runtime(), "What was the codeword?", "noted-2");
    expect(JSON.stringify(resumed.messages)).toContain(MARKER);
    // And exactly once — the conversation is recalled, not concatenated.
    expect(JSON.stringify(resumed.messages).split(MARKER).length - 1).toBe(1);
    expect(resumed.messages).toHaveLength(3);
    // Generous, and needed rather than defensive: this opens two connection
    // pools against a real (often cold-starting) database, and the store
    // reconciles its schema on first use. The unit suite's 30s default times
    // this out on a cold branch.
  }, 180_000);
});
