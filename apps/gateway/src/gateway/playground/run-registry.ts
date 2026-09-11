/**
 * What the product knows about a thread's run once the viewer is gone
 * (SCRUM-254).
 *
 * The chat route streams a run to the browser and the runtime persists the
 * messages as it goes. When the browser disconnects mid-run the run carries
 * on, and nothing used to record that it was still going or how it ended.
 * The thread reader then had no way to say "still running" or "stopped at
 * its size limit" to a user who reloads; they saw the messages that had
 * landed and no explanation.
 *
 * This is that record: one entry per thread, for the run in flight or the
 * last one that ended, updated by the chat route from the same stream events
 * it already counts and read by the thread route when it replays a thread.
 *
 * A COUNTER, NOT A LEDGER, the same doctrine as the run token accumulator:
 * process memory, bounded, and reset by a restart. A run that was in flight
 * at a restart is not reported at all, which is the same trade the token
 * counter makes. An entry also expires after RUN_REGISTRY_TTL_MS without an
 * update, so a run whose end was never recorded cannot read as running for
 * ever.
 */

export type RunState = "running" | "completed" | "stopped" | "failed";

/** Which limit ended a stopped run. */
export type RunLimit = "steps" | "size";

export interface RunRecord {
  runId: string;
  skill: string | null;
  cap: number;
  steps: number;
  state: RunState;
  limit?: RunLimit;
  startedAt: number;
  updatedAt: number;
}

/** Long enough for the largest run the step cap allows at the slowest step
 * time seen, with room; short enough that a lost end cannot pin a thread as
 * running past the day. */
export const RUN_REGISTRY_TTL_MS = 6 * 60 * 60 * 1000;

const MAX_TRACKED_THREADS = 1024;
const records = new Map<string, RunRecord>();

function live(threadId: string): RunRecord | undefined {
  const record = records.get(threadId);
  if (!record) return undefined;
  if (Date.now() - record.updatedAt > RUN_REGISTRY_TTL_MS) {
    records.delete(threadId);
    return undefined;
  }
  return record;
}

export function runStarted(
  threadId: string,
  run: { runId: string; skill: string | null; cap: number }
): void {
  if (!records.has(threadId) && records.size >= MAX_TRACKED_THREADS) {
    const oldest = records.keys().next().value;
    if (oldest !== undefined) records.delete(oldest);
  }
  const now = Date.now();
  records.set(threadId, {
    runId: run.runId,
    skill: run.skill,
    cap: run.cap,
    steps: 0,
    state: "running",
    startedAt: now,
    updatedAt: now,
  });
}

/** One model call started. Unknown threads are ignored rather than invented:
 * a step with no start is a record this process never made. */
export function runStep(threadId: string): void {
  const record = live(threadId);
  if (!record) return;
  record.steps += 1;
  record.updatedAt = Date.now();
}

export function runEnded(
  threadId: string,
  end: { state: "completed" | "failed" } | { state: "stopped"; limit: RunLimit }
): void {
  const record = live(threadId);
  if (!record) return;
  record.state = end.state;
  if (end.state === "stopped") record.limit = end.limit;
  else delete record.limit;
  record.updatedAt = Date.now();
}

/** The thread's run as this process last saw it, or nothing. Returned as a
 * copy so a reader cannot move the record. */
export function runStatus(threadId: string): RunRecord | undefined {
  const record = live(threadId);
  return record ? { ...record } : undefined;
}

/** Test seam: the registry is process state, and tests must not leak runs
 * into each other. */
export function resetRunRegistry(): void {
  records.clear();
}
