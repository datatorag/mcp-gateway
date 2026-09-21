// @vitest-environment jsdom

/**
 * The runs list refreshes itself while a run is going (SCRUM-303).
 *
 * Written because it did not. A watcher sat on this page through a run that
 * finished in 23 seconds and the row still said `running`, so the elapsed
 * time they read off the page was their own waiting rather than the run's.
 * The detail view had a poll and the list, which is the first thing anyone
 * looks at, had none.
 *
 * The second test is the half that keeps the fix honest: an idle page must
 * not poll forever.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RunsPanel } from "./runs-panel";
import type { RunSummary } from "@/gateway/tests/read";

const run = (over: Partial<RunSummary> & { run_id: string }): RunSummary =>
  ({
    status: "running",
    environment: "local",
    trigger: "ui",
    imported_from: null,
    started_at: "2026-09-20T23:52:24.000Z",
    finished_at: null,
    gateway_sha: null,
    plugin_shas: {},
    tools_served: 0,
    totals: { pass: 0, fail: 0, skip: 0, uncovered: 0 },
    ...over,
  }) as RunSummary;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Resolves the list endpoint with whatever the test says is current. */
function stubList(next: () => RunSummary[]) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ runs: next() }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("the runs list while a run is going", () => {
  it("re-fetches and shows the run as finished without a reload", async () => {
    let current = [run({ run_id: "aaaaaaaa-0000-0000-0000-000000000000" })];
    const fetchMock = stubList(() => current);

    act(() => {
      root.render(<RunsPanel initialRuns={current} caseCount={25} />);
    });
    expect(container.textContent).toContain("running");

    current = [run({ run_id: "aaaaaaaa-0000-0000-0000-000000000000", status: "finished" })];
    await tick(3100);

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/tests/runs");
    expect(container.textContent).toContain("finished");
    expect(container.textContent).not.toContain("running");
  });

  it("stops polling once nothing is running, so an idle page is quiet", async () => {
    let current = [run({ run_id: "bbbbbbbb-0000-0000-0000-000000000000" })];
    const fetchMock = stubList(() => current);

    act(() => {
      root.render(<RunsPanel initialRuns={current} caseCount={25} />);
    });

    current = [run({ run_id: "bbbbbbbb-0000-0000-0000-000000000000", status: "finished" })];
    await tick(3100);
    const afterFinish = fetchMock.mock.calls.length;

    await tick(30_000);
    expect(fetchMock.mock.calls.length).toBe(afterFinish);
  });

  it("never polls a page that opened with no run in flight", async () => {
    const fetchMock = stubList(() => []);
    act(() => {
      root.render(
        <RunsPanel
          initialRuns={[run({ run_id: "cccccccc-0000-0000-0000-000000000000", status: "finished" })]}
          caseCount={25}
        />
      );
    });
    await tick(30_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
