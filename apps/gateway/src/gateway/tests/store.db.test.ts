/**
 * The run store against a real Postgres (SCRUM-303), including that a fresh
 * database has the two tables at all.
 *
 * Real Postgres and not a fake, because every claim in this module is a claim
 * about what the DATABASE does: a conditional insert that two callers race
 * on, a cascade, a unique constraint. A stub would confirm the code I wrote
 * rather than the behaviour I need.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { getTestDb, insertTestUser, isDockerAvailable, stopTestDb } from "../../test-utils/db";
import { finishRun, markInterruptedRuns, recordResult, startRun } from "./store";

const dockerAvailable = isDockerAvailable();

describe.skipIf(!dockerAvailable)("test_runs and test_results (SCRUM-303)", () => {
  let db: Database;
  let userId: string;

  beforeAll(async () => {
    db = await getTestDb();
    userId = await insertTestUser(db);
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  const start = () =>
    startRun(db, {
      triggeredBy: userId,
      trigger: "ui",
      scope: { scenario: "gateway" },
      environment: "local",
      gatewaySha: null,
      pluginShas: { "gws-mcp": null },
    });

  async function clearRuns() {
    await db.execute(sql`DELETE FROM test_runs`);
  }

  it("migration 0019 created both tables with the unique constraint", async () => {
    const cols = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('test_runs', 'test_results')
      ORDER BY table_name
    `);
    expect(cols.map((c) => c.table_name)).toEqual(["test_results", "test_runs"]);

    const uq = await db.execute<{ constraint_name: string }>(sql`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'test_results' AND constraint_type = 'UNIQUE'
    `);
    expect(uq.map((u) => u.constraint_name)).toContain("test_results_run_case_uq");
  });

  it("starts a run and records what it ran against", async () => {
    await clearRuns();
    const started = await start();
    expect(started.ok).toBe(true);

    const [row] = await db.execute<{ status: string; environment: string; trigger: string }>(
      sql`SELECT status, environment, trigger FROM test_runs WHERE id = ${(started as { runId: string }).runId}::uuid`
    );
    expect(row).toMatchObject({ status: "running", environment: "local", trigger: "ui" });
  });

  it("REFUSES a second run and names the one already going", async () => {
    await clearRuns();
    const first = await start();
    const second = await start();
    expect(second.ok).toBe(false);
    expect(second).toMatchObject({ reason: "already_running", runId: (first as { runId: string }).runId });
  });

  it("lets a new run start once the first has finished", async () => {
    await clearRuns();
    const first = await start();
    await finishRun(db, (first as { runId: string }).runId, {
      status: "finished",
      totals: { pass: 1, fail: 0, skip: 0, uncovered: 0 },
      toolsServed: 91,
    });
    expect((await start()).ok).toBe(true);
  });

  it("two concurrent starts produce exactly one run", async () => {
    await clearRuns();
    const [a, b] = await Promise.all([start(), start()]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);

    const [{ n }] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM test_runs`);
    expect(n).toBe(1);
  });

  it("the DATABASE refuses a second running row, not just the WHERE clause", async () => {
    // The conditional insert reads as a claim and is not one: WHERE NOT
    // EXISTS takes no lock on a row that does not exist, so two callers can
    // both see "none running". This inserts directly, bypassing that clause
    // entirely, and requires Postgres itself to refuse.
    await clearRuns();
    await start();
    await expect(
      db.execute(sql`
        INSERT INTO test_runs (triggered_by, trigger, scope, status, environment)
        VALUES (${userId}::uuid, 'ui', '{}'::jsonb, 'running', 'local')
      `)
    ).rejects.toThrow();
  });

  it("the index constrains only running rows, so finished runs accumulate freely", async () => {
    await clearRuns();
    for (let i = 0; i < 3; i++) {
      const started = await start();
      await finishRun(db, (started as { runId: string }).runId, {
        status: "finished",
        totals: { pass: 0, fail: 0, skip: 0, uncovered: 0 },
        toolsServed: 0,
      });
    }
    const [{ n }] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM test_runs`);
    expect(n).toBe(3);
  });

  it("marks a run that died as interrupted, so it stops blocking the claim", async () => {
    await clearRuns();
    const first = await start();
    expect((await start()).ok).toBe(false);

    expect(await markInterruptedRuns(db)).toBe(1);
    const [row] = await db.execute<{ status: string; finished_at: string | null }>(
      sql`SELECT status, finished_at FROM test_runs WHERE id = ${(first as { runId: string }).runId}::uuid`
    );
    expect(row.status).toBe("interrupted");
    expect(row.finished_at).not.toBeNull();
    expect((await start()).ok).toBe(true);
  });

  it("marks nothing when no run was left behind", async () => {
    await clearRuns();
    expect(await markInterruptedRuns(db)).toBe(0);
  });

  it("records results and refuses a duplicate case id within a run", async () => {
    await clearRuns();
    const started = await start();
    const runId = (started as { runId: string }).runId;
    const row = {
      caseId: "D15",
      kind: "case" as const,
      status: "pass" as const,
      cleanup: "clean" as const,
      durationMs: 42,
      evidence: ["expected 3 ranges, got 3"],
    };
    await recordResult(db, runId, row);
    await recordResult(db, runId, { ...row, evidence: ["a second write"] });

    const rows = await db.execute<{ evidence: string }>(
      sql`SELECT evidence FROM test_results WHERE run_id = ${runId}::uuid AND case_id = 'D15'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].evidence).toBe("expected 3 ranges, got 3");
  });

  it("scrubs and caps evidence on the way IN, not in the caller", async () => {
    // The invariant made structural: a case author writing a result directly
    // cannot store an unscrubbed payload into a table a dashboard renders.
    await clearRuns();
    const started = await start();
    const runId = (started as { runId: string }).runId;
    await recordResult(db, runId, {
      caseId: "D9",
      kind: "case",
      status: "fail",
      cleanup: "none_needed",
      durationMs: 1,
      evidence: ["created file Ab3xYz9Qw7Lm2Kp5Rt8Nv1 in the fixture folder"],
    });
    const [stored] = await db.execute<{ evidence: string }>(
      sql`SELECT evidence FROM test_results WHERE run_id = ${runId}::uuid AND case_id = 'D9'`
    );
    expect(stored.evidence).not.toContain("Ab3xYz9Qw7Lm2Kp5Rt8Nv1");
    expect(stored.evidence).toContain("[redacted-id]");
  });

  it("caps a long evidence block on the way in", async () => {
    await clearRuns();
    const started = await start();
    const runId = (started as { runId: string }).runId;
    await recordResult(db, runId, {
      caseId: "D8",
      kind: "case",
      status: "fail",
      cleanup: "none_needed",
      durationMs: 1,
      evidence: Array.from({ length: 400 }, (_, i) => `step ${i}: expected 3 ranges, got 3`),
    });
    const [stored] = await db.execute<{ evidence: string }>(
      sql`SELECT evidence FROM test_results WHERE run_id = ${runId}::uuid AND case_id = 'D8'`
    );
    expect(stored.evidence.length).toBeLessThanOrEqual(4096);
  });

  it("deletes a run's results with the run", async () => {
    await clearRuns();
    const started = await start();
    const runId = (started as { runId: string }).runId;
    await recordResult(db, runId, {
      caseId: "C1",
      kind: "case",
      status: "pass",
      cleanup: "none_needed",
      durationMs: 1,
      evidence: [],
    });
    await db.execute(sql`DELETE FROM test_runs WHERE id = ${runId}::uuid`);
    const [{ n }] = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM test_results WHERE run_id = ${runId}::uuid`
    );
    expect(n).toBe(0);
  });
});
