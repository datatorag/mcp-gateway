import { describe, expect, it, vi } from "vitest";

import { recordRunUsage, type RunUsageRow } from "./run-usage";

/**
 * SCRUM-257: the per-run row is the accumulator's mirror after every step.
 * One upsert per write, every field carried, and a failure logged rather
 * than thrown: accounting must never be the reason a turn fails.
 */

/** A db whose insert chain records what it was given and resolves, or rejects. */
function fakeDb(fail = false) {
  const calls: { values?: unknown; conflict?: unknown } = {};
  const chain = {
    values: (v: unknown) => {
      calls.values = v;
      return {
        onConflictDoUpdate: (c: unknown) => {
          calls.conflict = c;
          return fail ? Promise.reject(new Error("db down")) : Promise.resolve();
        },
      };
    },
  };
  return { db: { insert: () => chain } as never, calls };
}

const RUN: RunUsageRow = {
  runId: "run-1",
  userId: "user-1",
  threadId: "thread-1",
  skill: "morning-brief",
  model: "claude-sonnet-5",
  startedAt: new Date("2026-09-11T15:46:31.000Z"),
  endedAt: null,
};

const USAGE = { steps: 3, input: 14, cacheRead: 100_000, cacheWrite: 50_000, output: 20_000, reasoning: 15_000, weighted: 80_000 };

describe("recordRunUsage (SCRUM-257)", () => {
  it("upserts one row keyed by run id with every bucket, the step count and the priced cost", async () => {
    const { db, calls } = fakeDb();
    await recordRunUsage(db, RUN, USAGE);
    expect(calls.values).toMatchObject({
      runId: "run-1",
      userId: "user-1",
      threadId: "thread-1",
      skill: "morning-brief",
      model: "claude-sonnet-5",
      steps: 3,
      inputTokens: 14,
      cacheReadTokens: 100_000,
      cacheWriteTokens: 50_000,
      outputTokens: 20_000,
      reasoningTokens: 15_000,
      weightedTokens: 80_000,
      startedAt: RUN.startedAt,
      endedAt: null,
    });
    const values = calls.values as { costUsd: string | number };
    expect(Number(values.costUsd)).toBeGreaterThan(0);
    // The later write for the same run replaces the counts, not adds to them.
    const conflict = calls.conflict as { target: unknown; set: Record<string, unknown> };
    expect(conflict.set).toMatchObject({ steps: 3, weightedTokens: 80_000 });
  });

  it("carries the end time on the final write", async () => {
    const { db, calls } = fakeDb();
    const ended = new Date("2026-09-11T15:59:05.000Z");
    await recordRunUsage(db, { ...RUN, endedAt: ended }, USAGE);
    expect(calls.values).toMatchObject({ endedAt: ended });
  });

  it("stores no cost for a model with no price row, rather than zero", async () => {
    const { db, calls } = fakeDb();
    await recordRunUsage(db, { ...RUN, model: "unpriced-model" }, USAGE);
    expect((calls.values as { costUsd: unknown }).costUsd).toBeNull();
  });

  it("never throws: a failed write is logged and the turn goes on", async () => {
    const { db } = fakeDb(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordRunUsage(db, RUN, USAGE)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
