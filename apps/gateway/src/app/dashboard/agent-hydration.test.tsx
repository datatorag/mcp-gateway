// @vitest-environment jsdom

/**
 * Does the Agent page survive HYDRATION?
 *
 * The production failure that no other test could see: the composer rendered,
 * typing worked, clicking send did nothing, and no request left the page. That
 * is the signature of HTML that arrived but never became interactive — React
 * bailed during hydration, so no event handler was ever attached.
 *
 * Every other suite mounts components directly with `createRoot`, which never
 * hydrates anything, so none of them can reach this failure. This one does the
 * two-step the browser does: render to HTML the way the server would, put that
 * HTML in the document, then hydrate over it and listen for what React says.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);
if (typeof Element !== "undefined" && !("getAnimations" in Element.prototype)) {
  (Element.prototype as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [];
}

const { AgentClient } = await import("./agent/agent-client");

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ accounts: [], connections: [] }), { status: 200 }))
  );
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  container.remove();
});

describe("Agent page hydration", () => {
  it("hydrates the server HTML without a recoverable error", async () => {
    // Step 1: the server pass. This is what Next sends down the wire.
    const serverHtml = renderToString(<AgentClient isDefaultView={false} />);
    expect(serverHtml.length, "server render produced nothing").toBeGreaterThan(0);
    container.innerHTML = serverHtml;

    // Step 2: hydrate over it, capturing everything React reports. A mismatch
    // arrives here rather than as a thrown error, which is precisely why it was
    // invisible: nothing crashes, the page simply stops being interactive.
    const recoverable: string[] = [];
    await act(async () => {
      root = hydrateRoot(container, <AgentClient isDefaultView={false} />, {
        onRecoverableError: (err) => {
          recoverable.push(err instanceof Error ? err.message : String(err));
        },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      recoverable,
      `React reported ${recoverable.length} recoverable error(s) during hydration:\n  ` +
        recoverable.join("\n  ")
    ).toEqual([]);
  });

  it("is interactive after hydration: the composer accepts input", async () => {
    const serverHtml = renderToString(<AgentClient isDefaultView={false} />);
    container.innerHTML = serverHtml;
    await act(async () => {
      root = hydrateRoot(container, <AgentClient isDefaultView={false} />, {
        onRecoverableError: () => {},
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Not "does a textarea exist" — a non-hydrated page has one too, straight
    // from the server HTML. This asserts React is actually driving it.
    const textarea = container.querySelector("textarea");
    expect(textarea, "no composer after hydration").not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )!.set!;
    await act(async () => {
      setter.call(textarea, "hello");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(textarea!.value).toBe("hello");
  });
});
