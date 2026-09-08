import { and, eq, lte } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import {
  skillRuns,
  skillSchedules,
  type Delivery,
  type PauseReason,
  type RunStatus,
  type ScheduleCadence,
} from "@datatorag-mcp/db";
import { nextRunAt } from "./schedule-time";

/**
 * Persistence for scheduled skill runs (SCRUM-225), behind an interface so
 * the runner's outcome table is tested without a database and the one
 * property that needs real SQL, the claim, is tested against real Postgres.
 */

export type ScheduleRow = {
  id: string;
  userId: string;
  skillSlug: string;
  cadence: ScheduleCadence;
  hour: number;
  minute: number;
  weekday: number | null;
  timezone: string;
  paused: boolean;
  pausedReason: PauseReason | null;
  consecutiveFailures: number;
  lastRunAt: Date | null;
  nextRunAt: Date;
};

export type RunPatch = {
  status: Exclude<RunStatus, "running">;
  threadId?: string | null;
  toolCalls: Record<string, number>;
  toolCallCount: number;
  delivered: Delivery | null;
  error: string | null;
  finishedAt: Date;
};

export type SchedulePatch = {
  paused?: boolean;
  pausedReason?: PauseReason | null;
  consecutiveFailures?: number;
  lastRunAt?: Date;
};

export type RunRow = {
  id: string;
  scheduleId: string;
  userId: string;
  skillSlug: string;
  runId: string | null;
  status: RunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  threadId: string | null;
  toolCalls: Record<string, number>;
  toolCallCount: number;
  delivered: Delivery | null;
  error: string | null;
};

export interface ScheduleStore {
  /** Every schedule due at `now`, each advanced to its next occurrence in
   * the same statement that claims it. Two claimers, one winner per row. */
  claimDue(now: Date): Promise<ScheduleRow[]>;
  /** Opens the history row; returns its id. */
  startRun(input: { scheduleId: string; userId: string; skillSlug: string; runId: string }): Promise<string>;
  finishRun(rowId: string, patch: RunPatch): Promise<void>;
  patchSchedule(id: string, patch: SchedulePatch): Promise<void>;
}

export function drizzleScheduleStore(db: Database): ScheduleStore {
  return {
    async claimDue(now) {
      const due = await db
        .select()
        .from(skillSchedules)
        .where(and(eq(skillSchedules.paused, false), lte(skillSchedules.nextRunAt, now)));
      const won: ScheduleRow[] = [];
      for (const row of due) {
        // Optimistic claim on the observed next_run_at: a row whose value
        // moved under us was taken by another tick or process, and we skip it
        // without a word, which is the whole point.
        const advanced = await db
          .update(skillSchedules)
          .set({
            nextRunAt: nextRunAt(row, now),
            lastRunAt: now,
            updatedAt: now,
          })
          .where(and(eq(skillSchedules.id, row.id), eq(skillSchedules.nextRunAt, row.nextRunAt)))
          .returning({ id: skillSchedules.id });
        if (advanced.length === 1) won.push(row);
      }
      return won;
    },
    async startRun(input) {
      const [row] = await db
        .insert(skillRuns)
        .values({
          scheduleId: input.scheduleId,
          userId: input.userId,
          skillSlug: input.skillSlug,
          runId: input.runId,
          status: "running",
        })
        .returning({ id: skillRuns.id });
      return row!.id;
    },
    async finishRun(rowId, patch) {
      await db
        .update(skillRuns)
        .set({
          status: patch.status,
          threadId: patch.threadId ?? null,
          toolCalls: patch.toolCalls,
          toolCallCount: patch.toolCallCount,
          delivered: patch.delivered,
          error: patch.error,
          finishedAt: patch.finishedAt,
        })
        .where(eq(skillRuns.id, rowId));
    },
    async patchSchedule(id, patch) {
      await db
        .update(skillSchedules)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(skillSchedules.id, id));
    },
  };
}

/** The in-memory store the runner's tests use. Same contract, no SQL. */
export function memoryScheduleStore(
  schedules: ScheduleRow[] = []
): ScheduleStore & { schedules: ScheduleRow[]; runs: RunRow[] } {
  const runs: RunRow[] = [];
  let seq = 0;
  return {
    schedules,
    runs,
    async claimDue(now) {
      const won: ScheduleRow[] = [];
      for (const row of schedules) {
        if (row.paused || row.nextRunAt.getTime() > now.getTime()) continue;
        const observed = { ...row };
        row.nextRunAt = nextRunAt(row, now);
        row.lastRunAt = now;
        won.push(observed);
      }
      return won;
    },
    async startRun(input) {
      const id = `run-${++seq}`;
      runs.push({
        id,
        scheduleId: input.scheduleId,
        userId: input.userId,
        skillSlug: input.skillSlug,
        runId: input.runId,
        status: "running",
        startedAt: new Date(),
        finishedAt: null,
        threadId: null,
        toolCalls: {},
        toolCallCount: 0,
        delivered: null,
        error: null,
      });
      return id;
    },
    async finishRun(rowId, patch) {
      const run = runs.find((r) => r.id === rowId);
      if (run) Object.assign(run, patch, { threadId: patch.threadId ?? null });
    },
    async patchSchedule(id, patch) {
      const s = schedules.find((r) => r.id === id);
      if (s) Object.assign(s, patch);
    },
  };
}
