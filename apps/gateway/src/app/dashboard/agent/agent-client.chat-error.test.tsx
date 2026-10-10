// @vitest-environment jsdom

/**
 * The Agent page keeps a throw inside the chat, and its reload reopens the
 * conversation that was on screen, including one so new that only the
 * server's first response has named it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn(), captureException: vi.fn() },
}));
vi.mock("../use-signup-conversion", () => ({ useSignupConversion: () => {} }));
vi.mock("./thread-list", () => ({
  ThreadList: () => <nav data-testid="rail">conversations</nav>,
}));

/** What the stand-in chat does on its next render. */
const chat = { broken: false, names: null as string | null, mounts: [] as Array<string | null> };

vi.mock("../playground", () => ({
  Playground: function FakePlayground({
    threadId,
    onThreadKnown,
  }: {
    threadId?: string | null;
    onThreadKnown?: (id: string) => void;
  }) {
    useEffect(() => {
      chat.mounts.push(threadId ?? null);
      if (chat.names) onThreadKnown?.(chat.names);
    }, [threadId, onThreadKnown]);
    if (chat.broken) throw new DOMException("not a child of this node", "NotFoundError");
    return (
      <div data-testid="chat">
        chat:{threadId ?? "new"}
        <button data-testid="poke" onClick={() => {}} type="button" />
      </div>
    );
  },
}));

import { AgentClient } from "./agent-client";
import { CHAT_ERROR_NEW, CHAT_ERROR_RELOAD } from "../chat-error-boundary";

let container: HTMLDivElement;
let root: Root;
let threadReads: string[];

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label);

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function mount(): void {
  act(() => {
    root.render(
      <AgentClient
        initialConnections={{ accounts: [], connections: [] }}
        isDefaultView={false}
        landedFrom="login"
      />
    );
  });
}

/** Re-render the page with the chat set to throw. */
function breakTheChat(): void {
  chat.broken = true;
  mount();
}

beforeEach(() => {
  chat.broken = false;
  chat.names = null;
  chat.mounts = [];
  threadReads = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn((url: unknown) => {
      const target = String(url);
      const match = target.match(/\/api\/playground\/threads\/([^/?]+)$/);
      if (match) threadReads.push(decodeURIComponent(match[1]!));
      return Promise.resolve(
        new Response(JSON.stringify({ messages: [], suggestions: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    })
  );
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Agent page when the chat throws while rendering", () => {
  it("keeps the conversation list and shows the card in the chat's place", async () => {
    mount();
    await settle();
    expect(q("chat")?.textContent).toContain("chat:new");

    breakTheChat();

    expect(q("chat")).toBeNull();
    expect(q("chat-error")).not.toBeNull();
    expect(q("rail")).not.toBeNull();
  });

  it("reload reopens the conversation the server named, on a fresh mount", async () => {
    chat.names = "thread-9";
    mount();
    await settle();
    breakTheChat();

    chat.broken = false;
    act(() => {
      button(CHAT_ERROR_RELOAD)?.click();
    });
    await settle();

    expect(threadReads).toEqual(["thread-9"]);
    expect(q("chat-error")).toBeNull();
    expect(q("chat")?.textContent).toContain("chat:thread-9");
  });

  it("reload with no stored conversation starts a new chat rather than doing nothing", async () => {
    mount();
    await settle();
    breakTheChat();

    chat.broken = false;
    act(() => {
      button(CHAT_ERROR_RELOAD)?.click();
    });
    await settle();

    expect(threadReads).toEqual([]);
    expect(q("chat-error")).toBeNull();
    expect(q("chat")?.textContent).toContain("chat:new");
  });

  it("a new chat after the card forgets the old conversation", async () => {
    chat.names = "thread-9";
    mount();
    await settle();
    breakTheChat();

    chat.broken = false;
    chat.names = null;
    act(() => {
      button(CHAT_ERROR_NEW)?.click();
    });
    await settle();
    expect(q("chat")?.textContent).toContain("chat:new");

    // If the new chat breaks too, before any response has named it, its
    // reload must not reopen the conversation the user just left.
    breakTheChat();
    chat.broken = false;
    act(() => {
      button(CHAT_ERROR_RELOAD)?.click();
    });
    await settle();
    expect(threadReads).toEqual([]);
    expect(q("chat")?.textContent).toContain("chat:new");
  });
});
