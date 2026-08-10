// @vitest-environment jsdom

/**
 * Can a user actually SEND from the Agent?
 *
 * This exists because the Agent shipped to production with a composer that
 * produced no network request at all. Every check in the pipeline was green:
 * tsc, 477 unit tests, the production build, the health endpoint and the
 * security gate. None of them mount the page and try to type in it, so none of
 * them could see it.
 *
 * The assertion that matters is the crudest one: after a render, is there
 * something to type into, and does using it cause a request.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

// jsdom has no ResizeObserver and the composer's autosize textarea uses one.
// An environment gap, not a product fact — stubbed so it cannot mask the
// assertions below.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);
// Same class of gap: the scroll-area viewport calls getAnimations() on a timer
// that can fire after the test has finished. jsdom does not implement it.
if (typeof Element !== "undefined" && !("getAnimations" in Element.prototype)) {
  (Element.prototype as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [];
}

const { AgentClient } = await import("./agent/agent-client");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
});

/** Renders and lets the mount effects settle. */
async function mount(connectionsResponse: () => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/api/connections")) return connectionsResponse();
      if (String(url).includes("/api/agent/suggestions")) {
        return new Response(JSON.stringify({ suggestions: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    })
  );
  await act(async () => {
    root.render(<AgentClient isDefaultView={false} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const ok = (body: unknown) =>
  async () => new Response(JSON.stringify(body), { status: 200 });

describe("the Agent composer", () => {
  it("renders something to type into for a user with no connected account", async () => {
    // The case the production failure was in: a brand new user, nothing
    // connected, landing here as their post-login destination.
    await mount(ok({ accounts: [], connections: [] }));

    const textarea = container.querySelector("textarea");
    expect(textarea, "no composer rendered for an unconnected user").not.toBeNull();
    expect(textarea?.hasAttribute("disabled")).toBe(false);
  });

  it("renders the composer for a connected user too", async () => {
    await mount(ok({ accounts: [{ id: "a1", connectorType: "google-workspace" }], connections: [] }));
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("still renders a composer when the connections call fails", async () => {
    // A failed or slow account lookup must not leave the page with no way to
    // type. Gating the whole surface on that response is how a transient
    // failure becomes a dead screen.
    await mount(async () => {
      throw new Error("network down");
    });
    expect(
      container.querySelector("textarea"),
      "connections failure left the user with no composer"
    ).not.toBeNull();
  });

  it("still renders a composer when connections returns non-2xx", async () => {
    await mount(async () => new Response("nope", { status: 500 }));
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("SENDS: typing and submitting produces a request to the chat route", async () => {
    // The property the last round proved was missing: a composer that renders
    // is not a composer that works. On production the box appeared, the user
    // typed, and no request ever left the page.
    await mount(ok({ accounts: [{ id: "a1", connectorType: "google-workspace" }], connections: [] }));

    const textarea = container.querySelector("textarea");
    expect(textarea, "no composer to type into").not.toBeNull();

    // Type the way React hears it: set the value through the native setter so
    // the synthetic onChange fires.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )!.set!;
    await act(async () => {
      setter.call(textarea, "what is in my drive");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = textarea!.closest("form");
    expect(form, "composer is not inside a form, so submit cannot fire").not.toBeNull();
    await act(async () => {
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const chat = calls.filter((c) => String(c[0]).includes("/api/playground/chat"));
    expect(chat.length, `no POST to the chat route; fetch saw: ${calls.map((c) => String(c[0])).join(", ")}`).toBeGreaterThan(0);
  });
});
