// @vitest-environment jsdom

/**
 * What does the empty state claim while the truth is still in flight?
 *
 * SCRUM-114: the connection lookup starts every user at "nothing connected"
 * and resolves asynchronously, and the empty state used to branch on that
 * default as if it were a fact - so every CONNECTED user was shown the
 * connect card for one fetch round trip per load, on a control that is
 * click-instrumented for the non-converter funnel. These tests hold the
 * lookup OPEN with a deferred promise, which is the state every user is in
 * for the first moments of every load, and assert the page makes no
 * connection claim at all until it knows one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

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
});

/** A promise whose resolution the test owns. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mountWith(
  connections: () => Promise<Response>,
  suggestions: string[] = [],
  seedPrompt: string | null = null
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/api/connections")) return connections();
      if (String(url).includes("/api/agent/suggestions")) {
        return new Response(JSON.stringify({ suggestions: suggestions.map((text) => ({ text })) }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 200 });
    })
  );
  act(() => {
    root.render(
      <AgentClient
        isDefaultView={false}
        landedFrom="login"
        seedPrompt={seedPrompt}
      />
    );
  });
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const text = () => (container.textContent ?? "").replace(/\s+/g, " ");

describe("the empty state and the unknown connection state (SCRUM-114)", () => {
  it("claims NOTHING about connections until the lookup resolves", async () => {
    // A FRESH Response per caller: more than one useConnections instance
    // lives on this page (the meter has its own), a Response body is
    // single-use, and a shared one makes the second reader throw into the
    // hook's catch and report "none connected" - in the TEST, not the
    // product.
    const gate = deferred<unknown>();
    mountWith(() =>
      gate.promise.then(
        (body) => new Response(JSON.stringify(body), { status: 200 })
      )
    );
    await flush();

    // The state under test: the fetch is still in flight. This is every
    // user's first paint on every load. Neither branch may render - the
    // connect pitch would be wrong for a connected user, the connected
    // greeting wrong for a new one.
    expect(text()).not.toContain("Connect Google Workspace");
    expect(text()).not.toContain("anything in the meantime");
    // Branch-specific strings only: the page GREETING legitimately says
    // "connected accounts" and stays through every state - it makes no claim
    // about THIS user's connections, which is exactly why it may render
    // before the lookup returns and these two may not.
    expect(text()).not.toContain("Ask something about your connected accounts");
    expect(text()).not.toContain("things I can do");
    // The PROMPTS are outside the gate (SCRUM-117): what is possible depends
    // on nothing about this user's connections, so it renders before the
    // lookup returns. Only the claims wait.
    expect(
      Array.from(container.querySelectorAll("button")).filter(
        (b) => (b.textContent ?? "").length > 30
      ).length
    ).toBe(3);
    // The composer is deliberately NOT withheld - that decision predates
    // this fix and stands. Asserted so this gate can never quietly widen
    // into the withhold-the-page bug it must not become.
    expect(container.querySelector("textarea")).not.toBeNull();

    // Resolution: the user IS connected. The connected branch appears and
    // the connect card never did.
    await act(async () => {
      gate.resolve({
        accounts: [{ id: "a1", connectorType: "google-workspace" }],
        connections: [],
      });
      await Promise.resolve();
    });
    await flush();
    expect(text()).toContain("Ask something about your connected accounts");
    expect(text()).not.toContain("Connect Google Workspace");
  });

  it("shows the connect pitch only AFTER an unconnected resolution", async () => {
    const gate = deferred<unknown>();
    mountWith(() =>
      gate.promise.then(
        (body) => new Response(JSON.stringify(body), { status: 200 })
      )
    );
    await flush();
    expect(text()).not.toContain("Connect Google Workspace");

    await act(async () => {
      gate.resolve({ accounts: [], connections: [] });
      await Promise.resolve();
    });
    await flush();
    expect(text()).toContain("Connect Google Workspace");
    expect(text()).toContain("anything in the meantime");
    // SCRUM-117: the unconnected state shows what is POSSIBLE alongside the
    // ask - prompts and card together, prompts first in the document.
    const buttons = Array.from(container.querySelectorAll("button")).filter(
      (b) => (b.textContent ?? "").length > 30
    );
    expect(buttons.length).toBe(3);
    const firstPrompt = buttons[0]!;
    const card = Array.from(container.querySelectorAll("a")).find((a) =>
      (a.textContent ?? "").includes("Connect Google Workspace")
    );
    expect(card).toBeTruthy();
    expect(
      // eslint-disable-next-line no-bitwise
      firstPrompt.compareDocumentPosition(card!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("a server-resolved seed prompt SUBMITS on arrival, exactly once (SCRUM-118)", async () => {
    // The Connections page's Run action, end to end from this component's
    // side: a seedPrompt prop (only ever a string the server resolved from
    // AGENT_PROMPTS, or null) is auto-submitted into the chat.
    //
    // The URL carries the param the server just consumed, so the STRIP can
    // be pinned below. The strip is the only thing standing between a
    // shared or reloaded URL and a repeated submission - the one-shot ref
    // covers a mount, not a reload - and an untested line guarding a
    // security-adjacent property is the line a refactor deletes unnoticed.
    window.history.replaceState(null, "", "/dashboard/agent?prompt=0&welcome=1");
    mountWith(
      async () =>
        new Response(
          JSON.stringify({
            accounts: [{ id: "a1", connectorType: "google-workspace" }],
            connections: [],
          }),
          { status: 200 }
        ),
      [],
      "Summarize my unread emails and draft a status update in Google Docs"
    );
    await flush();
    await flush();

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    const chat = calls.filter((c) => String(c[0]).includes("/api/playground/chat"));
    expect(chat.length, "seeded prompt did not submit").toBe(1);
    const body = String((chat[0]![1] as { body?: unknown })?.body ?? "");
    expect(body).toContain("Summarize my unread emails");
    // The pin, both directions: the prompt param is gone, and the strip
    // removed ONLY its own param rather than flattening the query string.
    expect(window.location.search).not.toContain("prompt=");
    expect(window.location.search).toContain("welcome=1");
  });

  it("no seed prompt means no submission on arrival", async () => {
    mountWith(
      async () =>
        new Response(
          JSON.stringify({
            accounts: [{ id: "a1", connectorType: "google-workspace" }],
            connections: [],
          }),
          { status: 200 }
        )
    );
    await flush();
    await flush();
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(
      calls.filter((c) => String(c[0]).includes("/api/playground/chat"))
    ).toHaveLength(0);
  });

  it("tops a thin personalised read up to three suggestions", async () => {
    // The render promises three; the personalised endpoint guarantees no
    // count. One real suggestion must not collapse the row to one.
    mountWith(
      async () =>
        new Response(
          JSON.stringify({
            accounts: [{ id: "a1", connectorType: "google-workspace" }],
            connections: [],
          }),
          { status: 200 }
        ),
      ["Summarize the doc you edited most recently"]
    );
    await flush();
    await flush();

    const suggestionButtons = Array.from(
      container.querySelectorAll("button")
    ).filter((b) => (b.textContent ?? "").length > 30);
    expect(suggestionButtons.length).toBe(3);
    // The personalised prompt leads; generic prompts fill the remainder.
    expect(suggestionButtons[0]?.textContent).toContain(
      "Summarize the doc you edited most recently"
    );
    // The copy derives from what is rendered: three on screen means plural,
    // and no claim that the connection just happened - this surface cannot
    // distinguish a first visit from a returning one, so the copy must be
    // true for both.
    expect(text()).toContain("Here are a few things I can do");
    expect(text()).not.toContain("just connected");
  });
});
