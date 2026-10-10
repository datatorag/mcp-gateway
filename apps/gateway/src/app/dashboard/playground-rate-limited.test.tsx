// @vitest-environment jsdom

/**
 * Two different refusals answer 429 on the chat route: the run allowance,
 * and the per-user request limiter in front of every dashboard route. The
 * chat read both as the allowance, so a limiter refusal told the user they
 * had used all 0 of their runs and took the composer away.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Playground, RATE_LIMITED, type PlaygroundHandle } from "./playground";
import { agentCapTitle } from "./agent-cap-copy";

let container: HTMLDivElement;
let root: Root;
let handle: PlaygroundHandle | null;
let refusal: { body: Record<string, unknown>; headers?: Record<string, string> };

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: unknown) => {
      if (String(url).includes("/api/playground/quota")) {
        return Promise.resolve(
          new Response(JSON.stringify({ runsUsed: 3, runsCap: 25, runsRemaining: 22 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(refusal.body), {
          status: 429,
          headers: { "content-type": "application/json", ...refusal.headers },
        })
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
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function sendOne(): Promise<string> {
  act(() => {
    root.render(
      <Playground
        accounts={[]}
        connectionsLoaded
        hasConnectedAccount
        prompts={["do a thing"]}
        ref={(instance: PlaygroundHandle | null) => {
          handle = instance;
        }}
      />
    );
  });
  act(() => {
    handle?.runPrompt("hello");
  });
  await settle();
  return container.textContent ?? "";
}

describe("a 429 on the chat route", () => {
  it("from the request limiter asks for a wait and keeps the composer", async () => {
    refusal = { body: { error: "Too many requests" }, headers: { "Retry-After": "12" } };
    const text = await sendOne();

    expect(text).toContain(RATE_LIMITED);
    expect(text).not.toContain(agentCapTitle(0));
    expect(text).not.toMatch(/used all/);
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("from the run allowance still raises the cap panel, with its cap", async () => {
    refusal = { body: { error: "cap_exceeded", cap: 25 } };
    const text = await sendOne();

    expect(text).toContain(agentCapTitle(25));
    expect(text).not.toContain(RATE_LIMITED);
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("with a body that cannot be read is a wait, not an allowance of zero", async () => {
    refusal = { body: {} };
    const text = await sendOne();
    expect(text).toContain(RATE_LIMITED);
    expect(text).not.toMatch(/used all/);
  });
});
