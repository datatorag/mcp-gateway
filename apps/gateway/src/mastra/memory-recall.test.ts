import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { InMemoryStore } from "@mastra/core/storage";
import { handleChatStream } from "@mastra/ai-sdk";

vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({ ANTHROPIC_API_KEY: "test-key", PLAYGROUND_MODEL: "claude-haiku-4-5" }),
}));

import { createDatatoragAgent, DATATORAG_AGENT_ID, MEMORY_LAST_MESSAGES } from "./agents/datatorag";
import { deriveThreadId } from "./run-ownership";

/**
 * Where the conversation in the prompt comes from, measured on the bytes that
 * leave the process.
 *
 * TWO SOURCES, ONE PROMPT. The chat client posts the WHOLE conversation on
 * every turn — that is the transport's default and we removed the hook that
 * could change it — and the agent additionally has memory attached, which
 * recalls the same conversation out of storage. Nothing in either layer's
 * types says what happens when both supply the same turn, and the failure
 * mode is silent: a prompt that carries the conversation twice still answers
 * correctly, so nothing surfaces except a provider bill that grows
 * quadratically with conversation length. We bill by the turn, so that cost
 * is entirely ours.
 *
 * The measurement below is therefore a COUNT, not a smoke test: an early
 * message must appear in the outgoing prompt exactly once, and the prompt must
 * hold exactly as many messages as the conversation has. Both numbers are
 * pinned so that a dependency bump which starts concatenating instead of
 * merging fails here rather than on an invoice.
 *
 * The store is in-memory because what is under test is the merge, which is the
 * same code path on any store. That persistence itself reaches Postgres and
 * survives the process is a different claim, proven against a real database in
 * `e2e/playground-persistence.e2e.test.ts`.
 */

/** A recognisable string that can only have come from turn one. */
const MARKER = "PLATYPUS-7";

type UIMessage = { id: string; role: string; parts: Array<Record<string, unknown>> };
type ProviderMessage = { role: string; content: unknown };
type CapturedBody = { messages?: ProviderMessage[] };

const captured: CapturedBody[] = [];
let replyText = "ok";

/** The smallest Anthropic stream that parses — the subject under test is the
 * REQUEST, and the reply only has to be identifiable. */
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

beforeEach(() => {
  captured.length = 0;
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!String(url).includes("api.anthropic.com")) {
      throw new Error(`unexpected request to ${String(url)}`);
    }
    captured.push(JSON.parse(String(init?.body ?? "{}")) as CapturedBody);
    return anthropicStreamResponse(replyText);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A runtime on a caller-supplied store, with no tools — the conversation is
 * the subject, and a tool set would only add noise to the prompt. */
function runtime(storage: InMemoryStore): Mastra {
  return new Mastra({
    storage,
    agents: { [DATATORAG_AGENT_ID]: createDatatoragAgent(storage, async () => ({})) },
    logger: false,
  });
}

/** One turn, returning the provider request it produced and the assistant
 * message the client would have appended to its own list.
 *
 * The assistant id is read off the stream rather than invented, because that
 * is what the real client does and it is exactly what the de-duplication
 * depends on: an id the client echoes back must be recognised as the message
 * already in storage, not filed as a second one. */
async function turn(opts: {
  mastra: Mastra;
  thread: string;
  resource: string;
  messages: UIMessage[];
  reply: string;
}): Promise<{ body: CapturedBody; assistant: UIMessage }> {
  captured.length = 0;
  replyText = opts.reply;

  const stream = (await handleChatStream({
    mastra: opts.mastra,
    agentId: DATATORAG_AGENT_ID,
    version: "v6",
    params: {
      messages: opts.messages,
      trigger: "submit-message",
      requestContext: new RequestContext(),
      memory: { thread: opts.thread, resource: opts.resource },
    },
  } as never)) as ReadableStream<{ type?: string; messageId?: string; delta?: string }>;

  const reader = stream.getReader();
  let id = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.type === "start" && typeof value.messageId === "string") id = value.messageId;
    if (value?.type === "text-delta" && typeof value.delta === "string") text += value.delta;
  }

  expect(captured).toHaveLength(1);
  return {
    body: captured[0]!,
    assistant: { id, role: "assistant", parts: [{ type: "text", text, state: "done" }] },
  };
}

