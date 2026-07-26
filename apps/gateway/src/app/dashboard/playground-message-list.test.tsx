// @vitest-environment jsdom

/**
 * Does the chat actually SHOW what the agent did?
 *
 * This suite exists because of one specific failure mode, and it is not a type
 * error: the message list matched a part type the runtime does not produce, so
 * every tool card and every approval prompt rendered as nothing at all while
 * text streamed perfectly, `tsc` was clean, the build passed and the unit suite
 * was green. Nothing that inspects types can catch that — only something that
 * looks at the rendered DOM.
 *
 * So the test drives real `UIMessageChunk`s through the SDK's own client-side
 * assembly (`readUIMessageStream` — the same code path `useChat` runs), mounts
 * the resulting messages, and asserts on what a user would see.
 *
 * The stream below is shaped like a real gated turn: a read tool that
 * completes, some prose, a write tool that pauses for approval — and then it
 * STOPS. No `finish-step`, no `finish`. That is not an oversight in the
 * fixture; it is what a suspended turn looks like on the wire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readUIMessageStream, type UIMessageChunk } from "ai";

import {
  MessageList,
  isToolPart,
  pendingApprovalId,
  type PlaygroundMessage,
} from "./playground-presentation";

/** An approval id in the shape the server actually mints: a nonce, `~`, a
 * base64url HMAC tag, then `::` and the tool-call id.
 *
 * It is a credential, not a label. Every character below is load-bearing —
 * the server recomputes the tag over the nonce and the session user and
 * compares it in constant time — so the assertions here are on strict
 * equality with this literal. A UI that "tidied" the `~`, re-encoded the
 * base64url, or rebuilt the id from its parts would still render a perfectly
 * good-looking Approve button that always 403s. */
const APPROVAL_ID =
  "Zm9vYmFyYmF6cXV4MTIzNA~x9Kj-_2QlZ0nT4pRs6VbWc8dYeAfGhIjKlMnOpQrStU::call-2";

/** One suspended turn, chunk for chunk. */
const SUSPENDED_TURN: UIMessageChunk[] = [
  { type: "start", messageId: "assistant-1" },
  { type: "start-step" },
  {
    type: "tool-input-start",
    toolCallId: "call-1",
    toolName: "gws-mcp__gmail_search",
  },
  {
    type: "tool-input-available",
    toolCallId: "call-1",
    toolName: "gws-mcp__gmail_search",
    input: { query: "invoice" },
  },
  { type: "tool-output-available", toolCallId: "call-1", output: { messages: [] } },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Found nothing. I'll draft the doc." },
  { type: "text-end", id: "t1" },
  {
    type: "tool-input-start",
    toolCallId: "call-2",
    toolName: "gws-mcp__docs_create",
  },
  {
    type: "tool-input-available",
    toolCallId: "call-2",
    toolName: "gws-mcp__docs_create",
    input: { title: "Q3 report" },
  },
  { type: "tool-approval-request", toolCallId: "call-2", approvalId: APPROVAL_ID },
  // Ends here. A gated turn emits no `finish`.
];

