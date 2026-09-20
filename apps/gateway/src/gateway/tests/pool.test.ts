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
  tier: 1,
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
