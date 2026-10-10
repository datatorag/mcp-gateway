// @vitest-environment jsdom

/**
 * Does the chat survive a browser that has translated the page?
 *
 * A browser's page translation rewrites the document under React: each text
 * node is taken out and a `<font>` element holding the translated words is
 * put where it was. React still holds the node it created. The next time a
 * render has to place something in front of that node, or remove it, the DOM
 * call throws, because the node is no longer where React left it. With no
 * boundary in the way, that one throw replaced the whole page.
 *
 * So this plays a whole conversation (thinking, prose, a read, a failed
 * call, a write that waits for approval, the approval, the answer, feedback,
 * a second turn that fails) and re-translates the page before EVERY chunk
 * and every click. Any place in the thread that keeps a bare text node
 * beside an element that comes, goes or is swapped fails here, at the chunk
 * that moves it.
 *
 * What it cannot see: text React only UPDATES in place. That does not throw,
 * it goes stale on screen, and no assertion here is about it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UIMessageChunk } from "ai";

import { Playground, type PlaygroundHandle } from "./playground";
import { translatePage } from "@/test-utils/translate-page";

const READ = "gws-mcp__sheets_read";
const FIND = "gws-mcp__sheets_find_rows";
const WRITE = "gws-mcp__sheets_update";

/** Stops at the gated write: no `finish`, which is what a suspended turn is. */
const FIRST_TURN: UIMessageChunk[] = [
  { type: "start", messageId: "assistant-1" },
  { type: "start-step" },
  { type: "reasoning-start", id: "r1" },
  { type: "reasoning-delta", id: "r1", delta: "thinking about it" },
  { type: "reasoning-end", id: "r1" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "I will **update** the sheet.\n\n- one\n- two" },
  { type: "text-delta", id: "t1", delta: " and more [link](https://sheets.example/a)" },
  { type: "text-end", id: "t1" },
  { type: "tool-input-start", toolCallId: "c1", toolName: READ },
  { type: "tool-input-available", toolCallId: "c1", toolName: READ, input: { range: "A1" } },
  { type: "tool-output-available", toolCallId: "c1", output: { rows: 3 } },
  { type: "finish-step" },
  { type: "start-step" },
  { type: "tool-input-start", toolCallId: "c2", toolName: FIND },
  { type: "tool-input-available", toolCallId: "c2", toolName: FIND, input: { where: "x" } },
  { type: "tool-output-error", toolCallId: "c2", errorText: "No such column." },
  { type: "finish-step" },
  { type: "start-step" },
  { type: "tool-input-start", toolCallId: "c3", toolName: WRITE },
  { type: "tool-input-available", toolCallId: "c3", toolName: WRITE, input: { range: "B2" } },
  { type: "tool-approval-request", toolCallId: "c3", approvalId: "approval-1" },
];

const RESUMED_TURN: UIMessageChunk[] = [
  { type: "start", messageId: "assistant-1" },
  { type: "start-step" },
  { type: "tool-output-available", toolCallId: "c3", output: { ok: true } },
  { type: "finish-step" },
  { type: "start-step" },
  { type: "text-start", id: "t2" },
  { type: "text-delta", id: "t2", delta: "Done. The sheet is updated." },
  { type: "text-end", id: "t2" },
  { type: "finish-step" },
  { type: "finish" },
];

const FAILED_TURN: UIMessageChunk[] = [
  { type: "start", messageId: "assistant-2" },
  { type: "start-step" },
  { type: "text-start", id: "t3" },
  { type: "text-delta", id: "t3", delta: "Starting" },
  { type: "error", errorText: "The run could not continue." },
];

let container: HTMLDivElement;
let root: Root;
let handle: PlaygroundHandle | null;
let chatPosts: number;
/** Feed the open chat response one chunk, or `null` to end it. */
let push: ((chunk: UIMessageChunk | null) => void) | null;
let translated: number;

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Translate whatever is new on the page, as the browser keeps doing. */
function translate(): void {
  translated += translatePage(container);
}

async function play(chunks: UIMessageChunk[]): Promise<void> {
  for (const chunk of chunks) {
    translate();
    await act(async () => {
      push?.(chunk);
    });
    await settle();
  }
  translate();
  await act(async () => {
    try {
      push?.(null);
    } catch {
      // A turn that ended in an error chunk has already closed its stream.
    }
  });
  await settle();
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button"));
}

function buttonLabelled(label: string): HTMLButtonElement {
  const match = buttons().find((el) => (el.textContent ?? "").includes(label));
  if (!match) throw new Error(`no button labelled ${JSON.stringify(label)}`);
  return match;
}

beforeEach(() => {
  chatPosts = 0;
  translated = 0;
  push = null;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: unknown) => {
      if (String(url).includes("/api/playground/quota")) {
        return Promise.resolve(
          new Response(JSON.stringify({ runsUsed: 1, runsCap: 25, runsRemaining: 24 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      }
      chatPosts += 1;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (chunk) => {
            if (chunk === null) {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            } else {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }
          };
        },
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
      );
    })
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.scrollTo ??= () => {};
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  handle = null;
});

afterEach(() => {
  try {
    act(() => root.unmount());
  } catch {
    // A root that already failed has nothing left to unmount.
  }
  container.remove();
  vi.unstubAllGlobals();
});

describe("the chat on a page the browser has translated", () => {
  it("plays a whole conversation without a render throwing", async () => {
    act(() => {
      root.render(
        <Playground
          accounts={[]}
          connectionsLoaded
          hasConnectedAccount
          layout="page"
          prompts={["first", "second", "third"]}
          ref={(instance: PlaygroundHandle | null) => {
            handle = instance;
          }}
        />
      );
    });
    await settle();
    translate();

    act(() => {
      handle?.runPrompt("update the sheet");
    });
    await settle();
    await play(FIRST_TURN);

    // Open what can be opened (the thinking row, the tool cards), on the
    // translated page, leaving the decision itself for last.
    translate();
    for (const button of buttons().filter((b) => !/Approve|Deny/.test(b.textContent ?? ""))) {
      if (!button.isConnected) continue;
      act(() => {
        button.click();
      });
      await settle();
      translate();
    }

    // The click the crash was first seen on.
    act(() => {
      buttonLabelled("Approve").click();
    });
    await settle();
    expect(chatPosts).toBe(2);
    await play(RESUMED_TURN);

    translate();
    act(() => {
      buttonLabelled("Bad response").click();
    });
    await settle();
    translate();

    act(() => {
      handle?.runPrompt("and again");
    });
    await settle();
    expect(chatPosts).toBe(3);
    await play(FAILED_TURN);

    // The page really was translated, throughout, or none of this ran
    // against the thing it is about.
    expect(translated).toBeGreaterThan(25);
    // And the conversation is still there, to its last line.
    const text = container.textContent ?? "";
    expect(text).toContain("Done. The sheet is updated.");
    expect(text).toContain("The run could not continue.");
    expect(container.querySelector("textarea")).not.toBeNull();
  }, 30_000);
});
