import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { testResults, testRuns } from "@datatorag-mcp/db";
import { CASES } from "@/gateway/tests/cases";
import { scenarioOf } from "@/gateway/tests/scenarios";
import { PUBLIC_TITLES } from "./public-titles";
import { SURFACES, bareToolName, isPublicTool, surfaceOfTool, type SurfaceKey } from "./surfaces";

/**
 * The public status page's read model (SCRUM-431): a view of the newest
 * full, finished prod test run and the 30 days before it.
 *
 * WHAT IS READ IS WHAT MAY BE SHOWN. The selects below name only the columns
 * the page renders. `evidence` and `triggered_by` are never read, so they
 * cannot reach the page by mistake; `read-model.test.ts` reads the SQL these
 * build and holds it to that.
 *
 * WHICH RUN. Prod, finished, not imported, and FULL SCOPE. A scoped rerun of
 * one case is often the newest finished prod run, and a page built from it
 * would show one case.
 */

export const STRIP_DAYS = 30;

/** The run columns the page may show. */
export function latestRunQuery(db: Database) {
  return db
    .select({
      id: testRuns.id,
      startedAt: testRuns.startedAt,
      finishedAt: testRuns.finishedAt,
      gatewaySha: testRuns.gatewaySha,
      pluginShas: testRuns.pluginShas,
    })
    .from(testRuns)
    .where(fullProdRun())
    .orderBy(desc(testRuns.startedAt))
    .limit(1);
}

function fullProdRun() {
  return and(
    eq(testRuns.environment, "prod"),
    eq(testRuns.status, "finished"),
    isNull(testRuns.importedFrom),
    sql`${testRuns.scope} = '{}'::jsonb`
  );
}

/** The result columns the page may show. */
export function resultsQuery(db: Database, runIds: string[]) {
  return db
    .select({
      runId: testResults.runId,
      caseId: testResults.caseId,
      kind: testResults.kind,
      status: testResults.status,
      durationMs: testResults.durationMs,
      cleanup: testResults.cleanup,
    })
    .from(testResults)
    .where(inArray(testResults.runId, runIds));
}

export function stripRunsQuery(db: Database, since: Date) {
  return db
    .select({ id: testRuns.id, startedAt: testRuns.startedAt })
    .from(testRuns)
    .where(and(fullProdRun(), gte(testRuns.startedAt, since)))
    .orderBy(desc(testRuns.startedAt));
}

export type RunRow = Awaited<ReturnType<typeof latestRunQuery>>[number];
export type ResultRow = Awaited<ReturnType<typeof resultsQuery>>[number];

export type CaseState = "working" | "failing" | "not_run";
export type ToolState = "working" | "failing" | "not_exercised" | "not_run";
export type DayState = "pass" | "fail" | "none";

export interface StatusModel {
  run: {
    id: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    gatewaySha: string | null;
    pluginShas: { name: string; sha: string | null }[];
    leftResidue: boolean;
  };
  counts: {
    cases: { working: number; failing: number; notRun: number };
    tools: { working: number; failing: number; notExercised: number; notRun: number };
    retired: number;
  };
  surfaces: {
    key: SurfaceKey;
    name: string;
    state: CaseState;
    cases: { id: string; title: string; state: CaseState; durationMs: number }[];
    tools: { name: string; state: ToolState }[];
    strip: { day: string; state: DayState }[];
  }[];
}

const CATALOG = new Map(CASES.map((c) => [c.id, c]));

/** The runner's preflight gate (the front door answers and lists its
 * tools). It is recorded as a case row on every run but is not a registered
 * case, so it is placed here by name, under Platform. */
export const GATE_CASE_ID = "A0";

/** The surface a result row of kind `case` belongs to, or undefined for a
 * case retired since the run. */
function surfaceOfCase(caseId: string): SurfaceKey | undefined {
  if (caseId === GATE_CASE_ID) return "gateway";
  return CATALOG.has(caseId) ? (scenarioOf(caseId)?.key as SurfaceKey | undefined) : undefined;
}

/** What a reader of a status page looks for first: failures, then what did
 * not run, then the rest, each group in title order. */
const RANK: Record<CaseState | ToolState, number> = { failing: 0, not_run: 1, not_exercised: 2, working: 3 };

function caseState(status: string): CaseState {
  return status === "pass" ? "working" : status === "fail" ? "failing" : "not_run";
}

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : null);
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** The days of the strip, oldest first, ending on `now`'s UTC day. */
export function stripDays(now: Date): string[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: STRIP_DAYS }, (_, i) => utcDay(new Date(end - (STRIP_DAYS - 1 - i) * 86_400_000)));
}

/**
 * The model, from rows already read. Pure, so the shape of the page can be
 * tested without a database.
 *
 * `history` holds, per strip run, its start and its case results; the
 * newest run of each UTC day decides that day.
 */
