// @vitest-environment jsdom

/**
 * SCRUM-409: what a tool step shows while closed, how far an opened one may
 * grow, how a long wait reads, and what "Interrupted" means.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  hasUnexplainedInterruption,
  INTERRUPTED_BODY,
  INTERRUPTED_RETRY,
  INTERRUPTED_TITLE,
  MessageList,
  PROGRESS_ELAPSED_AFTER_SECONDS,
  ProgressRow,
  ToolCard,
  toolCallSummary,
  type AnyToolPart,
  type PlaygroundMessage,
} from "./playground-presentation";
import { OPENED_BLOCK, ToolInput, ToolOutput } from "@/components/ai-elements/tool";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);

const tool = (state: string, extra: Record<string, unknown> = {}): AnyToolPart =>
  ({
    type: "tool-gws-mcp__sheets_update",
    toolCallId: "c1",
    state,
    input: { spreadsheet_id: "abc", range: "A1:D20", values: [[1], [2], [3]] },
    ...extra,
  }) as unknown as AnyToolPart;

const assistant = (parts: unknown[], id = "a1"): PlaygroundMessage =>
  ({ id, role: "assistant", parts }) as unknown as PlaygroundMessage;
const user = (text: string, id = "u1"): PlaygroundMessage =>
  ({ id, role: "user", parts: [{ type: "text", text }] }) as unknown as PlaygroundMessage;

describe("toolCallSummary", () => {
  it("names each top-level argument with a short value", () => {
    expect(
      toolCallSummary({ range: "A1:D20", count: 3, dry: false, values: [[1], [2]], filter: { a: 1 }, to: null })
    ).toBe("range: A1:D20, count: 3, dry: false, values: [2 items], filter: {…}, to: none");
    expect(toolCallSummary({ ids: ["x"] })).toBe("ids: [1 item]");
  });

  it("cuts a long value and a long line, and flattens whitespace", () => {
    const summary = toolCallSummary({ body: `line one\n\n  line two ${"x".repeat(80)}` })!;
    expect(summary.startsWith("body: line one line two x")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual("body: ".length + 40);
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`argument_${i}`, i]));
    const line = toolCallSummary(many)!;
    expect(line.length).toBe(120);
    expect(line.endsWith("…")).toBe(true);
  });

  it("says nothing when there is nothing to say", () => {
    for (const input of [{}, null, undefined, "text", 3, [1, 2]]) {
      expect(toolCallSummary(input), JSON.stringify(input)).toBeUndefined();
    }
  });
});

describe("a closed tool card", () => {
  it("in the chat, says what it was called with, on the same row", () => {
    act(() => root.render(<ToolCard part={tool("output-available", { output: { ok: true } })} summarize />));
    const summary = q("tool-summary");
    expect(summary?.textContent).toBe("spreadsheet_id: abc, range: A1:D20, values: [3 items]");
    // One row: it truncates and never wraps.
    expect(summary?.className).toContain("truncate");
    // Inside the trigger, so the whole row still opens the card.
    expect(summary?.closest("button")).not.toBeNull();
    // Argument values must not ride along with the click that opens the
    // card: this span is inside the button whose text click analytics reads.
    expect(summary?.classList.contains("ph-no-capture")).toBe(true);
    // Closed means the arguments and result are not on the page at all.
    expect(container.textContent).not.toContain("Parameters");
  });

  it("everywhere else, is exactly what it was", () => {
    act(() => root.render(<ToolCard part={tool("output-available", { output: { ok: true } })} />));
    expect(q("tool-summary")).toBeNull();
  });

  it("shows no summary for a call with no arguments", () => {
    act(() => root.render(<ToolCard part={tool("output-available", { input: {} })} summarize />));
    expect(q("tool-summary")).toBeNull();
  });
});

describe("an opened tool card", () => {
  it("scrolls its parameters and its result inside the card", () => {
    expect(OPENED_BLOCK).toMatch(/max-h-\d+/);
    expect(OPENED_BLOCK).toContain("overflow-y-auto");
    const big = { rows: Array.from({ length: 2000 }, (_, i) => ({ i, text: "x".repeat(40) })) };
    act(() =>
      root.render(
        <div>
          <ToolInput input={big} />
          <ToolOutput errorText={undefined} output={big} />
        </div>
      )
    );
    const capped = Array.from(container.querySelectorAll("div")).filter((el) =>
      OPENED_BLOCK.split(" ").every((cls) => el.classList.contains(cls))
    );
    // One for the parameters, one for the result.
    expect(capped).toHaveLength(2);
  });
});

describe("the progress line on a long step", () => {
  const advance = (seconds: number) =>
    act(() => {
      vi.advanceTimersByTime(seconds * 1000);
    });

  it("starts counting once the step has run a few seconds, and keeps counting", () => {
    vi.useFakeTimers();
    act(() => root.render(<ProgressRow progress={{ label: "Running sheets_update", step: 2 }} />));
    expect(q("run-progress")?.textContent).toContain("Running sheets_update");
    expect(q("run-progress-elapsed")).toBeNull();

    advance(PROGRESS_ELAPSED_AFTER_SECONDS - 1);
    expect(q("run-progress-elapsed")).toBeNull();

    advance(1);
    expect(q("run-progress-elapsed")?.textContent).toBe(`${PROGRESS_ELAPSED_AFTER_SECONDS}s`);

    advance(35);
    expect(q("run-progress-elapsed")?.textContent).toBe("40s");
    // The label itself is untouched: what is happening is the stream's word.
    expect(q("run-progress")?.textContent).toContain("Running sheets_update");
  });

  it("starts over when the activity changes", () => {
    vi.useFakeTimers();
    act(() => root.render(<ProgressRow progress={{ label: "Thinking", step: 1 }} />));
    advance(17);
    expect(q("run-progress-elapsed")?.textContent).toBe("17s");

    act(() => root.render(<ProgressRow progress={{ label: "Running gmail_search", step: 1 }} />));
    expect(q("run-progress-elapsed")).toBeNull();
    advance(6);
    expect(q("run-progress-elapsed")?.textContent).toBe("6s");

    // A new step of the same activity is a new wait too.
    act(() => root.render(<ProgressRow progress={{ label: "Running gmail_search", step: 2 }} />));
    expect(q("run-progress-elapsed")).toBeNull();
  });

  it("keeps the count out of the live region's announcements", () => {
    vi.useFakeTimers();
    act(() => root.render(<ProgressRow progress={{ label: "Thinking", step: 0 }} />));
    advance(9);
    expect(q("run-progress")?.getAttribute("aria-live")).toBe("polite");
    expect(q("run-progress-elapsed")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("stops its timer when the line goes away", () => {
    vi.useFakeTimers();
    act(() => root.render(<ProgressRow progress={{ label: "Thinking", step: 0 }} />));
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.render(<div />));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("an interrupted step", () => {
  const onRegenerate = vi.fn();
  const list = (
    messages: PlaygroundMessage[],
    over: Partial<{ busy: boolean; lastMessageComplete: boolean; awaitingConfirm: boolean }> = {}
  ) => (
    <MessageList
      awaitingConfirm={over.awaitingConfirm ?? false}
      busy={over.busy ?? false}
      comments={{}}
      erroredIds={new Set()}
      feedback={{}}
      lastMessageComplete={over.lastMessageComplete ?? true}
      messages={messages}
      onCommentChange={() => {}}
      onDecide={() => {}}
      onRate={() => {}}
      onRegenerate={onRegenerate}
      onSendComment={() => {}}
    />
  );
  const stranded = assistant([{ type: "step-start" }, tool("input-available")]);

  beforeEach(() => onRegenerate.mockClear());

  it("is explained under the message, with a way to try again", () => {
    act(() => root.render(list([user("update it"), stranded])));
    const notice = q("run-interrupted");
    expect(notice?.textContent).toContain(INTERRUPTED_TITLE);
    expect(notice?.textContent).toContain(INTERRUPTED_BODY);
    // The badge still says so on the step itself.
    expect(container.textContent).toContain("Interrupted");

    const retry = Array.from(notice!.querySelectorAll("button")).find(
      (b) => b.textContent === INTERRUPTED_RETRY
    )!;
    act(() => retry.click());
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("does not claim the step did not happen, and warns about a write", () => {
    const copy = `${INTERRUPTED_TITLE} ${INTERRUPTED_BODY}`;
    expect(copy).toMatch(/check whether it already happened/);
    expect(copy).not.toMatch(/did not run|nothing (was|has been) (changed|written)|failed/i);
    expect(copy).not.toContain(String.fromCharCode(0x2014));
  });

  it("is not shown while the turn is still running", () => {
    act(() => root.render(list([user("update it"), stranded], { busy: true, lastMessageComplete: false })));
    expect(q("run-interrupted")).toBeNull();
    expect(container.textContent).toContain("Running");
  });

  it("is not shown for a step that is only waiting on a decision", () => {
    const waiting = assistant([tool("approval-requested", { approval: { id: "ap1" } })]);
    act(() => root.render(list([user("update it"), waiting], { awaitingConfirm: true })));
    expect(q("run-interrupted")).toBeNull();
  });

  it("is not shown when the thread already says why the run stopped", () => {
    const capped = assistant([
      tool("input-available"),
      { type: "data-run-stopped", data: { limit: "steps", steps: 4, cap: 4, skill: null } },
    ]);
    expect(hasUnexplainedInterruption(capped)).toBe(false);
    act(() => root.render(list([user("update it"), capped])));
    expect(q("run-interrupted")).toBeNull();
    expect(q("run-stopped")).not.toBeNull();
  });

  it("is only about the last message: an old interruption keeps its badge and gets no button", () => {
    const finished = assistant([{ type: "text", text: "Done." }], "a2");
    act(() => root.render(list([user("update it"), stranded, user("again", "u2"), finished])));
    expect(q("run-interrupted")).toBeNull();
    expect(container.textContent).toContain("Interrupted");
  });

  it("is not shown for a message whose steps all finished", () => {
    const done = assistant([tool("output-available", { output: { ok: true } }), { type: "text", text: "Done." }]);
    expect(hasUnexplainedInterruption(done)).toBe(false);
    expect(hasUnexplainedInterruption(user("hi"))).toBe(false);
    expect(hasUnexplainedInterruption(undefined)).toBe(false);
  });
});
