#!/usr/bin/env node
/**
 * A gateway test that did not run fails the gate, unless it is named here.
 *
 * Skipped is not passed. The database-backed suites start their own Postgres
 * in Docker, and with no Docker daemon about thirty files used to report
 * skipped while the gate printed ok. The gate now sets GATE_REQUIRE_DB=1, so
 * those suites fail with the cause (apps/gateway/src/test-utils/db.ts). This
 * check is the net under that, for every other way a test can go quiet: it
 * reads the machine-readable report of the run the gate just did and fails
 * on any test that did not run and is not covered by EXPECTED_SKIPS.
 *
 * There is no count to bump. A new suite that skips is not on the list, so
 * it fails here until someone adds it with the reason, in review.
 *
 *   node scripts/skipped-tests-check.mjs <vitest json report>
 *   exit 0 clean, 1 with the tests that did not run
 */

import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The tests that skip in a healthy gate run. Key: the test file, from the
 * repo root. `within`: when set, only tests whose full name contains it may
 * skip, so the entry covers one suite and not the rest of its file. An entry
 * with no `within` covers its whole file, a file that reports no test included.
 */
export const EXPECTED_SKIPS = new Map([
  [
    "apps/gateway/e2e/mcp.e2e.test.ts",
    { reason: "Needs a running gateway to call, named by MCP_E2E_URL. The gate starts no server." },
  ],
  [
    "apps/gateway/e2e/admin-404.e2e.test.ts",
    { reason: "Needs a running production build, named by ADMIN_E2E_URL, and two session cookies. The gate starts no server." },
  ],
  [
    "apps/gateway/e2e/playground-persistence.e2e.test.ts",
    { reason: "Needs a migrated database named by PLAYGROUND_PERSISTENCE_URL. It is run by hand against a scratch branch." },
  ],
  [
    "apps/gateway/src/gateway/playground/registry-ground-truth.test.ts",
    {
      reason:
        "Compares the registry with running plugins, named by PLUGIN_MCP_URLS. The gate starts no plugin, and with " +
        "none named the file has no test to report at all.",
    },
  ],
  [
    "apps/gateway/src/lib/skills.boundary.test.ts",
    {
      within: "(SKILLS_DENYLIST)",
      reason: "Reads a private list of terms from the file SKILLS_DENYLIST names. The list is not in this repo, so CI has none.",
    },
  ],
  [
    "apps/gateway/src/gateway/tests/no-fixture-values.test.ts",
    {
      within: "contains no address, user id or file id from the fixture mapping",
      reason: "Searches the source for the values in TEST_RUNNER_FIXTURES. CI and a fresh checkout have no mapping to search for.",
    },
  ],
  [
    "apps/gateway/src/gateway/playground/tool-classification.test.ts",
    {
      within: "(needs LIVE_REGISTRY_DATABASE_URL)",
      reason: "Reads the live tools registry. Runs only where that variable names it, which CI and a fresh checkout do not.",
    },
  ],
  [
    "apps/gateway/src/gateway/tests/case-arguments.test.ts",
    {
      within: "(needs LIVE_REGISTRY_DATABASE_URL)",
      reason: "Reads the live tools registry. Runs only where that variable names it, which CI and a fresh checkout do not.",
    },
  ],
]);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What is wrong with a vitest JSON report, as lines to print. Empty is clean.
 * `expected` and `root` are arguments so a test can hand in its own.
 */
export function problemsIn(report, expected = EXPECTED_SKIPS, root = REPO_ROOT) {
  const files = report?.testResults;
  if (!Array.isArray(files) || files.length === 0) {
    return ["the report names no test file, so nothing shows that any test ran"];
  }
  const problems = [];
  const seen = new Set();
  for (const file of files) {
    const name = relative(root, file.name);
    seen.add(name);
    const entry = expected.get(name);
    const tests = file.assertionResults ?? [];
    if (tests.length === 0 && !(entry && !entry.within)) problems.push(`${name}: reported no test at all`);
    const quiet = tests.filter(
      (t) => t.status !== "passed" && t.status !== "failed" && !(entry && (!entry.within || t.fullName.includes(entry.within)))
    );
    if (quiet.length === 0) continue;
    const ran = tests.length - tests.filter((t) => t.status !== "passed" && t.status !== "failed").length;
    problems.push(
      `${name}: ${quiet.length} test(s) did not run (${ran} of ${tests.length} in the file ran), first: "${quiet[0].fullName}"` +
        (entry ? `. Its entry covers only "${entry.within}"` : "")
    );
  }
  for (const name of expected.keys()) {
    if (!seen.has(name)) problems.push(`${name}: listed in EXPECTED_SKIPS but not in the run. Moved or deleted? Fix the entry`);
  }
  return problems;
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.log("skipped-tests-check: FAILED. Usage: node scripts/skipped-tests-check.mjs <vitest json report>");
    process.exit(1);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.log(`skipped-tests-check: FAILED. Cannot read the test report at ${path}: ${err.message}`);
    process.exit(1);
  }
  const problems = problemsIn(report);
  if (problems.length === 0) {
    console.log(
      `skipped-tests-check: ok. ${report.testResults.length} test files; the only tests that did not run are the ` +
        `${EXPECTED_SKIPS.size} suites named in EXPECTED_SKIPS.`
    );
    return;
  }
  for (const line of problems) console.log(line);
  console.log(
    `skipped-tests-check: FAILED. ${problems.length} problem(s). Skipped is not passed. A suite that needs something ` +
      "the machine lacks must say what (a database suite needs Docker: start it and run the gate again). A suite that " +
      "is meant to skip in the gate goes in EXPECTED_SKIPS in scripts/skipped-tests-check.mjs, with the reason."
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
