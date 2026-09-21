import type { TestCase, CaseContext } from "./types";

/**
 * Running cases (SCRUM-303): one case, then many, with the rules that stop a
 * suite lying about what it proved.
 *
 * The three that matter, and why each is here rather than left to a case:
 *
 * - CLEANUP RUNS WHETHER OR NOT THE BODY DID. A case that fails halfway has
 *   already created things, and it is exactly the failing run whose mess
 *   nobody is watching. So undos are registered as they go and run in
 *   reverse in a `finally`.
 * - A TIMEOUT IS A RESULT, not a hang. A case that never returns would
 *   otherwise take the whole run's ceiling with it and report nothing.
 * - A RETRY IS FOR TRANSPORT, NEVER FOR AN ASSERTION. Retrying a failed
 *   assertion until it passes is how a suite stops meaning anything.
 */

export type CaseStatus = "pass" | "fail" | "skip";
export type CaseCleanup = "clean" | "none_needed" | "leaked";

export type CaseOutcome = {
  caseId: string;
  status: CaseStatus;
  cleanup: CaseCleanup;
  durationMs: number;
  evidence: string[];
  toolsCalled: string[];
};

export const DEFAULT_CASE_TIMEOUT_MS = 60_000;
export const UNDO_TIMEOUT_MS = 20_000;
export const RUN_CEILING_MS = 20 * 60_000;
export const POOL_SIZE = 4;

export type Clock = {
  now(): number;
  sleep(ms: number): Promise<void>;
};

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** A transient upstream failure, the only thing worth one retry. An
 * assertion failure is never transient, and neither is a refusal. */
export function isTransient(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (/assert|expected|refused|send refused/i.test(message)) return false;
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|\b5\d\d\b|temporarily|rate.?limit/i.test(
    message
  );
}

export class CaseTimeout extends Error {}

async function withTimeout<T>(what: string, ms: number, work: () => Promise<T>, clock: Clock): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CaseTimeout(`${what} exceeded ${ms} ms`)), ms);
        // Never hold the process open for a timer that is only a deadline.
        (timer as unknown as { unref?: () => void }).unref?.();
        void clock;
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** `until`: the one way a case waits. A poll with a stated budget, never a
 * sleep, because a sleep encodes a guess about someone else's latency and
 * fails on the day it is wrong. */
export function createUntil(clock: Clock) {
  return async function until<T>(
    what: string,
    probe: () => Promise<T | undefined>,
    opts?: { everyMs?: number; forMs?: number }
  ): Promise<T> {
    const everyMs = opts?.everyMs ?? 2_000;
    const forMs = opts?.forMs ?? 60_000;
    const deadline = clock.now() + forMs;
    let attempts = 0;
    for (;;) {
      attempts += 1;
      const value = await probe();
      if (value !== undefined) return value;
      if (clock.now() >= deadline) {
        throw new Error(`waited ${forMs} ms over ${attempts} attempts for ${what}, and it did not happen`);
      }
      await clock.sleep(everyMs);
    }
  };
}

/** A run-and-case stamp. Exported because the trash helper has to recognise
 * this run's own mail, and two copies of this formula would be two chances
 * for a cleanup to stop recognising what it created. */
export function stampFor(runId: string, caseId: string): string {
  return `${runId.slice(0, 8)}-${caseId}`;
}

export type ContextParts = Omit<CaseContext, "defer" | "evidence" | "until" | "runId" | "stamp">;

/**
 * One case, with its cleanup. `makeParts` builds the half of the context
 * that talks to the outside (call, rpc, http, fixture, from, share), so this
 * function stays testable with no gateway at all.
 */
export async function runOneCase(
  testCase: TestCase,
  opts: {
    runId: string;
    makeParts: (caseId: string) => ContextParts;
    clock?: Clock;
    toolsCalled?: () => string[];
  }
): Promise<CaseOutcome> {
  const clock = opts.clock ?? realClock;
  const started = clock.now();
  const evidence: string[] = [];
  const undos: { label: string; undo: () => Promise<void> }[] = [];

  const ctx: CaseContext = {
    ...opts.makeParts(testCase.id),
    runId: opts.runId,
    stamp: stampFor(opts.runId, testCase.id),
    defer: (label, undo) => {
      undos.push({ label, undo });
    },
    evidence: (line) => {
      evidence.push(line);
    },
    until: createUntil(clock),
  };

  let status: CaseStatus = "pass";
  const timeoutMs = testCase.timeoutMs ?? DEFAULT_CASE_TIMEOUT_MS;

  try {
    await withTimeout(`case ${testCase.id}`, timeoutMs, () => testCase.run(ctx), clock);
  } catch (err) {
    if (isTransient(err)) {
      evidence.push(`first attempt failed transiently (${describe(err)}); retried once`);
      try {
        await withTimeout(`case ${testCase.id} retry`, timeoutMs, () => testCase.run(ctx), clock);
      } catch (retryErr) {
        status = "fail";
        evidence.push(describe(retryErr));
      }
    } else {
      status = "fail";
      evidence.push(describe(err));
    }
  } finally {
    // Reverse order: the last thing created is the first thing undone, which
    // is the only order that works when one artifact lives inside another.
  }

  let cleanup: CaseCleanup = undos.length === 0 ? "none_needed" : "clean";
  for (const { label, undo } of [...undos].reverse()) {
    try {
      await withTimeout(`undo ${label}`, UNDO_TIMEOUT_MS, undo, clock);
    } catch (err) {
      // One failing undo must not stop the next: the rest of the mess is
      // still worth clearing, and every failure is worth naming.
      cleanup = "leaked";
      evidence.push(`cleanup failed for ${label}: ${describe(err)}`);
    }
  }

  return {
    caseId: testCase.id,
    status,
    cleanup,
    durationMs: clock.now() - started,
    evidence,
    toolsCalled: opts.toolsCalled?.() ?? [],
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Cases in an order that respects `needs`, with anything unreachable named.
 * A cycle is a bug in the suite, not a runtime condition, so it is reported
 * rather than broken arbitrarily.
 */
export function orderByNeeds(cases: readonly TestCase[]): {
  order: TestCase[];
  unresolved: { caseId: string; reason: string }[];
} {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const order: TestCase[] = [];
  const placed = new Set<string>();
  const unresolved: { caseId: string; reason: string }[] = [];

  let progressed = true;
  let remaining = [...cases];
  while (progressed && remaining.length > 0) {
    progressed = false;
    const next: TestCase[] = [];
    for (const c of remaining) {
      const needs = c.needs ?? [];
      const missing = needs.filter((n) => !byId.has(n));
      if (missing.length > 0) {
        unresolved.push({ caseId: c.id, reason: `needs ${missing.join(", ")}, which is not in this run` });
        placed.add(c.id);
        progressed = true;
        continue;
      }
      if (needs.every((n) => placed.has(n))) {
        order.push(c);
        placed.add(c.id);
        progressed = true;
      } else {
        next.push(c);
      }
    }
    remaining = next;
  }

  for (const c of remaining) {
    unresolved.push({ caseId: c.id, reason: "its needs form a cycle" });
  }
  return { order, unresolved };
}
