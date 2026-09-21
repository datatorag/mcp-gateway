import { REGROUP_PENDING, scenarioOf } from "./scenarios";
import { readdirSync } from "node:fs";
import { isCaseFile } from "./case-arguments";
import { join } from "node:path";
import type { TestCase } from "./types";
import { CASES } from "./cases";
import { ACCOUNT_ROLES, FIXTURE_KEYS } from "./types";

/**
 * The invariants a set of cases must satisfy before a run is worth believing
 * (SCRUM-303). Exported so the test can check the real registry and also
 * feed it deliberately broken sets.
 */

export type RegistryProblem = { caseId: string; problem: string };

/**
 * `D15`, `C1`, `R1`: a section letter, a number, an optional suffix, which
 * is the smoke sheet's own shape. The ported cases keep their sheet ids on
 * purpose, so three years of run logs still resolve.
 *
 * A TWO-LETTER prefix (`GW1`) is a step the regroup added to reach a tool
 * no smoke row ever covered. The shapes are kept distinguishable so nobody
 * reads a new step as a row that exists on the sheet, and so the sheet's
 * one-letter space can never collide with a scenario's series: `GW1` is not
 * `G1`, and neither can be mistyped into the other.
 */
const ID_SHAPE = /^[A-Z]{1,2}[0-9]{1,2}[a-z]?$/;

export function checkRegistry(cases: readonly TestCase[]): RegistryProblem[] {
  const problems: RegistryProblem[] = [];
  const seen = new Set<string>();

  for (const c of cases) {
    if (!ID_SHAPE.test(c.id)) problems.push({ caseId: c.id, problem: "id is not of the form D15 or GW1" });
    if (seen.has(c.id)) problems.push({ caseId: c.id, problem: "duplicate id" });
    seen.add(c.id);

    if (!c.title.trim()) problems.push({ caseId: c.id, problem: "has no title" });
    /* EVERY CASE HAS A HOME. A case in no scenario and not listed as
     * pending would still run under "everything" and be unreachable by any
     * scenario control, which is how a step goes quietly missing during the
     * regroup. Placed and pending are checked against each other in
     * `scenarios.test.ts`; here it is per case, so the problem names the
     * case rather than a set difference. */
    if (!scenarioOf(c.id) && !REGROUP_PENDING.includes(c.id)) {
      problems.push({ caseId: c.id, problem: "belongs to no scenario and is not listed as pending" });
    }
    // `covers` may be EMPTY. A case about the gateway itself (health,
    // tools/list, the front door) exercises no tool, and requiring a
    // declaration there would mean inventing one. What protects coverage is
    // the runtime check in execute.ts, which fails a case whose declaration
    // and whose actual calls disagree IN EITHER DIRECTION.
    for (const role of c.accounts) {
      if (!ACCOUNT_ROLES.includes(role)) problems.push({ caseId: c.id, problem: `unknown account role ${role}` });
    }
    for (const key of c.fixtures ?? []) {
      if (!FIXTURE_KEYS.includes(key)) problems.push({ caseId: c.id, problem: `unknown fixture key ${key}` });
    }
  }

  for (const c of cases) {
    for (const need of c.needs ?? []) {
      if (!seen.has(need)) problems.push({ caseId: c.id, problem: `needs ${need}, which is not registered` });
    }
  }

  return problems;
}

/** Case modules on disk, so a file nobody listed fails instead of silently
 * not running. The barrel is the registry; the directory is the evidence
 * that the barrel is complete. */
export function caseFilesOnDisk(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter(isCaseFile)
      .sort();
  } catch {
    return [];
  }
}

export function registryMatchesDisk(dir: string, cases: readonly TestCase[]): RegistryProblem[] {
  const files = caseFilesOnDisk(dir);
  if (files.length !== cases.length) {
    return [
      {
        caseId: "(registry)",
        problem: `${files.length} case modules on disk but ${cases.length} in the barrel`,
      },
    ];
  }
  return [];
}

export const CASES_DIR = join(import.meta.dirname, "cases");
export { CASES };