function userMessage(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

/** Occurrences of `needle` across the prompt's messages.
 *
 * Takes the whole turn rather than its `body`, because the two are easy to
 * confuse at a call site and getting it wrong reads as ZERO occurrences — the
 * exact value two of the tests below assert, which would make them pass while
 * measuring nothing. Narrowing the parameter puts that mistake in the type
 * checker. */
function countInPrompt(turnResult: { body: CapturedBody }, needle: string): number {
  return JSON.stringify(turnResult.body.messages ?? []).split(needle).length - 1;
}

const USER = "memory-user-a";
const OTHER_USER = "memory-user-b";
/** The conversation id is chosen by the browser, so both users can send the
 * same one — that is the whole point of the derivation being tested. */
const CLIENT_CHAT_ID = "client-chat-1";

describe("playground conversation memory, on the wire", () => {
  it("sends a multi-turn conversation exactly once, not once per source", async () => {
    const storage = new InMemoryStore();
    const mastra = runtime(storage);
    const thread = deriveThreadId(USER, CLIENT_CHAT_ID);

    // The client's own list, posted in full on every turn — DefaultChatTransport
    // with no `prepareSendMessagesRequest`, which is what the playground uses.
    const history: UIMessage[] = [userMessage("u1", `Remember the codeword: ${MARKER}.`)];
    const first = await turn({ mastra, thread, resource: USER, messages: history, reply: "noted-1" });
    history.push(first.assistant);

    history.push(userMessage("u2", "What is 2 plus 2?"));
    const second = await turn({ mastra, thread, resource: USER, messages: history, reply: "noted-2" });
    history.push(second.assistant);

    history.push(userMessage("u3", "What was the codeword?"));
    const third = await turn({ mastra, thread, resource: USER, messages: history, reply: "noted-3" });

    // THE MEASUREMENT. Three user turns and two answers is five messages; the
    // conversation is also sitting in memory in full, and a naive merge would
    // send nine. Both the total and the per-message count are asserted: a
    // total alone could be satisfied by dropping a message instead of merging
    // it, which is the opposite failure and just as bad.
    expect(third.body.messages).toHaveLength(5);
    expect(countInPrompt(third, MARKER)).toBe(1);
    expect(countInPrompt(third, "noted-1")).toBe(1);
    expect(countInPrompt(third, "noted-2")).toBe(1);
    expect(third.body.messages?.map((m) => m.role)).toEqual([
      "user", "assistant", "user", "assistant", "user",
    ]);
  });

  it("recalls the conversation from storage, not from the request", async () => {
    const storage = new InMemoryStore();
    const thread = deriveThreadId(USER, CLIENT_CHAT_ID);

    // Turn one on one runtime...
    const before = runtime(storage);
    const opening = await turn({
      mastra: before,
      thread,
      resource: USER,
      messages: [userMessage("u1", `Remember the codeword: ${MARKER}.`)],
      reply: "noted-1",
    });
    expect(opening.body.messages).toHaveLength(1);

    // ...and turn two on a runtime built from scratch, sent ONLY the new
    // message. Nothing in this request mentions the codeword, so a prompt that
    // contains it can only have been assembled out of the store. This is the
    // in-process shape of surviving a restart; the real one is the e2e suite.
    const after = runtime(storage);
    const resumed = await turn({
      mastra: after,
      thread,
      resource: USER,
      messages: [userMessage("u2", "What was the codeword?")],
      reply: "noted-2",
    });

    expect(countInPrompt(resumed, MARKER)).toBe(1);
    expect(resumed.body.messages).toHaveLength(3);
  });

  it("keeps one user's conversation out of another's, on the same chat id", async () => {
    const storage = new InMemoryStore();
    const mastra = runtime(storage);

    await turn({
      mastra,
      thread: deriveThreadId(USER, CLIENT_CHAT_ID),
      resource: USER,
      messages: [userMessage("u1", `Remember the codeword: ${MARKER}.`)],
      reply: "noted-1",
    });

    // The SAME browser-chosen conversation id, a different signed-in user.
    // The derivation folds the user in, so this is a different thread and the
    // recall above is unreachable from here — no filtering step to forget.
    const other = await turn({
      mastra,
      thread: deriveThreadId(OTHER_USER, CLIENT_CHAT_ID),
      resource: OTHER_USER,
      messages: [userMessage("b1", "What was the codeword?")],
      reply: "noted-b",
    });

    expect(countInPrompt(other, MARKER)).toBe(0);
    expect(other.body.messages).toHaveLength(1);
  });

  it("recalls no more than the configured window", () => {
    // Guards the one number that turns recall into an unbounded prompt. It is
    // asserted rather than merely exported so that raising it is a deliberate
    // edit to a test that states the cost, not a one-character change.
    expect(MEMORY_LAST_MESSAGES).toBe(20);
  });
});
