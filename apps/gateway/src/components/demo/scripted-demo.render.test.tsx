// @vitest-environment jsdom

/**
 * A demo window does not take the mouse wheel away from the page (SCRUM-399).
 *
 * The transcript box was a scroll container that contained its overscroll.
 * A browser gives such a box the wheel even when it has nothing to scroll,
 * and here it almost never does, because the frame is sized to the content:
 * with the pointer over any window, the page stopped scrolling.
 *
 * jsdom has no scrolling, so this cannot turn a wheel. What it can hold is
 * the cause: the box a replay renders into must not be a container the reader
 * can scroll, and must not contain overscroll. The behaviour itself is
 * checked in a real browser, over every window, with the page's own scroll
 * position as the measure.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
}));

const { default: ScriptedTranscript } = await import("./scripted-demo");
const { DEMO_SCRIPTS } = await import("./demo-scripts");

let container: HTMLDivElement;
let root: Root;

/** A fresh root per script, so each one really mounts. */
function mount(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
  return container;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the transcript box leaves the wheel to the page", () => {
  it.each(
    DEMO_SCRIPTS.flatMap((s) => [
      // Resting on the end state (the grid's stagger), and playing from the start.
      [s.id, "resting", 60_000] as const,
      [s.id, "playing", 0] as const,
    ])
  )("%s, %s", (id, _state, startDelayMs) => {
    const el = mount(<ScriptedTranscript id={id} startDelayMs={startDelayMs} />);
    // Something rendered: an empty box would pass every check below.
    expect(el.textContent?.length ?? 0).toBeGreaterThan(0);
    const boxes = [...el.querySelectorAll<HTMLElement>("*")].filter((node) =>
      /(^|\s)(overflow|overscroll)-/.test(node.className?.toString() ?? "")
    );
    const transcript = boxes.find((node) => node.className.includes("h-full"));
    expect(transcript, "the transcript box").toBeDefined();
    const classes = transcript!.className.split(/\s+/);
    expect(classes).toContain("overflow-y-hidden");
    for (const node of boxes) {
      for (const cls of node.className.toString().split(/\s+/)) {
        // Nothing in a window may contain overscroll, and nothing may be a
        // box the reader scrolls vertically.
        expect(cls, `${id}: ${cls}`).not.toMatch(/^overscroll-(contain|none|y-contain|y-none)$/);
        expect(cls, `${id}: ${cls}`).not.toMatch(/^overflow-(y-)?(auto|scroll)$/);
      }
    }
  });
});
