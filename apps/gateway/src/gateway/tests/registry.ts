import { readdirSync } from "node:fs";
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

/** `D15`, `C1`, `R1`: a section letter, a number, an optional suffix. */
const ID_SHAPE = /^[A-Z][0-9]{1,2}[a-z]?$/;

export function checkRegistry(cases: readonly TestCase[]): RegistryProblem[] {
  const problems: RegistryProblem[] = [];
  const seen = new Set<string>();

  for (const c of cases) {
    if (!ID_SHAPE.test(c.id)) problems.push({ caseId: c.id, problem: "id is not of the form D15" });
    if (seen.has(c.id)) problems.push({ caseId: c.id, problem: "duplicate id" });
    seen.add(c.id);

    if (!c.title.trim()) problems.push({ caseId: c.id, problem: "has no title" });
    if (c.tier !== 1 && c.tier !== 2) problems.push({ caseId: c.id, problem: "tier must be 1 or 2" });
    if (c.covers.length === 0) problems.push({ caseId: c.id, problem: "declares no tools in covers" });
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
      .filter((f) => f.endsWith(".ts") && f !== "index.ts" && !f.endsWith(".test.ts"))
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