export function buildStatusModel(
  run: RunRow,
  results: Omit<ResultRow, "runId">[],
  history: { startedAt: Date; results: { caseId: string; kind: string; status: string }[] }[],
  now: Date
): StatusModel {
  const cases = results.filter((r) => r.kind === "case");
  const known = cases.filter((r) => surfaceOfCase(r.caseId) !== undefined);
  const retired = cases.length - known.length;

  // Per tool: the contract probe's verdict, or "uncovered".
  const probe = new Map<string, string>();
  for (const r of results) {
    if (r.kind === "contract" || r.kind === "uncovered") {
      const name = r.caseId.slice(r.caseId.indexOf(":") + 1);
      if (isPublicTool(name)) probe.set(name, r.kind === "uncovered" ? "uncovered" : r.status);
    }
  }
  // Per tool: the states of the cases in this run that cover it.
  const coveringStates = new Map<string, CaseState[]>();
  for (const r of known) {
    for (const tool of CATALOG.get(r.caseId)?.covers ?? []) {
      coveringStates.set(tool, [...(coveringStates.get(tool) ?? []), caseState(r.status)]);
    }
  }
  const toolState = (name: string): ToolState => {
    const p = probe.get(name);
    if (p === "uncovered") return "not_exercised";
    const states = coveringStates.get(name) ?? [];
    if (p === "fail" || states.includes("failing")) return "failing";
    if (states.length > 0 && states.every((s) => s === "not_run")) return "not_run";
    return "working";
  };

  // The strip: the newest run of each day decides it.
  const byDay = new Map<string, (typeof history)[number]>();
  for (const h of history) {
    const day = utcDay(h.startedAt);
    const held = byDay.get(day);
    if (!held || held.startedAt < h.startedAt) byDay.set(day, h);
  }
  const days = stripDays(now);

  const surfaces = SURFACES.map(({ key, name }) => {
    const mine = known
      .filter((r) => surfaceOfCase(r.caseId) === key)
      .map((r) => ({ id: r.caseId, title: PUBLIC_TITLES[r.caseId] ?? CATALOG.get(r.caseId)?.title ?? r.caseId, state: caseState(r.status), durationMs: r.durationMs }))
      .sort((a, b) => RANK[a.state] - RANK[b.state] || a.title.localeCompare(b.title));
    const tools = [...probe.keys()]
      .filter((t) => surfaceOfTool(t) === key)
      .map((t) => ({ name: bareToolName(t), state: toolState(t) }))
      .sort((a, b) => RANK[a.state] - RANK[b.state] || a.name.localeCompare(b.name));
    const failing = mine.some((c) => c.state === "failing") || tools.some((t) => t.state === "failing");
    const working = mine.some((c) => c.state === "working");
    const strip = days.map((day) => {
      const h = byDay.get(day);
      if (!h) return { day, state: "none" as DayState };
      const own = h.results.filter((r) => r.kind === "case" && surfaceOfCase(r.caseId) === key);
      if (own.some((r) => r.status === "fail")) return { day, state: "fail" as DayState };
      if (own.some((r) => r.status === "pass")) return { day, state: "pass" as DayState };
      return { day, state: "none" as DayState };
    });
    return { key, name, state: (failing ? "failing" : working ? "working" : "not_run") as CaseState, cases: mine, tools, strip };
  }).filter((s) => s.cases.length > 0 || s.tools.length > 0);

  const allCases = surfaces.flatMap((s) => s.cases);
  const allTools = surfaces.flatMap((s) => s.tools);
  const started = run.startedAt;
  const finished = run.finishedAt ?? run.startedAt;
  return {
    run: {
      id: run.id,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - started.getTime()),
      gatewaySha: short(run.gatewaySha),
      pluginShas: Object.entries(run.pluginShas ?? {})
        .map(([name, sha]) => ({ name, sha: short(sha) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      leftResidue: results.some((r) => r.cleanup === "leaked"),
    },
    counts: {
      cases: {
        working: allCases.filter((c) => c.state === "working").length,
        failing: allCases.filter((c) => c.state === "failing").length,
        notRun: allCases.filter((c) => c.state === "not_run").length,
      },
      tools: {
        working: allTools.filter((t) => t.state === "working").length,
        failing: allTools.filter((t) => t.state === "failing").length,
        notExercised: allTools.filter((t) => t.state === "not_exercised").length,
        notRun: allTools.filter((t) => t.state === "not_run").length,
      },
      retired,
    },
    surfaces,
  };
}

/** The model is rebuilt only when a newer qualifying run appears. */
const CACHE = Symbol.for("datatorag.statusModel");
type Cache = { runId: string | null; model: StatusModel | null; builtFor: string | null };
const cache: Cache = ((globalThis as Record<symbol, unknown>)[CACHE] as Cache | undefined) ??
  ((globalThis as Record<symbol, unknown>)[CACHE] = { runId: null, model: null, builtFor: null } as Cache);

/** Builds counted, for the test that a second request builds nothing. */
export let statusModelBuilds = 0;

export async function getStatusModel(db: Database, now: Date = new Date()): Promise<StatusModel | null> {
  const [run] = await latestRunQuery(db);
  if (!run) return null;
  // The strip's day boundary moves at midnight UTC, so the cache key is the
  // run and the day.
  const key = `${run.id}:${utcDay(now)}`;
  if (cache.builtFor === key && cache.model) return cache.model;

  const since = new Date(Date.parse(`${stripDays(now)[0]}T00:00:00Z`));
  const stripRuns = await stripRunsQuery(db, since);
  const ids = [...new Set([run.id, ...stripRuns.map((r) => r.id)])];
  const rows = await resultsQuery(db, ids);
  const ofRun = (id: string) => rows.filter((r) => r.runId === id);
  const model = buildStatusModel(
    run,
    ofRun(run.id),
    stripRuns.map((r) => ({ startedAt: r.startedAt, results: ofRun(r.id) })),
    now
  );
  statusModelBuilds++;
  cache.runId = run.id;
  cache.model = model;
  cache.builtFor = key;
  return model;
}

/** True when the run finished more than 36 hours before `now`. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
export function isStale(model: StatusModel, now: Date): boolean {
  return now.getTime() - Date.parse(model.run.finishedAt) > STALE_AFTER_MS;
}
