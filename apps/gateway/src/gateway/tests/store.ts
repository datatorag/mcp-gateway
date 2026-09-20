import { eq, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { testResults, testRuns } from "@datatorag-mcp/db";
import type {
  TestEnvironment,
  TestRunScope,
  TestRunTotals,
  TestRunTrigger,
} from "@datatorag-mcp/db";
import type { CaseCleanup, CaseStatus } from "./runner";
import { formatEvidence } from "./evidence";

/**
 * The run's rows (SCRUM-303).
 *
 * Two claims live here rather than in the runner, because both are about the
 * DATABASE being the arbiter:
 *
 * - ONE RUN AT A TIME, enforced by a PARTIAL UNIQUE INDEX, with the
 *   conditional insert below as the polite path to the same answer. A
 *   process-local flag is not a claim (two processes would each hold their
 *   own), and neither is `WHERE NOT EXISTS` on its own: under READ COMMITTED
 *   it takes no lock on a row that does not exist, so two concurrent callers
 *   can both see "none running" and both insert. The index is what makes the
 *   second one fail; the WHERE clause is what makes the common case answer
 *   with the running run's id instead of an error.
 * - A RUN THAT DIED IS `interrupted`, not `running` forever. A deploy
 *   restarts the process mid-run, and a row left `running` would block every
 *   later run on a claim nobody holds.
 */

export type StartRunInput = {
  triggeredBy: string;
  trigger: TestRunTrigger;
  scope: TestRunScope;
  environment: TestEnvironment;
  gatewaySha: string | null;
  pluginShas: Record<string, string | null>;
};

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

export type StartRunResult =
  | { ok: true; runId: string }
  | { ok: false; reason: "already_running"; runId: string };

/**
 * Claims the single run slot, or reports who holds it.
 *
 * The insert and the check are one statement: a read followed by a write
 * leaves a window in which two callers both read "none running".
 */
export async function startRun(db: Database, input: StartRunInput): Promise<StartRunResult> {
  let inserted: { id: string }[] = [];
  try {
    inserted = await db.execute<{ id: string }>(sql`
      INSERT INTO test_runs (triggered_by, trigger, scope, status, environment, gateway_sha, plugin_shas)
      SELECT ${input.triggeredBy}::uuid, ${input.trigger}, ${JSON.stringify(input.scope)}::jsonb,
             'running', ${input.environment}, ${input.gatewaySha}, ${JSON.stringify(input.pluginShas)}::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM test_runs WHERE status = 'running')
      RETURNING id
    `);
  } catch (err) {
    // The index refusing a genuine race. Not an error to surface: the answer
    // the caller wants is "one is already going, here it is", which is the
    // same answer the WHERE clause gives on the common path.
    if (!isUniqueViolation(err)) throw err;
  }

  if (inserted.length > 0) return { ok: true, runId: inserted[0].id };

  const [running] = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(eq(testRuns.status, "running"))
    .limit(1);
  return { ok: false, reason: "already_running", runId: running?.id ?? "unknown" };
}

export type ResultRow = {
  caseId: string;
  kind: "case" | "contract" | "uncovered";
  status: CaseStatus | "uncovered";
  cleanup: CaseCleanup;
  durationMs: number;
  /** The LINES a case recorded, not a finished string. Capping and scrubbing
   * happen here rather than in every caller, so a case author who writes a
   * result directly cannot store an unscrubbed payload into a table a
   * dashboard page renders. An invariant nobody has to remember. */
  evidence: string[];
};

/** Written as each case finishes, so a poll sees progress rather than
 * nothing until the end. */
export async function recordResult(db: Database, runId: string, row: ResultRow): Promise<void> {
  await db
    .insert(testResults)
    .values({
      runId,
      caseId: row.caseId,
      kind: row.kind,
      status: row.status,
      cleanup: row.cleanup,
      durationMs: row.durationMs,
      evidence: formatEvidence(row.evidence),
    })
    .onConflictDoNothing();
}

export async function finishRun(
  db: Database,
  runId: string,
  finish: { status: "finished" | "aborted"; totals: TestRunTotals; toolsServed: number }
): Promise<void> {
  await db
    .update(testRuns)
    .set({
      status: finish.status,
      totals: finish.totals,
      toolsServed: finish.toolsServed,
      finishedAt: new Date(),
    })
    .where(eq(testRuns.id, runId));
}

/**
 * At boot: any run still `running` died with the process that started it.
 * Returns how many were marked, so the log says something happened.
 *
 * It deliberately does NOT skip imported rows. An imported run is normally
 * stored finished, but one stored `running` would otherwise hold the single
 * slot for ever with nothing able to clear it, since no process owns it to
 * die. Correctness, not security.
 *
 * ASSUMES ONE PROCESS SERVES THIS APP. Under two, a second process booting
 * mid-run would release a live claim. The partial unique index still makes
 * two concurrent runs impossible; this sweep is the part to revisit if the
 * deployment ever grows a second process.
 */
export async function markInterruptedRuns(db: Database): Promise<number> {
  const rows = await db
    .update(testRuns)
    .set({ status: "interrupted", finishedAt: new Date() })
    .where(eq(testRuns.status, "running"))
    .returning({ id: testRuns.id });
  if (rows.length > 0) {
    console.warn(`[test-runner] marked ${rows.length} interrupted run(s) left by a previous process`);
  }
  return rows.length;
}
