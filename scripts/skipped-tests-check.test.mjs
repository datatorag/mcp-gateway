import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_SKIPS, problemsIn } from "./skipped-tests-check.mjs";

const ROOT = "/repo";
const file = (name, tests) => ({
  name: `${ROOT}/${name}`,
  assertionResults: tests.map(([fullName, status]) => ({ fullName, status })),
});
const EXPECTED = new Map([
  ["apps/gateway/e2e/front.e2e.test.ts", { reason: "needs a running server" }],
  ["apps/gateway/src/registry.test.ts", { within: "(needs the live registry)", reason: "needs the live registry" }],
]);
const healthy = () => [
  file("apps/gateway/src/store.db.test.ts", [["the claim gives each row to one winner", "passed"]]),
  file("apps/gateway/e2e/front.e2e.test.ts", [["front door answers", "skipped"]]),
  file("apps/gateway/src/registry.test.ts", [
    ["the lists agree", "passed"],
    ["snapshot vs registry (needs the live registry) covers every tool", "skipped"],
  ]),
];
const check = (testResults) => problemsIn({ testResults }, EXPECTED, ROOT);

test("passes when every database suite ran and only the listed suites skipped", () => {
  assert.deepEqual(check(healthy()), []);
});

test("fails and names a database suite that skipped", () => {
  const run = healthy();
  run[0] = file("apps/gateway/src/store.db.test.ts", [["the claim gives each row to one winner", "skipped"]]);
  const problems = check(run);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^apps\/gateway\/src\/store\.db\.test\.ts: 1 test\(s\) did not run \(0 of 1 in the file ran\)/);
});

test("fails on one skipped test in a file whose other tests ran", () => {
  const run = healthy();
  run[0] = file("apps/gateway/src/store.db.test.ts", [
    ["a pure helper", "passed"],
    ["real Postgres: the claim", "skipped"],
  ]);
  assert.match(check(run)[0], /store\.db\.test\.ts: 1 test\(s\) did not run \(1 of 2 in the file ran\), first: "real Postgres: the claim"/);
});

test("every status that is not passed or failed counts as not run", () => {
  for (const status of ["skipped", "pending", "todo", "disabled"]) {
    const run = healthy();
    run[0] = file("apps/gateway/src/store.db.test.ts", [["x", status]]);
    assert.equal(check(run).length, 1, status);
  }
});

test("an entry with `within` covers that suite only, not the rest of its file", () => {
  const run = healthy();
  run[2] = file("apps/gateway/src/registry.test.ts", [
    ["the lists agree", "skipped"],
    ["snapshot vs registry (needs the live registry) covers every tool", "skipped"],
  ]);
  const problems = check(run);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /registry\.test\.ts: 1 test\(s\) did not run .*first: "the lists agree"/);
});

test("a listed suite may run: the list permits a skip, it does not demand one", () => {
  const run = healthy();
  run[1] = file("apps/gateway/e2e/front.e2e.test.ts", [["front door answers", "passed"]]);
  assert.deepEqual(check(run), []);
});

test("fails on a listed file the run did not include, so the list cannot rot", () => {
  const problems = check(healthy().slice(0, 2));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^apps\/gateway\/src\/registry\.test\.ts: listed in EXPECTED_SKIPS but not in the run/);
});

test("fails on an empty report and on a file that reported no test", () => {
  assert.equal(check([]).length, 1);
  assert.equal(problemsIn({}, EXPECTED, ROOT).length, 1);
  const run = healthy();
  run[0] = file("apps/gateway/src/store.db.test.ts", []);
  assert.match(check(run)[0], /reported no test at all/);
});

test("only a whole-file entry lets its file report no test", () => {
  const run = healthy();
  run[1] = file("apps/gateway/e2e/front.e2e.test.ts", []);
  assert.deepEqual(check(run), []);
  run[2] = file("apps/gateway/src/registry.test.ts", []);
  assert.match(check(run)[0], /registry\.test\.ts: reported no test at all/);
});

test("the real list: every entry names a file that exists and gives a reason", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  assert.ok(EXPECTED_SKIPS.size > 0);
  for (const [name, entry] of EXPECTED_SKIPS) {
    assert.ok(existsSync(resolve(root, name)), `${name} does not exist`);
    assert.ok(entry.reason && entry.reason.length > 20, `${name} needs a reason`);
  }
});
