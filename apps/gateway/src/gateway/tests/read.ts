import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { testResults, testRuns } from "@datatorag-mcp/db";
import { diffRuns, type DiffableResult } from "./diff";

/**
 * Reading runs back (SCRUM-303). One module behind both the admin JSON
 * routes and the three MCP tools, so a page and an agent cannot come to
 * describe the same run differently.
 */

/** A page is bounded by count AND by the 4 KB evidence cap, so a caller
 * cannot ask for a response nobody can hold. */
export const RESULTS_PAGE_SIZE = 100;

export type RunStatus = {
  run_id: string;
  status: string;
  environment: string;
  trigger: string;
  imported_from: string | null;
  started_at: string;
  finished_at: string | null;
  gateway_sha: string | null;
  plugin_shas: Record<string, string | null>;
  tools_served: number;
  totals: { pass: number; fail: number; skip: number; uncovered: number };
  done: number;
  /** True when nothing in the run is a failure, a leak or uncovered. Stated
   * once here so the page, the tool and the deploy gate agree on the word. */
  green: boolean;
};

export async function readRunStatus(db: Database, runId: string): Promise<RunStatus | null> {
  if (!isUuid(runId)) return null;
  const [[run], [counts]] = await Promise.all([
    db.select().from(testRuns).where(eq(testRuns.id, runId)).limit(1),
    db.execute<{ done: number; leaked: number }>(sql`
      SELECT count(*)::int AS done,
             count(*) FILTER (WHERE cleanup = 'leaked')::int AS leaked
      FROM test_results WHERE run_id = ${runId}::uuid
    `),
  ]);
  if (!run) return null;

  const totals = run.totals;
  return {
    run_id: run.id,
    status: run.status,
    environment: run.environment,
    trigger: run.trigger,
    imported_from: run.importedFrom,
    started_at: run.startedAt.toISOString(),
    finished_at: run.finishedAt?.toISOString() ?? null,
    gateway_sha: run.gatewaySha,
    plugin_shas: run.pluginShas,
    tools_served: run.toolsServed,
    totals,
    done: counts?.done ?? 0,
    green:
      run.status === "finished" &&
      totals.fail === 0 &&
      totals.uncovered === 0 &&
      (counts?.leaked ?? 0) === 0,
  };
}

export type ResultsPage = {
  run_id: string;
  totals: RunStatus["totals"];
  results: {
    case_id: string;
    kind: string;
    status: string;
    cleanup: string;
    duration_ms: number;
    evidence: string;
  }[];
  next_cursor: string | null;
};

/**
 * Defaults to everything that is NOT a pass, because that is what a person
 * reads a run for; the passes are a number in the totals. Asking for them
 * explicitly still works.
 */
export async function readRunResults(
  db: Database,
  runId: string,
  opts?: { statuses?: string[]; cursor?: string; kinds?: string[] }
): Promise<ResultsPage | null> {
  if (!isUuid(runId)) return null;
  const [run] = await db
    .select({ id: testRuns.id, totals: testRuns.totals })
    .from(testRuns)
    .where(eq(testRuns.id, runId))
    .limit(1);
  if (!run) return null;

  const statuses = opts?.statuses?.length ? opts.statuses : ["fail", "skip", "uncovered"];
  const conditions = [eq(testResults.runId, runId), inArray(testResults.status, statuses as never[])];
  if (opts?.kinds?.length) conditions.push(inArray(testResults.kind, opts.kinds as never[]));
  if (opts?.cursor) conditions.push(gt(testResults.caseId, opts.cursor));

  const rows = await db
    .select()
    .from(testResults)
    .where(and(...conditions))
    .orderBy(asc(testResults.caseId))
    .limit(RESULTS_PAGE_SIZE + 1);

  // The slice is what bounds a page; the query's limit is one more than the
  // page so that "is there another" is answerable without a second count.
  // Mutating the limit alone changes nothing, which is worth knowing before
  // someone "optimises" the slice away.
  const page = rows.slice(0, RESULTS_PAGE_SIZE);
  return {
    run_id: run.id,
    totals: run.totals,
    results: page.map((r) => ({
      case_id: r.caseId,
      kind: r.kind,
      status: r.status,
      cleanup: r.cleanup,
      duration_ms: r.durationMs,
      evidence: r.evidence,
    })),
    next_cursor: rows.length > RESULTS_PAGE_SIZE ? page[page.length - 1].caseId : null,
  };
}

/** Every result of a run, for the export that crosses environments. */
export async function readRunExport(db: Database, runId: string): Promise<DiffableResult[] | null> {
  if (!isUuid(runId)) return null;
  const rows = await db.select().from(testResults).where(eq(testResults.runId, runId));
  return rows.map((r) => ({
    caseId: r.caseId,
    kind: r.kind,
    status: r.status,
    cleanup: r.cleanup,
    durationMs: r.durationMs,
    evidence: r.evidence,
  }));
}

export async function readRunDiff(db: Database, runId: string, againstId: string) {
  const [after, before, runStatus, againstStatus] = await Promise.all([
    readRunExport(db, runId),
    readRunExport(db, againstId),
    readRunStatus(db, runId),
    readRunStatus(db, againstId),
  ]);
  if (!after || !before || !runStatus || !againstStatus) return null;

  const diff = diffRuns(before, after);
  return {
    // Both environments and both sets of shas in the header: a diff across
    // environments is the whole point, and a reader must not have to assume
    // which side is which.
    before: {
      run_id: againstStatus.run_id,
      environment: againstStatus.environment,
      gateway_sha: againstStatus.gateway_sha,
      plugin_shas: againstStatus.plugin_shas,
    },
    after: {
      run_id: runStatus.run_id,
      environment: runStatus.environment,
      gateway_sha: runStatus.gateway_sha,
      plugin_shas: runStatus.plugin_shas,
    },
    regressed: diff.regressed.map(entry),
    fixed: diff.fixed.map(entry),
    added: diff.added.map(entry),
    removed: diff.removed.map(entry),
    changed: diff.changed.map(entry),
    unchanged: diff.unchanged,
    compared: diff.compared,
  };
}

function entry(e: { caseId: string; before: DiffableResult | null; after: DiffableResult | null }) {
  return {
    case_id: e.caseId,
    before: e.before ? { status: e.before.status, cleanup: e.before.cleanup, evidence: e.before.evidence } : null,
    after: e.after ? { status: e.after.status, cleanup: e.after.cleanup, evidence: e.after.evidence } : null,
  };
}

export type RunSummary = Awaited<ReturnType<typeof listRuns>>[number];

export async function listRuns(db: Database, limit = 25) {
  const rows = await db
    .select()
    .from(testRuns)
    .orderBy(sql`${testRuns.startedAt} DESC`)
    .limit(Math.min(Math.max(1, limit), 100));
  return rows.map((r) => ({
    run_id: r.id,
    status: r.status,
    environment: r.environment,
    trigger: r.trigger,
    imported_from: r.importedFrom,
    started_at: r.startedAt.toISOString(),
    finished_at: r.finishedAt?.toISOString() ?? null,
    gateway_sha: r.gatewaySha,
    plugin_shas: r.pluginShas,
    tools_served: r.toolsServed,
    totals: r.totals,
  }));
}

/** A malformed id must read as "no such run", not as a database error: these
 * ids arrive from a URL and from a tool argument. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
