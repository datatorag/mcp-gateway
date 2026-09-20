import type { TestCleanup, TestResultKind, TestResultStatus } from "@datatorag-mcp/db";

/**
 * Comparing two runs (SCRUM-303).
 *
 * A pure function over two result sets rather than a SQL join, and that is
 * not an aesthetic choice: the comparison the deploy gate rests on is a
 * LOCAL run against the PROD baseline, and those live in different
 * databases. One side arrives as exported data.
 *
 * Duration changes are reported and never counted as a regression. A case
 * that got slower is worth seeing and is not a failure, and folding the two
 * together would make every noisy run look broken.
 */

export type DiffableResult = {
  caseId: string;
  kind: TestResultKind;
  status: TestResultStatus;
  cleanup: TestCleanup;
  durationMs: number;
  evidence: string;
};

export type DiffEntry = {
  caseId: string;
  before: DiffableResult | null;
  after: DiffableResult | null;
};

export type RunDiff = {
  /** Passed before, anything else now. The list a deploy gate reads. */
  regressed: DiffEntry[];
  /** Anything else before, passing now. */
  fixed: DiffEntry[];
  /** Present only in the newer run. */
  added: DiffEntry[];
  /** Present only in the older run. */
  removed: DiffEntry[];
  /** Changed in some other way (skip to uncovered, cleanup clean to leaked). */
  changed: DiffEntry[];
  /** Same status both sides. Counted, not listed. */
  unchanged: number;
  /** Ids present in both runs, so a scoped run can say what it left out. */
  compared: number;
};

function green(result: DiffableResult): boolean {
  return result.status === "pass" && result.cleanup !== "leaked";
}

export function diffRuns(
  before: readonly DiffableResult[],
  after: readonly DiffableResult[]
): RunDiff {
  const byIdBefore = new Map(before.map((r) => [r.caseId, r]));
  const byIdAfter = new Map(after.map((r) => [r.caseId, r]));

  const diff: RunDiff = {
    regressed: [],
    fixed: [],
    added: [],
    removed: [],
    changed: [],
    unchanged: 0,
    compared: 0,
  };

  for (const [caseId, a] of byIdAfter) {
    const b = byIdBefore.get(caseId);
    if (!b) {
      diff.added.push({ caseId, before: null, after: a });
      continue;
    }
    diff.compared += 1;
    const entry = { caseId, before: b, after: a };
    if (green(b) && !green(a)) diff.regressed.push(entry);
    else if (!green(b) && green(a)) diff.fixed.push(entry);
    else if (b.status !== a.status || b.cleanup !== a.cleanup) diff.changed.push(entry);
    else diff.unchanged += 1;
  }

  for (const [caseId, b] of byIdBefore) {
    if (!byIdAfter.has(caseId)) diff.removed.push({ caseId, before: b, after: null });
  }

  return diff;
}

/** The one question a deploy asks of a diff. */
export function hasRegression(diff: RunDiff): boolean {
  return diff.regressed.length > 0;
}
