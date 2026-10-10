// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("posthog-js", () => ({
  default: { captureException: vi.fn() },
}));
import posthog from "posthog-js";

import {
  CHAT_ERROR_BODY,
  CHAT_ERROR_NEW,
  CHAT_ERROR_RELOAD,
  CHAT_ERROR_TITLE,
  ChatErrorBoundary,
} from "./chat-error-boundary";

let container: HTMLDivElement;
let root: Root;
/** Flipped by a test to make the thread throw on its next render. */
let broken: boolean;

function Thread() {
  if (broken) {
    // The same class of error a rewritten document produces.
    throw new DOMException("not a child of this node", "NotFoundError");
  }
  return <p data-testid="thread">the conversation</p>;
}

/** The shape the Agent page gives it: something beside the chat, and the
 * chat keyed on an epoch the reload bumps. */
function Page({ withReload = true }: { withReload?: boolean }) {
  const [epoch, setEpoch] = useState(0);
  const [, rerender] = useState(0);
  return (
    <div>
      <nav data-testid="rail">conversations</nav>
      <button data-testid="poke" onClick={() => rerender((n) => n + 1)} type="button">
        poke
      </button>
      <ChatErrorBoundary
        key={epoch}
        onNewChat={() => {
          broken = false;
          setEpoch((n) => n + 1);
        }}
        onReload={
          withReload
            ? () => {
                broken = false;
                setEpoch((n) => n + 1);
              }
            : null
        }
      >
        <Thread />
      </ChatErrorBoundary>
    </div>
  );
}

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label);

beforeEach(() => {
  broken = false;
  vi.mocked(posthog.captureException).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function breakTheThread(): void {
  broken = true;
  act(() => {
    (q("poke") as HTMLButtonElement).click();
  });
}

describe("a throw while drawing the conversation", () => {
  it("stays inside the chat: the rest of the page is still there", () => {
    act(() => root.render(<Page />));
    expect(q("thread")).not.toBeNull();

    breakTheThread();

    expect(q("thread")).toBeNull();
    expect(q("chat-error")).not.toBeNull();
    expect(q("rail")?.textContent).toBe("conversations");
    expect(q("chat-error")?.textContent).toContain(CHAT_ERROR_TITLE);
    expect(q("chat-error")?.textContent).toContain(CHAT_ERROR_BODY);
  });

  it("reloading draws the conversation again", () => {
    act(() => root.render(<Page />));
    breakTheThread();

    act(() => {
      button(CHAT_ERROR_RELOAD)?.click();
    });

    expect(q("chat-error")).toBeNull();
    expect(q("thread")?.textContent).toBe("the conversation");
  });

  it("offers only a new chat when there is no stored conversation to reopen", () => {
    act(() => root.render(<Page withReload={false} />));
    breakTheThread();

    expect(button(CHAT_ERROR_RELOAD)).toBeUndefined();
    act(() => {
      button(CHAT_ERROR_NEW)?.click();
    });
    expect(q("thread")).not.toBeNull();
  });

  it("reports the error, once, and says where it was caught", () => {
    act(() => root.render(<Page />));
    breakTheThread();

    expect(posthog.captureException).toHaveBeenCalledTimes(1);
    const [error, properties] = vi.mocked(posthog.captureException).mock.calls[0]!;
    expect((error as Error).name).toBe("NotFoundError");
    expect(properties).toEqual({ boundary: "agent_chat" });
  });

  it("still shows the card when the report itself throws", () => {
    vi.mocked(posthog.captureException).mockImplementation(() => {
      throw new Error("blocked");
    });
    act(() => root.render(<Page />));
    breakTheThread();
    expect(q("chat-error")).not.toBeNull();
  });

  it("does not say the run failed, and uses no em-dash", () => {
    const copy = [CHAT_ERROR_TITLE, CHAT_ERROR_BODY, CHAT_ERROR_RELOAD, CHAT_ERROR_NEW].join(" ");
    expect(copy).not.toContain(String.fromCharCode(0x2014));
    expect(copy).not.toMatch(/run (failed|was stopped|was lost)/i);
    expect(CHAT_ERROR_BODY).toMatch(/carries on/);
  });
});
