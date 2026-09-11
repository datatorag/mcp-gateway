// @vitest-environment jsdom

/**
 * SCRUM-237: while a turn runs, the thread says what the agent is doing, and
 * every word of it is derived from the stream. The states are assembled the
 * way `useChat` assembles them (`readUIMessageStream` over partial chunk
 * streams that have not finished), so a state the runtime cannot produce
 * cannot be asserted here by accident.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readUIMessageStream, type UIMessageChunk } from "ai";

import {
  MessageList,
  progressFor,
  type PlaygroundMessage,
} from "./playground-presentation";
import { RunControlContext } from "./agent-parts";

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

/* SCRUM-234: a stop is a notice with a way on, and a settled message never
 * says Running about a tool call whose result never came. */
describe("the stop notice and the interrupted card (SCRUM-234)", () => {
  let container: HTMLDivElement;
  let root: Root;

  const STOPPED: PlaygroundMessage = {
    id: "assistant-2",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-gws-mcp__gmail_search",
        toolCallId: "call-9",
        state: "output-available",
        input: {},
        output: { messages: [] },
      },
      { type: "data-run-stopped", data: { limit: "steps", steps: 60, cap: 60, skill: "morning-brief" } },
    ] as PlaygroundMessage["parts"],
  };

  function render(messages: PlaygroundMessage[], continueRun?: (slug: string) => void) {
    const list = (
      <MessageList
        awaitingConfirm={false}
        busy={false}
        comments={{}}
        erroredIds={new Set()}
        feedback={{}}
        lastMessageComplete
        messages={messages}
        onCommentChange={() => {}}
        onDecide={() => {}}
        onRate={() => {}}
        onRegenerate={() => {}}
        onSendComment={() => {}}
      />
    );
    act(() => {
      root.render(
        continueRun ? (
          <RunControlContext.Provider value={{ continueRun, busy: false }}>{list}</RunControlContext.Provider>
        ) : (
          list
        )
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

  it("names the limit and the steps completed, and Continue hands the slug to the container", () => {
    const continueRun = vi.fn();
    render([USER_TURN, STOPPED], continueRun);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("step limit");
    expect(text).toContain("60 steps");
    expect(text).toContain("saved");
    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Continue")
    );
    expect(button).toBeTruthy();
    act(() => button!.click());
    expect(continueRun).toHaveBeenCalledWith("morning-brief");
  });

  it("says size limit for the token ceiling, and offers no Continue where no container can act", () => {
    const sized: PlaygroundMessage = {
      ...STOPPED,
      parts: [
        STOPPED.parts[0]!,
        STOPPED.parts[1]!,
        { type: "data-run-stopped", data: { limit: "size", steps: 3, cap: null, skill: null } },
      ] as PlaygroundMessage["parts"],
    };
    render([USER_TURN, sized]);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("size limit");
    expect(text).toContain("3 steps");
    expect(Array.from(container.querySelectorAll("button")).some((b) => (b.textContent ?? "").includes("Continue"))).toBe(false);
  });

  it("says the run is still going, with no Continue, when the viewer came back mid-run (SCRUM-254)", () => {
    const running: PlaygroundMessage = {
      id: "run-status-r1",
      role: "assistant",
      parts: [
        { type: "data-run-stopped", data: { limit: "running", steps: 4, cap: 60, skill: "morning-brief" } },
      ] as PlaygroundMessage["parts"],
    };
    render([USER_TURN, STOPPED, running], vi.fn());
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/still (going|running)/i);
    expect(text).toContain("4 steps");
    expect(text).toMatch(/reload/i);
    expect(text).not.toContain("\u2014");
    // Two cards on the page; only the stopped one offers Continue.
    const buttons = Array.from(container.querySelectorAll("button")).filter((b) =>
      (b.textContent ?? "").includes("Continue")
    );
    expect(buttons).toHaveLength(1);
  });

  it("says the run stopped with an error, and offers Continue for a skill run (SCRUM-254)", () => {
    const continueRun = vi.fn();
    const failed: PlaygroundMessage = {
      id: "run-status-r2",
      role: "assistant",
      parts: [
        { type: "data-run-stopped", data: { limit: "error", steps: 2, cap: null, skill: "morning-brief" } },
      ] as PlaygroundMessage["parts"],
    };
    render([USER_TURN, failed], continueRun);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/error/i);
    expect(text).toContain("2 steps");
    expect(text).toContain("saved");
    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Continue")
    );
    expect(button).toBeTruthy();
    act(() => button!.click());
    expect(continueRun).toHaveBeenCalledWith("morning-brief");
  });

  it("the run summary line says the steps, the tokens and the cost (SCRUM-257)", () => {
    const summarised: PlaygroundMessage = {
      ...STOPPED,
      parts: [
        STOPPED.parts[0]!,
        STOPPED.parts[1]!,
        { type: "data-run-summary", data: { steps: 7, weightedTokens: 184_099, costUsd: 0.99, model: "claude-sonnet-5" } },
      ] as PlaygroundMessage["parts"],
    };
    render([USER_TURN, summarised]);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("7 steps");
    expect(text).toContain("184k tokens");
    expect(text).toMatch(/about \$0\.99/);
    expect(text).not.toContain("\u2014");
  });

  it("the run summary line says the cost is unknown when the model had no price (SCRUM-257)", () => {
    const summarised: PlaygroundMessage = {
      ...STOPPED,
      parts: [
        { type: "data-run-summary", data: { steps: 2, weightedTokens: 4_450, costUsd: null, model: "other" } },
      ] as PlaygroundMessage["parts"],
    };
    render([USER_TURN, summarised]);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("2 steps");
    expect(text).toContain("4.5k tokens");
    expect(text).not.toMatch(/\$/);
  });

  it("says the user stopped the run, and offers no Continue (SCRUM-258)", () => {
    const stopped: PlaygroundMessage = {
      id: "run-status-r3",
      role: "assistant",
      parts: [
        { type: "data-run-stopped", data: { limit: "user", steps: 3, cap: null, skill: "morning-brief" } },
      ] as PlaygroundMessage["parts"],
    };
    render([USER_TURN, stopped], vi.fn());
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/you stopped/i);
    expect(text).toContain("3 steps");
    expect(text).toContain("saved");
    expect(text).not.toContain("\u2014");
    expect(Array.from(container.querySelectorAll("button")).some((b) => (b.textContent ?? "").includes("Continue"))).toBe(false);
  });

  it("a settled message shows Interrupted, not Running, for a tool call whose result never came", async () => {
    const message = await assemble(TOOL_RUNNING);
    render([USER_TURN, message]);
    const text = container.textContent ?? "";
    expect(text).toContain("Interrupted");
    expect(text).not.toContain("Running");
  });
});
