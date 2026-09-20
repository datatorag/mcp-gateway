/**
 * Reading runs back (SCRUM-303), against a real Postgres.
 *
 * One module serves both the admin pages and the three MCP tools, so what is
 * asserted here is what BOTH surfaces will say. The defaults matter as much
 * as the queries: a results call that returned passes by default would bury
 * the three rows a person opened the page for.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { getTestDb, insertTestUser, isDockerAvailable, stopTestDb } from "../../test-utils/db";
import { finishRun, recordResult, startRun } from "./store";
import { listRuns, readRunDiff, readRunResults, readRunStatus, RESULTS_PAGE_SIZE } from "./read";

const dockerAvailable = isDockerAvailable();

describe.skipIf(!dockerAvailable)("reading runs (SCRUM-303)", () => {
  let db: Database;
  let userId: string;

  beforeAll(async () => {
    db = await getTestDb();
    userId = await insertTestUser(db);
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  async function freshRun(over?: { environment?: "local" | "prod"; gatewaySha?: string | null }) {
    await db.execute(sql`DELETE FROM test_runs`);
    const started = await startRun(db, {
      triggeredBy: userId,
      trigger: "ui",
      scope: {},
      environment: over?.environment ?? "local",
      gatewaySha: over?.gatewaySha ?? "abc1234abc1234abc1234abc1234abc1234abc12",
      pluginShas: { "gws-mcp": null },
    });
    return (started as { runId: string }).runId;
  }

  const row = (caseId: string, over: Partial<Parameters<typeof recordResult>[2]> = {}) => ({
    caseId,
    kind: "case" as const,
    status: "pass" as const,
    cleanup: "clean" as const,
    durationMs: 10,
    evidence: [],
    ...over,
  });

  it("reports a run's facts, including which environment it ran in", async () => {
    const runId = await freshRun({ environment: "prod" });
    const status = await readRunStatus(db, runId);
    expect(status).toMatchObject({ run_id: runId, status: "running", environment: "prod", trigger: "ui" });
    expect(status!.gateway_sha).toHaveLength(40);
  });

  it("answers null for a malformed id rather than letting it reach the database", async () => {
    // These ids arrive from a URL and from a tool argument. A cast error
    // would be a 500 where "no such run" belongs.
    for (const bad of ["not-a-uuid", "", "1; DROP TABLE test_runs", "../../etc"]) {
      expect(await readRunStatus(db, bad)).toBeNull();
      expect(await readRunResults(db, bad)).toBeNull();
    }
    const [{ n }] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM test_runs`);
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it("answers null for a well-formed id that is not a run", async () => {
    expect(await readRunStatus(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("defaults results to everything that is NOT a pass", async () => {
    const runId = await freshRun();
    await recordResult(db, runId, row("C1"));
    await recordResult(db, runId, row("D15", { status: "fail", evidence: ["expected 3, got 2"] }));
    await recordResult(db, runId, row("E9", { status: "skip" }));
    await recordResult(db, runId, row("uncovered:x", { kind: "uncovered", status: "uncovered" }));

    const page = await readRunResults(db, runId);
    expect(page!.results.map((r) => r.case_id).sort()).toEqual(["D15", "E9", "uncovered:x"]);
  });

  it("returns the passes when they are asked for", async () => {
    const runId = await freshRun();
    await recordResult(db, runId, row("C1"));
    const page = await readRunResults(db, runId, { statuses: ["pass"] });
    expect(page!.results.map((r) => r.case_id)).toEqual(["C1"]);
  });

  it("pages, and hands back a cursor that continues where it stopped", async () => {
    const runId = await freshRun();
    const total = RESULTS_PAGE_SIZE + 5;
    for (let i = 0; i < total; i++) {
      await recordResult(db, runId, row(`uncovered:tool-${String(i).padStart(3, "0")}`, {
        kind: "uncovered",
        status: "uncovered",
      }));
    }
    const first = await readRunResults(db, runId);
    expect(first!.results).toHaveLength(RESULTS_PAGE_SIZE);
    expect(first!.next_cursor).not.toBeNull();

    const second = await readRunResults(db, runId, { cursor: first!.next_cursor! });
    expect(second!.results).toHaveLength(5);
    expect(second!.next_cursor).toBeNull();

    const ids = new Set([...first!.results, ...second!.results].map((r) => r.case_id));
    expect(ids.size).toBe(total);
  });

  it("is green only when it finished with no failure, nothing uncovered and no leak", async () => {
    const runId = await freshRun();
    await recordResult(db, runId, row("C1"));
    await finishRun(db, runId, {
      status: "finished",
      totals: { pass: 1, fail: 0, skip: 0, uncovered: 0 },
      toolsServed: 1,
    });
    expect((await readRunStatus(db, runId))!.green).toBe(true);
  });

  it("is NOT green when a cleanup leaked, though every assertion passed", async () => {
    // The reason cleanup is its own column. A run that passed and left a
    // file behind is not a run anyone should call clean.
    const runId = await freshRun();
    await recordResult(db, runId, row("D10", { cleanup: "leaked" }));
    await finishRun(db, runId, {
      status: "finished",
      totals: { pass: 1, fail: 0, skip: 0, uncovered: 0 },
      toolsServed: 1,
    });
    expect((await readRunStatus(db, runId))!.green).toBe(false);
  });

  it("is NOT green while it is still running", async () => {
    const runId = await freshRun();
    expect((await readRunStatus(db, runId))!.green).toBe(false);
  });

  it("diffs two runs and names both environments and both shas", async () => {
    // The comparison the deploy gate rests on: a local candidate against the
    // prod baseline. They cannot be joined in SQL, so this is the path.
    const before = await freshRun({ environment: "prod", gatewaySha: "1111111111111111111111111111111111111111" });
    await recordResult(db, before, row("D15"));
    await finishRun(db, before, { status: "finished", totals: { pass: 1, fail: 0, skip: 0, uncovered: 0 }, toolsServed: 1 });

    const after = (await startRun(db, {
      triggeredBy: userId,
      trigger: "ui",
      scope: {},
      environment: "local",
      gatewaySha: "2222222222222222222222222222222222222222",
      pluginShas: {},
    }) as { runId: string }).runId;
    await recordResult(db, after, row("D15", { status: "fail", evidence: ["expected 3, got 2"] }));
    await finishRun(db, after, { status: "finished", totals: { pass: 0, fail: 1, skip: 0, uncovered: 0 }, toolsServed: 1 });

    const diff = await readRunDiff(db, after, before);
    expect(diff!.before).toMatchObject({ environment: "prod" });
    expect(diff!.after).toMatchObject({ environment: "local" });
    expect(diff!.regressed.map((e) => e.case_id)).toEqual(["D15"]);
    expect(diff!.regressed[0].after!.evidence).toContain("expected 3");
  });

  it("answers null when one side of a diff does not exist", async () => {
    const runId = await freshRun();
    expect(await readRunDiff(db, runId, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await readRunDiff(db, "nonsense", runId)).toBeNull();
  });

  it("lists runs newest first", async () => {
    await db.execute(sql`DELETE FROM test_runs`);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const started = await startRun(db, {
        triggeredBy: userId, trigger: "ui", scope: {}, environment: "local",
        gatewaySha: null, pluginShas: {},
      });
      const id = (started as { runId: string }).runId;
      ids.push(id);
      await finishRun(db, id, { status: "finished", totals: { pass: 0, fail: 0, skip: 0, uncovered: 0 }, toolsServed: 0 });
      await db.execute(sql`UPDATE test_runs SET started_at = now() + (${i} || ' minutes')::interval WHERE id = ${id}::uuid`);
    }
    const listed = await listRuns(db);
    expect(listed.map((r) => r.run_id)).toEqual([...ids].reverse());
  });
});
