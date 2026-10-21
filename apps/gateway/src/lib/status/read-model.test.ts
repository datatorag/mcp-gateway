import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Database } from "@datatorag-mcp/db";
import {
  buildStatusModel,
  getStatusModel,
  isStale,
  latestRunQuery,
  resultsQuery,
  stripDays,
  stripRunsQuery,
  type ResultRow,
  type RunRow,
} from "./read-model";
import * as readModel from "./read-model";

/** A drizzle that builds SQL and has no connection: the query is read, not run. */
const sqlOnly = () => drizzle.mock() as unknown as Database;

const NOW = new Date("2026-10-21T15:00:00Z");
const RUN: RunRow = {
  id: "11111111-1111-4111-8111-111111111111",
  startedAt: new Date("2026-10-21T09:00:00Z"),
  finishedAt: new Date("2026-10-21T09:12:30Z"),
  gatewaySha: "abcdef0123456789",
  pluginShas: { "gws-mcp": "0123456789abcdef", "atlassian-mcp": null },
};
type Row = Omit<ResultRow, "runId">;
const row = (caseId: string, kind: string, status: string, extra: Partial<{ durationMs: number; cleanup: string }> = {}): Row =>
  ({
    caseId,
    kind,
    status,
    durationMs: extra.durationMs ?? 1200,
    cleanup: extra.cleanup ?? "clean",
  }) as Row;

describe("what the page reads (SCRUM-431)", () => {
  it("takes the newest prod run that finished, was not imported, and ran in full", () => {
    const { sql } = latestRunQuery(sqlOnly()).toSQL();
    expect(sql).toMatch(/"test_runs"\."environment" = \$\d/);
    expect(sql).toMatch(/"test_runs"\."status" = \$\d/);
    expect(sql).toMatch(/"test_runs"\."imported_from" is null/);
    expect(sql).toMatch(/"test_runs"\."scope" = '\{\}'::jsonb/);
    expect(sql).toMatch(/order by "test_runs"\."started_at" desc limit \$\d/);
    expect(latestRunQuery(sqlOnly()).toSQL().params.slice(0, 2)).toEqual(["prod", "finished"]);
  });

  it("holds the strip to the same runs", () => {
    const { sql } = stripRunsQuery(sqlOnly(), new Date()).toSQL();
    expect(sql).toMatch(/"test_runs"\."scope" = '\{\}'::jsonb/);
    expect(sql).toMatch(/"test_runs"\."imported_from" is null/);
  });

  it("never reads evidence or who started the run", () => {
    for (const q of [latestRunQuery(sqlOnly()), resultsQuery(sqlOnly(), [RUN.id]), stripRunsQuery(sqlOnly(), new Date())]) {
      const { sql } = q.toSQL();
      expect(sql).not.toMatch(/evidence/);
      expect(sql).not.toMatch(/triggered_by/);
    }
  });
});

describe("the model", () => {
  const results = [
    row("A0", "case", "pass"), // the runner's gate: Platform, not retired
    row("D10", "case", "pass", { durationMs: 4100 }),
    row("GM8", "case", "fail"),
    row("CA5", "case", "skip"),
    row("ZZ99", "case", "pass"), // retired since the run
    row("contract:gws-mcp__gmail_send", "contract", "pass"),
    row("contract:gws-mcp__gmail_mark_spam", "contract", "pass"),
    row("contract:gws-mcp__calendar_respond_to_event", "contract", "pass"),
    row("uncovered:gws-mcp__tasks_create_tasklist", "uncovered", "uncovered"),
    row("uncovered:tests_run", "uncovered", "uncovered"),
    row("contract:gws-mcp__gws_run", "contract", "pass"),
  ];
  const model = buildStatusModel(RUN, results, [], NOW);
  const surface = (key: string) => model.surfaces.find((s) => s.key === key)!;

  it("groups cases under their scenario's surface, with states in words", () => {
    expect(surface("gmail").cases.map((c) => [c.id, c.state])).toEqual(
      expect.arrayContaining([["D10", "working"], ["GM8", "failing"]])
    );
    expect(surface("calendar").cases.map((c) => [c.id, c.state])).toEqual([["CA5", "not_run"]]);
    expect(surface("gmail").state).toBe("failing");
  });

  it("places the runner's gate row under Platform", () => {
    expect(surface("gateway").cases.map((c) => c.id)).toEqual(["A0"]);
  });

  it("lists failures first, then what did not run, then the rest", () => {
    expect(surface("gmail").cases.map((c) => c.state)[0]).toBe("failing");
    const order = model.surfaces.flatMap((s) => s.tools.map((t) => t.state));
    const rank = { failing: 0, not_run: 1, not_exercised: 2, working: 3 } as const;
    for (const s of model.surfaces) {
      const ranks = s.tools.map((t) => rank[t.state]);
      expect(ranks, s.key).toEqual([...ranks].sort((a, b) => a - b));
    }
    expect(order.length).toBeGreaterThan(0);
  });

  it("counts a retired case but lists it nowhere", () => {
    expect(model.counts.retired).toBe(1);
    expect(model.surfaces.flatMap((s) => s.cases).map((c) => c.id)).not.toContain("ZZ99");
  });

  it("states each tool from its probe and the cases covering it", () => {
    const tools = Object.fromEntries(model.surfaces.flatMap((s) => s.tools).map((t) => [t.name, t.state]));
    expect(tools.gmail_send).toBe("working"); // probe passed, D10 covers it and passed
    expect(tools.gmail_mark_spam).toBe("failing"); // GM8 covers it and failed
    expect(tools.calendar_respond_to_event).toBe("not_run"); // CA5, its only case, was skipped
    expect(tools.tasks_create_tasklist).toBe("not_exercised");
  });

  it("leaves the runner's admin-only tools and gws_run out of every list and count", () => {
    const names = model.surfaces.flatMap((s) => s.tools).map((t) => t.name);
    expect(names).not.toContain("tests_run");
    expect(names).not.toContain("gws_run");
    expect(model.counts.tools).toEqual({ working: 1, failing: 1, notExercised: 1, notRun: 1 });
  });

  it("counts cases by kind from the rows, not from the run's totals", () => {
    expect(model.counts.cases).toEqual({ working: 2, failing: 1, notRun: 1 });
  });

  it("shortens shas and reports cleanup", () => {
    expect(model.run.gatewaySha).toBe("abcdef0");
    expect(model.run.pluginShas).toEqual([
      { name: "atlassian-mcp", sha: null },
      { name: "gws-mcp", sha: "0123456"  },
    ]);
    expect(model.run.leftResidue).toBe(false);
    expect(buildStatusModel(RUN, [row("D10", "case", "pass", { cleanup: "leaked" })], [], NOW).run.leftResidue).toBe(true);
  });

  it("carries nothing it was not asked for, even when a row holds more", () => {
    const leaky = { ...row("D10", "case", "fail"), evidence: "boom someone@example.com 0000fake0000id00", runId: RUN.id };
    const text = JSON.stringify(buildStatusModel(RUN, [leaky], [], NOW));
    expect(text).not.toContain("someone@example.com");
    expect(text).not.toContain("0000fake0000id00");
    expect(text).not.toContain("boom");
  });
});

