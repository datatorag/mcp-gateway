import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { skillRuns, skillSchedules } from "@datatorag-mcp/db";
import type { Database } from "@datatorag-mcp/db";
import { getTestDb, insertTestUser, isDockerAvailable, stopTestDb } from "@/test-utils/db";
import { drizzleScheduleStore } from "./store";

/* SCRUM-225: the claim is real SQL against a real Postgres, because the
 * property it guarantees (two claimers, one winner) is exactly the kind a
 * stub would fake. The cron runs every minute and must be safe to run twice:
 * the loser does nothing and logs nothing alarming. */

const docker = isDockerAvailable();

describe.skipIf(!docker)("drizzleScheduleStore (real Postgres)", () => {
  let db: Database;
  let userId: string;

  beforeAll(async () => {
    db = await getTestDb();
    userId = await insertTestUser(db);
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  async function insertSchedule(nextRunAt: Date, over: Partial<typeof skillSchedules.$inferInsert> = {}) {
    const [row] = await db
      .insert(skillSchedules)
      .values({
        userId,
        skillSlug: over.skillSlug ?? "morning-brief",
        cadence: "daily",
        hour: 7,
        minute: 0,
        timezone: "America/Los_Angeles",
        nextRunAt,
        ...over,
      })
      .returning();
    return row!;
  }

  it("claimDue returns each due row to exactly one of two concurrent claimers and advances next_run_at", async () => {
    const due = new Date("2026-09-09T14:00:00Z");
    const now = new Date("2026-09-09T14:00:30Z");
    const row = await insertSchedule(due);
    const store = drizzleScheduleStore(db);

    const [a, b] = await Promise.all([store.claimDue(now), store.claimDue(now)]);
    const won = [...a, ...b].filter((s) => s.id === row.id);
    expect(won).toHaveLength(1);
    expect(won[0]!.nextRunAt.toISOString()).toBe(due.toISOString());

    const [after] = await db.select().from(skillSchedules).where(eq(skillSchedules.id, row.id));
    // Advanced to the next 07:00 Pacific after the observed time.
    expect(after!.nextRunAt.toISOString()).toBe("2026-09-10T14:00:00.000Z");

    // A third tick finds nothing: the row is no longer due.
    expect((await store.claimDue(now)).find((s) => s.id === row.id)).toBeUndefined();
  });

  it("claimDue skips paused rows and rows not yet due", async () => {
    const now = new Date("2026-09-09T14:00:30Z");
    const paused = await insertSchedule(new Date("2026-09-09T13:00:00Z"), {
      skillSlug: "week-ahead",
      paused: true,
      pausedReason: "user",
    });
    const future = await insertSchedule(new Date("2026-09-09T15:00:00Z"), { skillSlug: "inbox-triage" });
    const store = drizzleScheduleStore(db);
    const claimed = (await store.claimDue(now)).map((s) => s.id);
    expect(claimed).not.toContain(paused.id);
    expect(claimed).not.toContain(future.id);
  });

  it("startRun, finishRun and patchSchedule round-trip the history row and the schedule state", async () => {
    const sched = await insertSchedule(new Date("2026-09-10T14:00:00Z"), { skillSlug: "weekly-capture" });
    const store = drizzleScheduleStore(db);
    const rowId = await store.startRun({
      scheduleId: sched.id,
      userId,
      skillSlug: "weekly-capture",
      runId: "run-abc",
    });
    await store.finishRun(rowId, {
      status: "succeeded",
      threadId: "thread-1",
      toolCalls: { "gws-mcp__gmail_search": 2 },
      toolCallCount: 2,
      delivered: "notification_email",
      error: null,
      finishedAt: new Date("2026-09-10T14:01:00Z"),
    });
    const [run] = await db.select().from(skillRuns).where(eq(skillRuns.id, rowId));
    expect(run).toMatchObject({
      status: "succeeded",
      threadId: "thread-1",
      runId: "run-abc",
      toolCalls: { "gws-mcp__gmail_search": 2 },
      toolCallCount: 2,
      delivered: "notification_email",
      trigger: "scheduled",
    });

    await store.patchSchedule(sched.id, {
      paused: true,
      pausedReason: "failures",
      consecutiveFailures: 3,
      lastRunAt: new Date("2026-09-10T14:00:00Z"),
    });
    const [after] = await db.select().from(skillSchedules).where(eq(skillSchedules.id, sched.id));
    expect(after).toMatchObject({ paused: true, pausedReason: "failures", consecutiveFailures: 3 });
  });
});
