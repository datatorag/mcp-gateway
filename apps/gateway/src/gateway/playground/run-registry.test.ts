import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RUN_REGISTRY_TTL_MS,
  resetRunRegistry,
  runEnded,
  runStarted,
  runStatus,
  runStep,
} from "./run-registry";

/**
 * SCRUM-254: what the product knows about a thread's run after the viewer
 * has gone. Process memory, like the run token accumulator: a restart
 * forgets it, which is the accepted trade.
 */
describe("run registry (SCRUM-254)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRunRegistry();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("knows nothing about a thread that never ran", () => {
    expect(runStatus("t-none")).toBeUndefined();
  });

  it("follows a run from start, through its steps, to how it ended", () => {
    runStarted("t1", { runId: "r1", skill: "morning-brief", cap: 60 });
    expect(runStatus("t1")).toMatchObject({ runId: "r1", skill: "morning-brief", cap: 60, steps: 0, state: "running" });
    runStep("t1");
    runStep("t1");
    expect(runStatus("t1")).toMatchObject({ steps: 2, state: "running" });
    runEnded("t1", { state: "stopped", limit: "size" });
    expect(runStatus("t1")).toMatchObject({ steps: 2, state: "stopped", limit: "size" });
  });

  it("a completed run reads as completed, with no limit", () => {
    runStarted("t2", { runId: "r2", skill: null, cap: 12 });
    runStep("t2");
    runEnded("t2", { state: "completed" });
    expect(runStatus("t2")).toMatchObject({ state: "completed", steps: 1 });
    expect(runStatus("t2")?.limit).toBeUndefined();
  });

  it("a failed run reads as failed", () => {
    runStarted("t3", { runId: "r3", skill: "morning-brief", cap: 60 });
    runEnded("t3", { state: "failed" });
    expect(runStatus("t3")).toMatchObject({ state: "failed" });
  });

  it("a new run on the same thread replaces the old record", () => {
    runStarted("t4", { runId: "r4a", skill: null, cap: 12 });
    runStep("t4");
    runEnded("t4", { state: "completed" });
    runStarted("t4", { runId: "r4b", skill: "inbox-triage", cap: 60 });
    expect(runStatus("t4")).toMatchObject({ runId: "r4b", steps: 0, state: "running" });
  });

  it("a step or an end for a thread it does not know is ignored, not invented", () => {
    runStep("t-unknown");
    runEnded("t-unknown", { state: "completed" });
    expect(runStatus("t-unknown")).toBeUndefined();
  });

  it("forgets a record after its time to live, so a run lost to a restart-free stall does not read as running forever", () => {
    runStarted("t5", { runId: "r5", skill: null, cap: 12 });
    vi.advanceTimersByTime(RUN_REGISTRY_TTL_MS - 1);
    expect(runStatus("t5")).toBeDefined();
    vi.advanceTimersByTime(2);
    expect(runStatus("t5")).toBeUndefined();
  });

  it("a step refreshes the time to live", () => {
    runStarted("t6", { runId: "r6", skill: null, cap: 12 });
    vi.advanceTimersByTime(RUN_REGISTRY_TTL_MS - 1);
    runStep("t6");
    vi.advanceTimersByTime(RUN_REGISTRY_TTL_MS - 1);
    expect(runStatus("t6")).toMatchObject({ steps: 1 });
  });
});
