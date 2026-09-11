import type { Database } from "@datatorag-mcp/db";
import { agentRunUsage } from "@datatorag-mcp/db";

import type { RunUsage } from "@/mastra/run-token-budget";
import { costUsd } from "./model-prices";

/**
 * The per-run accounting row (SCRUM-257), written from the run token
 * accumulator after every step and when the run ends. One upsert keyed by
 * the run id, every field replaced, so the row is the accumulator's mirror
 * and a later write never adds to an earlier one.
 *
 * Never throws and never blocks a turn for long: a failed or slow write is
 * logged and the turn goes on, the same convention as tool metering. The
 * cost is priced here, at write time, from the one price table; a model
 * with no row stores null rather than zero.
 */

export interface RunUsageRow {
  runId: string;
  userId: string;
  threadId: string;
  skill: string | null;
  model: string;
  startedAt: Date;
  endedAt: Date | null;
}

const WRITE_TIMEOUT_MS = 500;

export async function recordRunUsage(db: Database, run: RunUsageRow, usage: RunUsage): Promise<void> {
  const cost = costUsd(run.model, usage);
  const counts = {
    steps: usage.steps,
    inputTokens: usage.input,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    outputTokens: usage.output,
    reasoningTokens: usage.reasoning,
    weightedTokens: Math.round(usage.weighted),
    costUsd: cost === null ? null : cost.toFixed(6),
    endedAt: run.endedAt,
    updatedAt: new Date(),
  };
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), WRITE_TIMEOUT_MS);
  });
  try {
    const write = db
      .insert(agentRunUsage)
      .values({
        runId: run.runId,
        userId: run.userId,
        threadId: run.threadId,
        skill: run.skill,
        model: run.model,
        startedAt: run.startedAt,
        ...counts,
      })
      // The start time and the identity stay as first written; the counts
      // are the newest reading.
      .onConflictDoUpdate({ target: agentRunUsage.runId, set: counts });
    const outcome = await Promise.race([Promise.resolve(write).then(() => "ok" as const), timeout]);
    if (outcome === "timeout") console.warn(`[run-usage] write timed out for run=${run.runId}`);
  } catch (err) {
    console.warn(`[run-usage] write failed for run=${run.runId}`, err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