function chunkStream(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** Assemble a stream the way the chat runtime does, and hand back the final
 * message state — exactly what `useChat` would put in `messages`. */
async function assemble(chunks: UIMessageChunk[]): Promise<PlaygroundMessage> {
  let last: PlaygroundMessage | undefined;
  for await (const message of readUIMessageStream<PlaygroundMessage>({
    stream: chunkStream(chunks),
  })) {
    last = message;
  }
  if (!last) throw new Error("stream produced no message");
  return last;
}

let container: HTMLDivElement;
let root: Root;
const onDecide = vi.fn();

function render(messages: PlaygroundMessage[], awaitingConfirm: boolean) {
  act(() => {
    root.render(
      <MessageList
        awaitingConfirm={awaitingConfirm}
        busy={false}
        comments={{}}
        erroredIds={new Set()}
        feedback={{}}
        lastMessageComplete
        messages={messages}
        onCommentChange={() => {}}
        onDecide={onDecide}
        onRate={() => {}}
        onRegenerate={() => {}}
        onSendComment={() => {}}
      />
    );
  });
}

/** The visible text of the whole list, whitespace-normalised. */
function visibleText(): string {
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

function buttonLabelled(label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find((el) =>
    (el.textContent ?? "").includes(label)
  );
  if (!match) {
    throw new Error(
      `no button labelled ${JSON.stringify(label)} — rendered: ${visibleText()}`
    );
  }
  return match;
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the assembled parts", () => {
  it("assembles MCP tool calls as `tool-<name>`, never as `dynamic-tool`", async () => {
    const message = await assemble(SUSPENDED_TURN);
    const toolParts = message.parts.filter(isToolPart);

    // The whole reason this file exists: the UI used to match `dynamic-tool`,
    // and nothing in the stream ever produces one.
    expect(toolParts.map((part) => part.type)).toEqual([
      "tool-gws-mcp__gmail_search",
      "tool-gws-mcp__docs_create",
    ]);
    expect(message.parts.some((part) => part.type === "dynamic-tool")).toBe(false);
  });

  it("carries the approval id through assembly byte for byte", async () => {
    const message = await assemble(SUSPENDED_TURN);
    const ids = message.parts.map(pendingApprovalId).filter(Boolean);

    expect(ids).toEqual([APPROVAL_ID]);
  });
});

describe("what the user sees for a suspended turn", () => {
  it("renders a card for every tool call, with its own state", async () => {
    render([await assemble(SUSPENDED_TURN)], true);
    const text = visibleText();

    // Short names, not the `<slug>__<tool>` wire names.
    expect(text).toContain("gmail_search");
    expect(text).toContain("docs_create");
    // The completed read and the gated write are visibly different.
    expect(text).toContain("Completed");
    expect(text).toContain("Awaiting Approval");
  });

  it("renders the confirm card from the approval request, with the arguments", async () => {
    render([await assemble(SUSPENDED_TURN)], true);
    const text = visibleText();

    expect(text).toContain("Approve this action before it runs?");
    expect(text).toContain('{"title":"Q3 report"}');
    expect(buttonLabelled("Approve & run")).toBeTruthy();
    expect(buttonLabelled("Deny")).toBeTruthy();
  });

  it("shows exactly one confirm card — the completed tool gets none", async () => {
    render([await assemble(SUSPENDED_TURN)], true);

    const approveButtons = Array.from(container.querySelectorAll("button")).filter(
      (el) => (el.textContent ?? "").includes("Approve & run")
    );
    expect(approveButtons).toHaveLength(1);
  });

  it("offers no regenerate/feedback row while the turn waits on a decision", async () => {
    // The stream closed and the status is `ready`, because a suspended turn's
    // body really does end — there is just no `finish` part in it. Treating
    // that as "the turn is over" would put a Regenerate button under a
    // conversation the user still owes an answer to.
    render([await assemble(SUSPENDED_TURN)], true);

    expect(visibleText()).not.toContain("Regenerate");
  });

  it("reports the approval id back UNCHANGED when the user approves", async () => {
    render([await assemble(SUSPENDED_TURN)], true);

    act(() => {
      buttonLabelled("Approve & run").click();
    });

    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith(APPROVAL_ID, true);
    // Belt and braces: strict identity of the string, so a transform that
    // happened to round-trip to something `toHaveBeenCalledWith` liked still
    // fails.
    expect(onDecide.mock.calls[0]![0]).toBe(APPROVAL_ID);
  });

  it("reports the same id when the user denies", async () => {
    render([await assemble(SUSPENDED_TURN)], true);

    act(() => {
      buttonLabelled("Deny").click();
    });

    expect(onDecide).toHaveBeenCalledWith(APPROVAL_ID, false);
  });
});

describe("after the decision", () => {
  /** The approval leg: the decision is recorded on the part, the write runs,
   * and the turn finishes normally. */
  const APPROVED_AND_RAN: UIMessageChunk[] = [
    ...SUSPENDED_TURN,
    { type: "tool-approval-response", approvalId: APPROVAL_ID, approved: true },
    {
      type: "tool-output-available",
      toolCallId: "call-2",
      output: { url: "https://docs.example/1" },
    },
    { type: "finish-step" },
    { type: "finish" },
  ];

  /** The same turn, refused. */
  const DENIED: UIMessageChunk[] = [
    ...SUSPENDED_TURN,
    { type: "tool-approval-response", approvalId: APPROVAL_ID, approved: false },
    { type: "tool-output-denied", toolCallId: "call-2" },
    { type: "finish-step" },
    { type: "finish" },
  ];

  it("drops the confirm card and shows the write's result", async () => {
    render([await assemble(APPROVED_AND_RAN)], false);
    const text = visibleText();

    expect(text).not.toContain("Approve this action before it runs?");
    // An ordinary tool result now — no custom payload renders this.
    expect(text).toContain("Completed");
  });

  it("distinguishes denied from never-ran, which used to be one flag", async () => {
    render([await assemble(DENIED)], false);
    expect(visibleText()).toContain("Denied");

    // A call that was approved but whose turn ended before it produced
    // anything is a different thing, and says so.
    const abandoned: UIMessageChunk[] = [
      ...SUSPENDED_TURN,
      { type: "tool-approval-response", approvalId: APPROVAL_ID, approved: true },
    ];
    render([await assemble(abandoned)], false);
    const text = visibleText();
    expect(text).toContain("Responded");
    expect(text).not.toContain("Denied");
  });
});
