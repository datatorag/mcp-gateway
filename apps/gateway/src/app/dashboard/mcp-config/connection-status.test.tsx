// @vitest-environment jsdom
/**
 * The restored connection-status poller (SCRUM-122). The wizard that used to
 * carry it was deleted with the dashboard IA change, which silently retired
 * the product's only live "your client actually connected" feedback; these
 * tests pin the behaviours that came back with it, read out of the old file
 * rather than re-decided:
 *
 *   1. polling starts on load and repeats while setup is incomplete,
 *   2. a hidden tab skips poll ticks instead of hammering the API,
 *   3. polling stops for good once the first tool call has landed, and
 *   4. the milestone capture fires only on a LIVE false->true transition,
 *      never on a first load that was already complete.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const captured = vi.hoisted(() => vi.fn());
vi.mock("posthog-js", () => ({
  default: { capture: captured },
}));

import { ConnectionStatus } from "./connection-status";

type Status = {
  accountConnected: boolean;
  agentConnected: boolean;
  agentClientName: string | null;
  agentConnectedAt: string | null;
  firstToolCallAt: string | null;
};

const DISCONNECTED: Status = {
  accountConnected: false,
  agentConnected: false,
  agentClientName: null,
  agentConnectedAt: null,
  firstToolCallAt: null,
};

let container: HTMLDivElement;
let root: Root;
let statusNow: Status;
let fetchMock: ReturnType<typeof vi.fn>;

/** A FRESH Response per call: bodies are single-use, and the poller reads
 * one per tick. */
function respondWith(): Response {
  return new Response(JSON.stringify(statusNow), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  captured.mockClear();
  statusNow = { ...DISCONNECTED };
  fetchMock = vi.fn(async () => respondWith());
  vi.stubGlobal("fetch", fetchMock);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount(): Promise<void> {
  act(() => {
    root.render(<ConnectionStatus />);
  });
  // Let the mount fetch resolve.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("ConnectionStatus", () => {
  it("fetches on load and shows the waiting state", async () => {
    await mount();
    expect(fetchMock).toHaveBeenCalledWith("/api/setup/status");
    expect(container.textContent).toContain(
      "Waiting for your client to connect"
    );
  });

  it("keeps polling while incomplete and flips to connected live", async () => {
    await mount();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    statusNow = {
      ...DISCONNECTED,
      accountConnected: true,
      agentConnected: true,
      agentClientName: "Claude Code",
      agentConnectedAt: "2026-08-17T00:00:00Z",
    };
    await tick(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(
      "Client connected ✓. Now ask it something."
    );
    expect(container.textContent).toContain("Connected via Claude Code");
  });

  it("skips poll ticks while the tab is hidden", async () => {
    await mount();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    await tick(15000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue("visible");
    await tick(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
  });

  it("stops polling for good once the first tool call lands", async () => {
    await mount();
    statusNow = {
      ...DISCONNECTED,
      accountConnected: true,
      agentConnected: true,
      agentClientName: "Claude Code",
      firstToolCallAt: "2026-08-17T01:00:00Z",
    };
    await tick(5000);
    expect(container.textContent).toContain("First tool call received");
    const calls = fetchMock.mock.calls.length;

    await tick(30000);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it("captures the milestone only on a live transition, not a completed first load", async () => {
    // Already complete before the page was ever opened: no capture, ever.
    statusNow = {
      ...DISCONNECTED,
      accountConnected: true,
      agentConnected: true,
      firstToolCallAt: "2026-08-16T00:00:00Z",
    };
    await mount();
    await tick(15000);
    expect(captured).not.toHaveBeenCalled();
  });

  it("captures wizard_step_completed exactly once when the flip happens on screen", async () => {
    await mount();
    expect(captured).not.toHaveBeenCalled();

    statusNow = {
      ...DISCONNECTED,
      accountConnected: true,
      agentConnected: true,
      firstToolCallAt: "2026-08-17T02:00:00Z",
    };
    await tick(5000);
    expect(captured).toHaveBeenCalledTimes(1);
    expect(captured).toHaveBeenCalledWith("wizard_step_completed", {
      step: "first_tool_call",
    });
  });
});
