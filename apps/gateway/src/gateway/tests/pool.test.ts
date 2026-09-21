/**
 * The pool (SCRUM-303). The assertions worth having are about the LOCKS:
 * that two cases sharing one never overlap, and that holding one does not
 * stall the cases that do not need it.
 */

import { describe, expect, it, vi } from "vitest";
import { runPool, locksOf } from "./pool";
import type { Clock } from "./runner";
import type { TestCase } from "./types";

const c = (id: string, serial?: string): TestCase => ({
  id,
  title: id,
  covers: ["x"],
  accounts: [],
  serial,
  run: async () => {},
});

const clock = (): Clock => {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
};

describe("runPool", () => {
  it("runs every case exactly once", async () => {
    const seen: string[] = [];
    const out = await runPool([c("A1"), c("A2"), c("A3")], async (tc) => {
      seen.push(tc.id);
      return tc.id;
    }, { clock: clock() });
    expect(seen.sort()).toEqual(["A1", "A2", "A3"]);
    expect(out.map((o) => o.result).sort()).toEqual(["A1", "A2", "A3"]);
  });

  it("runs unlocked cases concurrently, up to the pool size", async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool(
      Array.from({ length: 8 }, (_, i) => c(`C${i}`)),
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
      },
      { size: 4, clock: clock() }
    );
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("NEVER overlaps two cases holding the same lock", async () => {
    // The claim the whole mechanism exists for: two cases writing the same
    // scratch tab at once would each see the other's rows.
    let inFlight = 0;
    let overlapped = false;
    await runPool(
      [c("D1", "sheet"), c("D2", "sheet"), c("D3", "sheet"), c("D4", "sheet")],
      async () => {
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
      },
      { size: 4, clock: clock() }
    );
    expect(overlapped).toBe(false);
  });

  it("lets a different lock run alongside", async () => {
    const running = new Set<string>();
    let sawBoth = false;
    await runPool(
      [c("D1", "sheet"), c("D2", "sheet"), c("E1", "mail"), c("E2", "mail")],
      async (tc) => {
        running.add(tc.serial!);
        if (running.size > 1) sawBoth = true;
        await new Promise((r) => setTimeout(r, 5));
        running.delete(tc.serial!);
      },
      { size: 4, clock: clock() }
    );
    expect(sawBoth).toBe(true);
  });

  it("releases a lock when the worker throws, rather than wedging the run", async () => {
    const seen: string[] = [];
    await expect(
      runPool([c("D1", "sheet"), c("D2", "sheet")], async (tc) => {
        seen.push(tc.id);
        throw new Error("boom");
      }, { clock: clock() })
    ).rejects.toThrow();
    expect(seen).toContain("D1");
  });

  it("skips what has not started once the ceiling passes, rather than hanging", async () => {
    const k = clock();
    const out = await runPool(
      [c("A1"), c("A2"), c("A3")],
      async () => { await k.sleep(1_000); },
      { size: 1, ceilingMs: 1_500, clock: k }
    );
    const skipped = out.filter((o) => o.skipped);
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0].skipped).toContain("ceiling");
  });

  it("does not spin while waiting for a lock, which would starve the timers", async () => {
    // The bug this pins: the first version polled on the INJECTED clock, and
    // a fake clock's sleep resolves immediately, so the wait became a
    // microtask loop. The real timers the running case was waiting on never
    // got a turn and the suite hung instead of failing. The park below is
    // woken by a lock release, not by a delay.
    const ticks: number[] = [];
    const k: Clock = { now: () => 0, sleep: async (ms) => { ticks.push(ms); } };
    await runPool(
      [c("D1", "sheet"), c("D2", "sheet"), c("D3", "sheet")],
      async () => { await new Promise((r) => setTimeout(r, 5)); },
      { size: 3, clock: k }
    );
    expect(ticks).toEqual([]);
  });

  it("clamps a size of zero to one instead of silently running nothing", async () => {
    // The failure shape: no workers spawn, every case is dropped with no
    // result and no error, and the run reports green having proved nothing.
    // Unreachable while the size is a literal, which is exactly when a guard
    // is cheap to add.
    const seen: string[] = [];
    const out = await runPool([c("A1"), c("A2")], async (tc) => { seen.push(tc.id); }, { size: 0, clock: clock() });
    expect(seen.sort()).toEqual(["A1", "A2"]);
    expect(out).toHaveLength(2);
  });

  it("handles an empty list without spinning", async () => {
    const worker = vi.fn();
    expect(await runPool([], worker, { clock: clock() })).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });
});

describe("locksOf", () => {
  it("names each distinct lock once", () => {
    expect(locksOf([c("A", "sheet"), c("B", "sheet"), c("C", "mail"), c("D")])).toEqual(["sheet", "mail"]);
  });
});

