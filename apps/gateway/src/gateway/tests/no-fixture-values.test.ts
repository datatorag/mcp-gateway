/**
 * NO CONFIGURED FIXTURE VALUE MAY APPEAR IN THIS TREE (SCRUM-303).
 *
 * Written because it happened. The real production fixture sheet id was
 * committed into `evidence.test.ts`, as the example of "an id that must
 * still be redacted" — the one file in the batch whose entire subject is
 * not leaking ids. It reached two commits and was caught by the security
 * gate, not by anything here.
 *
 * Every other guard in this suite is about what a CASE does at run time.
 * This one is about the source, which is the thing that actually gets
 * published, and it is the cheapest check in the batch: the real values are
 * in one config string, the tree is small, and a substring search settles
 * it. The cases' whole naming discipline — roles and keys, never addresses
 * and ids — exists so this test can be true.
 *
 * It can only run where the mapping is present, which is a real limit and
 * is stated rather than hidden: on a machine with no `TEST_RUNNER_FIXTURES`
 * it knows nothing and says so. The security gate remains the backstop.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFixtureMap } from "./fixtures";
import { ACCOUNT_ROLES, FIXTURE_KEYS } from "./types";

const TREE = join(__dirname);

/** Short values are words, not secrets: a tab named `scratch` is not an id,
 * and matching it would fail on ordinary prose. Ids and addresses are long. */
const MIN_LENGTH = 9;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

/**
 * The mapping, read from the root `.env` FILE rather than from the
 * environment.
 *
 * `vitest.config.ts` lifts only `DATABASE_URL` out of that file, and says
 * why: importing the whole thing could change what unmocked code sees. That
 * reasoning is right and this test does not need it widened. It is checking
 * SOURCE TEXT, so it wants the values wherever they live, and it should not
 * alter the environment any other test runs in to get them.
 */
function readConfiguredFixtures(): string | undefined {
  if (process.env.TEST_RUNNER_FIXTURES) return process.env.TEST_RUNNER_FIXTURES;
  try {
    const env = readFileSync(join(__dirname, "../../../../../.env"), "utf8");
    const match = env.match(/^TEST_RUNNER_FIXTURES=(.+)$/m);
    return match?.[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

function configuredValues(): string[] {
  const map = parseFixtureMap(readConfiguredFixtures());
  if (map.empty) return [];
  const values = [
    ...ACCOUNT_ROLES.map((role) => map.account(role)),
    map.user("nonAdmin"),
    ...FIXTURE_KEYS.map((key) => map.fixture(key)),
  ];
  return [...new Set(values.filter((v): v is string => !!v && v.length >= MIN_LENGTH))];
}

describe("the runner's own source", () => {
  const values = configuredValues();

  it.skipIf(values.length === 0)(
    "contains no address, user id or file id from the fixture mapping",
    () => {
      const found: string[] = [];
      for (const file of sourceFiles(TREE)) {
        const source = readFileSync(file, "utf8");
        for (const value of values) {
          if (source.includes(value)) {
            // The value itself is NOT put in the failure message: this suite's
            // output is read in terminals and pasted into tickets.
            found.push(`${file.slice(TREE.length + 1)} contains a configured fixture value`);
          }
        }
      }
      expect(found).toEqual([]);
    }
  );

  it("knows when it cannot check, rather than passing quietly", () => {
    // A green from this file means either "checked and clean" or "no
    // mapping here". Those are different, and the difference is worth
    // seeing in the run output rather than inferring from a skip.
    if (values.length === 0) {
      console.warn("[no-fixture-values] TEST_RUNNER_FIXTURES is unset; nothing was checked");
    }
    expect(Array.isArray(values)).toBe(true);
  });
});

/**
 * The shape an operator copies has to be the shape the code reads.
 *
 * `.env.example` carries a commented example of `TEST_RUNNER_FIXTURES` with
 * every value elided, and it is the only description of that variable
 * anybody setting the suite up will see. It had drifted THREE KEYS behind
 * `FIXTURE_KEYS` before anything noticed, because nothing compared them:
 * each new key was added to the code and to SSM, and the file an operator
 * copies from kept describing the old shape. A mapping built from it would
 * skip every case needing a missing key, naming a mapping the operator had
 * no reason to think they needed.
 */
describe("the documented fixture shape", () => {
  it("lists exactly the keys FIXTURE_KEYS declares, in order", () => {
    const example = readFileSync(join(import.meta.dirname, "../../../../../.env.example"), "utf8");
    const shape = example.slice(example.indexOf('"fixtures":{'));
    const listed = [...shape.matchAll(/"(\w+)":""/g)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed).toEqual([...FIXTURE_KEYS]);
  });
});
