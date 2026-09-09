// @vitest-environment jsdom

/**
 * SCRUM-237: while a turn runs, the thread says what the agent is doing, and
 * every word of it is derived from the stream. The states are assembled the
 * way `useChat` assembles them (`readUIMessageStream` over partial chunk
 * streams that have not finished), so a state the runtime cannot produce
 * cannot be asserted here by accident.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readUIMessageStream, type UIMessageChunk } from "ai";

import {
  MessageList,
  progressFor,
  type PlaygroundMessage,
} from "./playground-presentation";

const START: UIMessageChunk[] = [{ type: "start", messageId: "assistant-1" }, { type: "start-step" }];

const TOOL_RUNNING: UIMessageChunk[] = [
  ...START,
  { type: "tool-input-start", toolCallId: "call-1", toolName: "gws-mcp__gmail_search" },
  {
    type: "tool-input-available",
    toolCallId: "call-1",
    toolName: "gws-mcp__gmail_search",
    input: { query: "is:unread" },
  },
];

const TOOL_DONE: UIMessageChunk[] = [
  ...TOOL_RUNNING,
  { type: "tool-output-available", toolCallId: "call-1", output: { messages: [] } },
];

const SECOND_STEP_WRITING: UIMessageChunk[] = [
  ...TOOL_DONE,
  { type: "finish-step" },
  { type: "start-step" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Nothing unread, so" },
];

function chunkStream(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

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

const USER_TURN: PlaygroundMessage = {
  id: "user-1",
  role: "user",
  parts: [{ type: "text", text: "Run the morning brief" }],
};

describe("progressFor", () => {
  it("says Thinking while the request is out and no assistant message exists yet", () => {
    expect(progressFor(true, USER_TURN)).toEqual({ label: "Thinking", step: 0 });
    expect(progressFor(true, undefined)).toEqual({ label: "Thinking", step: 0 });
  });

  it("names the tool that is running, by its short name", async () => {
    const message = await assemble(TOOL_RUNNING);
    expect(progressFor(true, message)).toEqual({ label: "Running gmail_search", step: 1 });
  });

  it("says Thinking between a tool result and the next model call", async () => {
    const message = await assemble(TOOL_DONE);
    expect(progressFor(true, message)).toEqual({ label: "Thinking", step: 1 });
  });

  it("says Writing while text streams, and counts the step from start-step parts", async () => {
    const message = await assemble(SECOND_STEP_WRITING);
    expect(progressFor(true, message)).toEqual({ label: "Writing", step: 2 });
  });

  it("is nothing once the stream has closed, whatever the parts say", async () => {
    // A tool part left in input-available after close is SCRUM-234's defect;
    // this row must not keep narrating it.
    const message = await assemble(TOOL_RUNNING);
    expect(progressFor(false, message)).toBeNull();
  });
});

describe("the progress row in the list", () => {
  let container: HTMLDivElement;
  let root: Root;

  function render(messages: PlaygroundMessage[], busy: boolean) {
    act(() => {
      root.render(
        <MessageList
          awaitingConfirm={false}
          busy={busy}
          comments={{}}
          erroredIds={new Set()}
          feedback={{}}
          lastMessageComplete={!busy}
          messages={messages}
          onCommentChange={() => {}}
          onDecide={() => {}}
          onRate={() => {}}
          onRegenerate={() => {}}
          onSendComment={() => {}}
        />
      );
    });
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the line while busy and drops it when the stream closes", async () => {
    const message = await assemble(SECOND_STEP_WRITING);
    render([USER_TURN, message], true);
    const row = container.querySelector('[data-testid="run-progress"]');
    expect(row?.textContent?.replace(/\s+/g, " ")).toContain("Step 2");
    expect(row?.textContent).toContain("Writing");

    render([USER_TURN, message], false);
    expect(container.querySelector('[data-testid="run-progress"]')).toBeNull();
  });
});