/**
 * `needs` IS A BARRIER, NOT JUST AN ORDERING (SCRUM-303).
 *
 * It was neither. `orderByNeeds` put a dependent later in the queue and
 * nothing stopped a worker picking it up while its dependency was still
 * running, so with four workers D12 and D13 both started while D10 was
 * mid-flight and read what D10 had not yet shared. It survived only while
 * `ctx.from` answered `{}` to everyone; the moment that started refusing,
 * it became a deterministic failure blaming a declaration that was correct.
 *
 * These run at the POOL layer on purpose. The context tests build their
 * shared map by hand, so no amount of them can see a scheduler that starts
 * a reader before its writer.
 */
describe("a case waits for what it needs", () => {
  const c = (id: string, over: Partial<TestCase> = {}): TestCase =>
    ({ id, title: id, covers: [], accounts: [], run: async () => {}, ...over }) as TestCase;

  it("never starts a dependent while its dependency is still running", async () => {
    const live = new Set<string>();
    const overlaps: string[] = [];
    const cases = [c("D10"), c("D12", { needs: ["D10"] }), c("D13", { needs: ["D10"] }), c("X")];

    await runPool(cases, async (t) => {
      for (const n of t.needs ?? []) if (live.has(n)) overlaps.push(`${t.id} started while ${n} was running`);
      live.add(t.id);
      await new Promise((r) => setTimeout(r, 5));
      live.delete(t.id);
      return { caseId: t.id, status: "pass", cleanup: "none_needed", durationMs: 0, evidence: [] };
    }, { size: 4 });

    expect(overlaps).toEqual([]);
  });

  it("runs the independent case alongside, so the barrier is not a stop-the-world", async () => {
    // The other half: waiting for a dependency must not serialise the run.
    let peak = 0;
    let live = 0;
    const cases = [c("D10"), c("D12", { needs: ["D10"] }), c("A"), c("B")];

    await runPool(cases, async (t) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return { caseId: t.id, status: "pass", cleanup: "none_needed", durationMs: 0, evidence: [] };
    }, { size: 4 });

    expect(peak).toBeGreaterThan(1);
  });

  it("releases a dependent when the CEILING skipped its dependency", async () => {
    /* The ceiling path marks the case finished for scheduling as well as
     * releasing its lock. Releasing only the lock left a dependent parked
     * behind a case that would never complete, so the pool deadlocked and
     * the drain relabelled every remaining case as waiting on something
     * that "never completed" — technically true, and useless. Reverting
     * that line passed all fifteen pool tests before this one existed. */
    const out = await runPool(
      [c("D10"), c("D12", { needs: ["D10"] })],
      async (t) => ({ caseId: t.id, status: "pass", cleanup: "none_needed", durationMs: 0, evidence: [] }),
      { size: 2, ceilingMs: -1 }
    );
    expect(out).toHaveLength(2);
    for (const r of out) expect(r.skipped).toMatch(/ceiling/);
  });

  it("waits for a dependency that FAILED, rather than hanging on it", async () => {
    // Completion, not success: whether a failed dependency should block is
    // the caller's question, and it answers it by checking what failed.
    const started: string[] = [];
    const cases = [c("D10"), c("D12", { needs: ["D10"] })];

    const out = await runPool(cases, async (t) => {
      started.push(t.id);
      return { caseId: t.id, status: t.id === "D10" ? "fail" : "pass", cleanup: "none_needed", durationMs: 0, evidence: [] };
    }, { size: 4 });

    /* WHAT THIS DOES AND DOES NOT PROVE. `runPool` never reads the worker's
     * return value, so the `status: "fail"` above is inert: what is
     * asserted is that a dependency which COMPLETED releases its dependent,
     * whatever the outcome was.
     *
     * Whether a failed dependency is then SKIPPED is `driveRun`'s decision,
     * and IT IS NOT ASSERTED ANYWHERE. `driveRun` is unexported and has no
     * unit test; only a live baseline run exercises that branch. Saying so
     * is the point of this note. An earlier version of it claimed the
     * decision was "asserted where it lives", which was untrue and worse
     * than saying nothing, because it told the next reader a real gap was
     * covered. */
    expect(started).toEqual(["D10", "D12"]);
    expect(out).toHaveLength(2);
  });

  it("DRAINS rather than deadlocks when a need can never complete", async () => {
    /* A pool that parks for ever holds the single run slot and the page
     * shows a run that never ends, which is worse than any failure it could
     * report. Each stuck case says what it waited for. */
    const cases = [c("A", { needs: ["B"] }), c("B", { needs: ["A"] })];
    const out = await runPool(cases, async (t) => ({
      caseId: t.id, status: "pass", cleanup: "none_needed", durationMs: 0, evidence: [],
    }), { size: 2 });

    expect(out).toHaveLength(2);
    expect(out.every((r) => r.skipped)).toBe(true);
    expect(out.map((r) => r.skipped).join(" ")).toContain("never completed");
  });

  it("does not wait on a need this run did not select", async () => {
    // It will never complete, so waiting is a hang. The caller reports
    // unresolved needs separately.
    const out = await runPool([c("D12", { needs: ["D10"] })], async (t) => ({
      caseId: t.id, status: "pass", cleanup: "none_needed", durationMs: 0, evidence: [],
    }), { size: 2 });

    expect(out).toHaveLength(1);
    expect(out[0].skipped).toBeUndefined();
  });
});
