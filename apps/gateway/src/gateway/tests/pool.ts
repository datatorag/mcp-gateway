import type { TestCase } from "./types";
import { POOL_SIZE, RUN_CEILING_MS, realClock, type Clock } from "./runner";

/**
 * Running many cases (SCRUM-303): bounded concurrency, named locks, and a
 * ceiling on the whole run.
 *
 * Four at a time because the suite spends its life waiting on Google, not on
 * us, and one at a time would make a full run take as long as the sum of its
 * network latencies. The locks are what make that safe: cases that share
 * mutable state (one scratch tab, one mail thread, one Jira board) declare
 * the same `serial` name and never overlap.
 *
 * The ceiling exists because a run that never ends reports nothing at all. A
 * case that has not started when the ceiling passes is a `skip` with that
 * reason, which is a result; a run that hangs is not.
 *
 * Two things to know before building on this. A size of zero or less is
 * clamped to one rather than honoured: spawning no workers would drop every
 * case silently and report an empty, green run. And when a worker throws,
 * `Promise.all` rejects while its peers keep going and keep appending to
 * `results`, so do not treat that rejection as "the run is over".
 */

export type ScheduledOutcome<T> = { testCase: TestCase; result: T | null; skipped?: string };

export async function runPool<T>(
  cases: readonly TestCase[],
  worker: (testCase: TestCase) => Promise<T>,
  opts?: { size?: number; ceilingMs?: number; clock?: Clock }
): Promise<ScheduledOutcome<T>[]> {
  const size = opts?.size ?? POOL_SIZE;
  const ceilingMs = opts?.ceilingMs ?? RUN_CEILING_MS;
  const clock = opts?.clock ?? realClock;
  const deadline = clock.now() + ceilingMs;

  const queue = [...cases];
  const held = new Set<string>();
  const results: ScheduledOutcome<T>[] = [];
  /** Workers parked because every remaining case is behind a lock someone
   * else holds. Woken when a lock is released.
   *
   * THIS IS NOT A POLL, and it was one: the first version slept on the
   * injected clock and spun. A fake clock's sleep resolves immediately, so
   * the loop starved the macrotask queue, the real timers the other workers
   * were waiting on never fired, and the suite hung rather than failed. A
   * busy-wait whose delay is injectable is a busy-wait with no delay. */
  let waiters: (() => void)[] = [];

  /** Cases that have FINISHED, however they finished. A dependent waits on
   * completion, not on success: whether a failed dependency should block is
   * the caller's question, and it answers it by checking what failed. */
  const done = new Set<string>();
  /** Everything this run selected, so a need naming a case that is not here
   * is recognised as unmeetable rather than waited on forever. */
  const ids = new Set(cases.map((c) => c.id));
  /** Workers currently inside a case. If nothing is running and nothing is
   * runnable, no future event can change that. */
  let running = 0;

  function releaseLock(lock: string | undefined): void {
    if (lock) held.delete(lock);
    const woken = waiters;
    waiters = [];
    for (const wake of woken) wake();
  }

  /** Every id this case named in `needs` has finished. */
  function needsMet(testCase: TestCase): boolean {
    return (testCase.needs ?? []).every((id) => done.has(id) || !ids.has(id));
  }

  /** Finished, and wake anyone parked behind it. */
  function finish(testCase: TestCase): void {
    done.add(testCase.id);
    releaseLock(testCase.serial);
  }

  /** The next case whose lock, if it has one, nobody is holding. Returning
   * undefined means "nothing runnable right now", which is different from
   * "nothing left" and is why the workers wait rather than exit. */
  function takeRunnable(): TestCase | undefined {
    /* `needs` IS A BARRIER, NOT JUST AN ORDERING.
     *
     * It used to be neither: `orderByNeeds` put a dependent later in the
     * queue and nothing stopped a worker from starting it while its
     * dependency was still running. With four workers, D12 and D13 both
     * began while D10 was mid-flight and read what D10 had not yet shared.
     * That was survivable only while `ctx.from` answered `{}` for everyone;
     * the moment it started refusing, it became a deterministic failure
     * whose message blamed the case's own declaration, which was correct.
     *
     * A need naming a case this run did not select is not a barrier, since
     * it will never complete; the caller reports those separately as
     * unresolved. */
    const index = queue.findIndex(
      (c) => (!c.serial || !held.has(c.serial)) && needsMet(c)
    );
    if (index === -1) return undefined;
    const [testCase] = queue.splice(index, 1);
    if (testCase.serial) held.add(testCase.serial);
    return testCase;
  }

  async function runWorker(): Promise<void> {
    for (;;) {
      if (queue.length === 0) return;
      const testCase = takeRunnable();
      if (!testCase) {
        /* NOTHING RUNNABLE. If something is still running it will finish and
         * wake us, so park. If NOTHING is running, no future event can make
         * anything runnable and parking would hang the run: a deadlocked
         * pool holds the single run slot for ever and the page shows a run
         * that never ends, which is worse than any failure it could report.
         * So the remainder is drained, each case saying what it waited for. */
        if (running === 0) {
          for (const stuck of queue.splice(0)) {
            const waitingFor = (stuck.needs ?? []).filter((id) => !done.has(id) && ids.has(id));
            results.push({
              testCase: stuck,
              result: null,
              skipped:
                waitingFor.length > 0
                  ? `it waits on ${waitingFor.join(", ")}, which never completed`
                  : "no case was runnable and nothing was running, so the pool could not progress",
            });
          }
          return;
        }
        await new Promise<void>((resolve) => waiters.push(resolve));
        continue;
      }
      if (clock.now() >= deadline) {
        results.push({ testCase, result: null, skipped: `the run ceiling of ${ceilingMs} ms passed before this case started` });
        // Still FINISHED for scheduling purposes: a dependent parked behind
        // a case the ceiling skipped must be released, or the pool deadlocks
        // and the run hangs instead of reporting.
        finish(testCase);
        continue;
      }
      running += 1;
      try {
        results.push({ testCase, result: await worker(testCase) });
      } finally {
        running -= 1;
        finish(testCase);
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(Math.max(1, size), Math.max(cases.length, 1)) }, runWorker));
  } finally {
    // A worker that threw leaves its peers parked on a lock that will never
    // be released, and Promise.all has already rejected. Wake them so the
    // process is not held open by a promise nobody will settle.
    const woken = waiters;
    waiters = [];
    for (const wake of woken) wake();
  }
  return results;
}

/** True while at least one case with this lock is still to run or running. */
export function locksOf(cases: readonly TestCase[]): string[] {
  return [...new Set(cases.map((c) => c.serial).filter((s): s is string => Boolean(s)))];
}
