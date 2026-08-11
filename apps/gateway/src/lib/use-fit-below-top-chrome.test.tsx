// @vitest-environment jsdom

/**
 * Does the shell size itself to the space LEFT, rather than to the viewport?
 *
 * The production defect this pins: with a third-party bar above the app, the
 * shell kept a full viewport height, started below the bar, and its bottom ran
 * off-screen by exactly the bar's height — clipping the composer anchored
 * there. Measured live before the fix: top 36, height 1000, bottom 1036 in a
 * 1000px viewport.
 *
 * jsdom does no layout, so the element's top is stubbed. That makes this a
 * test of the ARITHMETIC and the WIRING, not of real layout: it can prove the
 * hook subtracts the offset and that it re-measures when the page above it
 * changes, and it cannot prove the page fits in a browser. The behavioural
 * check belongs on the deployed surface with the real widget present.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useRef } from "react";
import { useFitBelowTopChrome } from "./use-fit-below-top-chrome";

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);
// The hook schedules through rAF; run it synchronously so assertions do not
// race the frame.
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  cb(0);
  return 0;
});
vi.stubGlobal("cancelAnimationFrame", () => {});

let container: HTMLDivElement;
let root: Root;

/** Pretend the shell starts `offset` px down the page. */
function stubTop(el: HTMLElement, offset: number) {
  el.getBoundingClientRect = () =>
    ({ top: offset, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: offset, toJSON: () => ({}) }) as DOMRect;
}

function Harness({ offset, enabled }: { offset: number; enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFitBelowTopChrome(ref, enabled);
  // A CALLBACK ref, not `ref={ref}` plus a stub during render. On the first
  // render `ref.current` is still null, so a render-time stub never lands and
  // the effect measures an unstubbed element — which is how the first version
  // of this test failed against a hook that was working correctly.
  return (
    <div
      data-testid="shell"
      ref={(node) => {
        ref.current = node;
        if (node) stubTop(node, offset);
      }}
    />
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
  window.scrollY = 0;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.paddingTop = "";
});

const shell = () => container.querySelector<HTMLElement>('[data-testid="shell"]')!;

describe("fitting the shell below whatever sits above it", () => {
  it("subtracts the offset instead of taking the whole viewport", () => {
    act(() => root.render(<Harness enabled offset={36} />));
    // The bug was 1000px here, which overflowed by exactly the 36 it started down.
    expect(shell().style.height).toBe("964px");
  });

  it("takes the whole viewport when nothing is above it", () => {
    act(() => root.render(<Harness enabled offset={0} />));
    expect(shell().style.height).toBe("1000px");
  });

  it("does nothing at all on a route that is not full-height", () => {
    // A scrolling document must keep its natural height; pinning it to the
    // viewport would cut off the bottom of a long page instead of a composer.
    act(() => root.render(<Harness enabled={false} offset={36} />));
    expect(shell().style.height).toBe("");
  });

  it("re-measures when the chrome above it appears late", async () => {
    // The whole reason this is observer-driven: third-party bars load after
    // first paint, so a single measurement at mount reads a page the offender
    // has not reached yet and reports a clean result about the wrong state.
    act(() => root.render(<Harness enabled offset={0} />));
    expect(shell().style.height).toBe("1000px");

    stubTop(shell(), 36);
    await act(async () => {
      // What the widget actually does: writes padding onto the body.
      document.body.style.paddingTop = "36px";
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(
      shell().style.height,
      "the hook did not react to chrome appearing after mount"
    ).toBe("964px");
  });

  it("releases the height when the route stops being full-height", () => {
    act(() => root.render(<Harness enabled offset={36} />));
    expect(shell().style.height).toBe("964px");
    act(() => root.render(<Harness enabled={false} offset={36} />));
    expect(shell().style.height, "a pinned height was left behind").toBe("");
  });
});
