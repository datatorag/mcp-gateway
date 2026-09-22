// @vitest-environment jsdom

/**
 * The run page keeps the filter it was asked for (SCRUM-303).
 *
 * "Show passes too" fetched the passes once, and the three-second poll of a
 * running run then replaced them with the default page, which leaves passes
 * out. So the passes appeared and vanished on the next tick, and the page
 * contradicted its own checkbox for as long as the run lasted. Unticking it
 * did nothing either: the passes stayed until a poll happened to replace
 * them, and on a finished run no poll ever did.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RunDetail } from "./run-detail";
import type { RunStatus } from "@/gateway/tests/read";

const RUN_ID = "aaaaaaaa-0000-4000-8000-000000000000";

const status = (over: Partial<RunStatus> = {}): RunStatus => ({
  run_id: RUN_ID,
  status: "running",
  environment: "local",
  trigger: "ui",
  imported_from: null,
  started_at: "2026-09-22T00:00:00.000Z",
  finished_at: null,
  gateway_sha: null,
  plugin_shas: {},
  tools_served: 0,
  totals: { pass: 1, fail: 1, skip: 0, uncovered: 0 },
  done: 2,
  green: false,
  ...over,
});

const row = (case_id: string, s: string) => ({
  case_id,
  kind: "case",
  status: s,
  cleanup: "none_needed",
  duration_ms: 1,
  evidence: "",
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The endpoint as the route answers it: passes only when asked for. */
function stubRun(runStatus: () => RunStatus) {
  const fetchMock = vi.fn(async (url: string) => {
    const withPasses = new URL(url, "http://x").searchParams.getAll("status").includes("pass");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        run: runStatus(),
        results: withPasses ? [row("A1", "pass"), row("B1", "fail")] : [row("B1", "fail")],
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function checkbox() {
  return container.querySelector('input[type="checkbox"]') as HTMLInputElement;
}

async function toggle() {
  await act(async () => {
    checkbox().click();
  });
  await tick(0);
}

describe("the run page and its show-passes filter", () => {
  it("keeps the passes through the poll of a running run", async () => {
    const fetchMock = stubRun(() => status());
    act(() => root.render(<RunDetail run={status()} initialResults={[row("B1", "fail")]} />));

    await toggle();
    expect(container.textContent).toContain("A1");

    await tick(3100);
    expect(container.textContent).toContain("A1");
    // The poll itself asked for the passes, rather than a second fetch
    // happening to win a race against it.
    const polled = fetchMock.mock.calls.map(([url]) => url as string);
    expect(polled.length).toBeGreaterThanOrEqual(2);
    expect(polled.every((u) => u.includes("status=pass"))).toBe(true);
  });

  it("drops the passes again when unticked, on a finished run too", async () => {
    stubRun(() => status({ status: "finished" }));
    act(() =>
      root.render(<RunDetail run={status({ status: "finished" })} initialResults={[row("B1", "fail")]} />)
    );

    await toggle();
    expect(container.textContent).toContain("A1");

    await toggle();
    expect(container.textContent).not.toContain("A1");
    expect(container.textContent).toContain("B1");
  });
});
