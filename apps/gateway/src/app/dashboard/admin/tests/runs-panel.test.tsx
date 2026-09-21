// @vitest-environment jsdom

/**
 * The runs list refreshes itself (SCRUM-303).
 *
 * TWO OF THESE TESTS USED TO ASSERT THE DEFECT, and that is worth saying
 * plainly rather than quietly rewriting. The first version polled only while
 * the list ALREADY held a `running` row, and two tests pinned the silence of
 * a page with nothing running. The condition was computed from the very list
 * the poll exists to fetch, so an empty history never polled and "No runs
 * yet" was a state nothing could leave. On a database with no runs in it,
 * which is every fresh branch, that is the whole page.
 *
 * It was found from the server log of a real run: between the POST that
 * started it and the next manual reload, the list endpoint was not requested
 * once, while the DETAIL endpoint was polled forty times.
 *
 * So the poll is unconditional now and the state picks the CADENCE. The
 * tests below say what is quiet (a hidden tab) and what is not (an idle but
 * visible page, which polls slowly so a run started anywhere else appears).
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
  setHidden(false);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** jsdom reports a visible document; these tests need to say otherwise. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
}

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

function render(initialRuns: RunSummary[]) {
  act(() => {
    root.render(<RunsPanel initialRuns={initialRuns} caseCount={25} />);
  });
}

describe("the runs list while a run is going", () => {
  it("re-fetches and shows the run as finished without a reload", async () => {
    let current = [run({ run_id: "aaaaaaaa-0000-0000-0000-000000000000" })];
    const fetchMock = stubList(() => current);

    render(current);
    expect(container.textContent).toContain("running");

    current = [run({ run_id: "aaaaaaaa-0000-0000-0000-000000000000", status: "finished" })];
    await tick(3100);

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/tests/runs");
    expect(container.textContent).toContain("finished");
    expect(container.textContent).not.toContain("running");
  });

  it("drops to a slow cadence once nothing is running", async () => {
    /* The old assertion here was zero requests over 30 s. It is a count now,
     * not silence: over 30 s of idle the page asks twice at 15 s, where a
     * page with a live run would have asked ten times at 3 s. Both numbers
     * are asserted, so neither cadence can drift into the other. */
    let current = [run({ run_id: "bbbbbbbb-0000-0000-0000-000000000000" })];
    const fetchMock = stubList(() => current);

    render(current);

    current = [run({ run_id: "bbbbbbbb-0000-0000-0000-000000000000", status: "finished" })];
    await tick(3100);
    const afterFinish = fetchMock.mock.calls.length;

    await tick(30_000);
    expect(fetchMock.mock.calls.length - afterFinish).toBe(2);
  });

  it("polls fast while a run is live", async () => {
    const current = [run({ run_id: "dddddddd-0000-0000-0000-000000000000" })];
    const fetchMock = stubList(() => current);

    render(current);
    await tick(30_000);
    expect(fetchMock.mock.calls.length).toBe(10);
  });
});

/**
 * THE REGRESSION. A page that opened with an empty history is the one that
 * could never recover, and an empty history is what every fresh branch has.
 */
describe("a page that opened with no history at all", () => {
  it("picks up a run somebody started elsewhere, without a reload", async () => {
    let current: RunSummary[] = [];
    const fetchMock = stubList(() => current);

    render([]);
    expect(container.textContent).toContain("No runs yet");

    current = [run({ run_id: "eeeeeeee-0000-0000-0000-000000000000" })];
    await tick(15_100);

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/tests/runs");
    expect(container.textContent).not.toContain("No runs yet");
    expect(container.textContent).toContain("running");
  });

  it("recovers when the refresh right after a start does not land", async () => {
    /* The start returns an id, the refresh that follows it fails, and the
     * page must still show the run. Before `startedId` the list stayed empty,
     * an empty list meant nothing was running, and nothing running meant no
     * poll: one dropped request and the page was stale until somebody
     * pressed reload. */
    let listed: RunSummary[] = [];
    let listFails = true;
    const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
      if (init?.method === "POST") {
        return {
          ok: true,
          status: 202,
          json: async () => ({ run_id: "ffffffff-0000-0000-0000-000000000000", cases: 32 }),
        };
      }
      if (listFails) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ runs: listed }) };
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render([]);

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "gateway")!
        .click();
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "Yes, start")!
        .click();
    });
    expect(container.textContent).toContain("No runs yet");

    listFails = false;
    listed = [run({ run_id: "ffffffff-0000-0000-0000-000000000000" })];
    await tick(3100);

    expect(container.textContent).toContain("running");
  });
});

describe("a tab nobody is looking at", () => {
  it("asks for nothing while hidden, and catches up when it is shown", async () => {
    /* This is what the deleted "idle page is quiet" assertion was really
     * protecting, and it survives the change: the page is silent when it is
     * not being read, rather than silent when it happens to know nothing. */
    let current = [run({ run_id: "99999999-0000-0000-0000-000000000000" })];
    const fetchMock = stubList(() => current);

    render(current);
    await tick(3100);
    const beforeHide = fetchMock.mock.calls.length;
    expect(beforeHide).toBeGreaterThan(0);

    setHidden(true);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await tick(60_000);
    expect(fetchMock.mock.calls.length).toBe(beforeHide);

    current = [run({ run_id: "99999999-0000-0000-0000-000000000000", status: "finished" })];
    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(fetchMock.mock.calls.length).toBe(beforeHide + 1);
    expect(container.textContent).toContain("finished");
  });
});