describe("the 30-day strip", () => {
  const day = (iso: string, results: { caseId: string; kind: string; status: string }[]) => ({ startedAt: new Date(iso), results });

  it("covers 30 UTC days ending today", () => {
    const days = stripDays(NOW);
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toBe("2026-10-21");
    expect(days[0]).toBe("2026-09-22");
  });

  it("is red on a failing day, grey on a day with no full run, and the day's newest run decides", () => {
    const model = buildStatusModel(
      RUN,
      [row("D10", "case", "pass")],
      [
        day("2026-10-21T09:00:00Z", [{ caseId: "D10", kind: "case", status: "pass" }]),
        day("2026-10-20T08:00:00Z", [{ caseId: "D10", kind: "case", status: "pass" }]),
        day("2026-10-20T20:00:00Z", [{ caseId: "GM8", kind: "case", status: "fail" }]),
        day("2026-10-19T09:00:00Z", [{ caseId: "GM8", kind: "case", status: "fail" }]),
        day("2026-10-19T18:00:00Z", [{ caseId: "GM8", kind: "case", status: "pass" }]),
      ],
      NOW
    );
    const strip = Object.fromEntries(model.surfaces.find((s) => s.key === "gmail")!.strip.map((d) => [d.day, d.state]));
    expect(strip["2026-10-21"]).toBe("pass");
    expect(strip["2026-10-20"]).toBe("fail"); // the 20:00 run is the newest that day
    expect(strip["2026-10-19"]).toBe("pass"); // the 18:00 run is the newest that day
    expect(strip["2026-10-18"]).toBe("none");
  });
});

describe("staleness", () => {
  const model = buildStatusModel(RUN, [row("D10", "case", "pass")], [], NOW);
  it("is stale past 36 hours after the run finished, and not before", () => {
    expect(isStale(model, new Date(RUN.finishedAt!.getTime() + 35 * 3600_000))).toBe(false);
    expect(isStale(model, new Date(RUN.finishedAt!.getTime() + 37 * 3600_000))).toBe(true);
  });
});

describe("the cache", () => {
  /** Answers each query by the columns it selects, and counts the reads. */
  function fakeDb() {
    const reads = { latest: 0, strip: 0, results: 0 };
    const chain = (fields: Record<string, unknown>) => {
      const kind = "finishedAt" in fields ? "latest" : "caseId" in fields ? "results" : "strip";
      const value =
        kind === "latest" ? [RUN] : kind === "strip" ? [{ id: RUN.id, startedAt: RUN.startedAt }] : [{ runId: RUN.id, ...row("D10", "case", "pass") }];
      const c: Record<string, unknown> = {};
      for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
      c.then = (resolve: (v: unknown) => void) => {
        reads[kind]++;
        resolve(value);
      };
      return c;
    };
    return { db: { select: (fields: Record<string, unknown>) => chain(fields) } as unknown as Database, reads };
  }

  it("builds once per run and day: a second request reads only the newest run", async () => {
    const { db, reads } = fakeDb();
    const before = readModel.statusModelBuilds;
    await getStatusModel(db, NOW);
    await getStatusModel(db, NOW);
    expect(readModel.statusModelBuilds - before).toBe(1);
    expect(reads).toEqual({ latest: 2, strip: 1, results: 1 });
  });

  it("answers null, and builds nothing, when no full prod run exists", async () => {
    const db = { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }) } as unknown as Database;
    expect(await getStatusModel(db, NOW)).toBeNull();
  });
});
