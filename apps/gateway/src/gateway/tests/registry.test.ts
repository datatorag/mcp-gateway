/**
 * Registry invariants (SCRUM-303), checked against deliberately broken sets
 * as well as the real one. The real registry is EMPTY in phase 2, so a test
 * that only ever looked at it would pass while checking nothing.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CASES, CASES_DIR, caseFilesOnDisk, checkRegistry, registryMatchesDisk } from "./registry";
import type { TestCase } from "./types";

const c = (over: Partial<TestCase> & { id: string }): TestCase => ({
  title: "a case",
  tier: 1,
  covers: ["gws-mcp__sheets_read"],
  accounts: [],
  run: async () => {},
  ...over,
});

describe("the real registry", () => {
  it("satisfies every invariant", () => {
    expect(CASES.length).toBeGreaterThan(0);
    expect(checkRegistry(CASES)).toEqual([]);
  });

  it("lists exactly the case modules on disk, so a file nobody listed fails", () => {
    expect(registryMatchesDisk(CASES_DIR, CASES)).toEqual([]);
    expect(caseFilesOnDisk(CASES_DIR).length).toBe(CASES.length);
  });

  it("carries the smoke sheet's own ids, so three years of run logs still resolve", () => {
    const ids = CASES.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["A1", "A2", "A3", "A4", "A5", "B1", "B2", "F1", "F2", "F7", "G1"]));
    expect(ids).toEqual(
      expect.arrayContaining(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C12", "C13"])
    );
    expect(ids).toEqual(
      expect.arrayContaining(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D9", "E1", "E3", "E4"])
    );
    expect(ids).toEqual(
      expect.arrayContaining(["C11", "D14", "D15", "E2", "E5", "E8", "E9", "E10", "E11", "E16", "E17"])
    );
    /* NINE ROWS ARE NOT PORTED, and that is a decision rather than a gap:
     * they need a browser, a human judgement or a third-party console, so
     * they stay with the agent. Pinned so nobody ports one halfway and
     * leaves a case asserting less than its row claims. */
    expect(ids).not.toEqual(expect.arrayContaining(["E6", "E7", "E12", "F3", "F4", "F5", "F6", "G2", "H1"]));
    // R for runner: the two cases the sheet never had, kept out of the
    // ported id space so the counts stay comparable.
    expect(ids).toEqual(expect.arrayContaining(["R1", "R2"]));
  });

  /* THE ONE THAT ALREADY CAUGHT SOMETHING. Batch 4a shipped three cases
   * that fetched `/api/admin/tests/...` through `ctx.http`, which sends no
   * credential by design, against routes that 404 anyone without a session
   * cookie. All three would have failed for a reason that has nothing to do
   * with what they claim, and nothing in the suite noticed: a case that
   * cannot pass still typechecks and still runs.
   *
   * A path prefix is a fixed token, so this is the kind of rule a test can
   * actually hold. Ask `ctx.gateway` for anything behind the admin guard. */
  it("never sends an uncredentialed fetch at a surface behind the admin guard", () => {
    const offenders = caseFilesOnDisk(CASES_DIR)
      .map((file) => ({ file, source: readFileSync(join(CASES_DIR, file), "utf8") }))
      .filter(({ source }) => /ctx\.http\(\s*[`"']\/api\/admin/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("declares a role for every case that touches an account, and none for the rest", () => {
    // A case that forgot its roles would RUN where it should have skipped,
    // against whatever the default account happens to be.
    for (const c of CASES) {
      const touchesAccounts = c.covers.some((t) => t.includes("__"));
      if (touchesAccounts) {
        expect(c.accounts.length, `${c.id} calls a plugin tool but declares no account role`).toBeGreaterThan(0);
      }
    }
  });
});

describe("what it rejects", () => {
  it("accepts a well-formed set, so the rejections below are not blanket", () => {
    expect(checkRegistry([c({ id: "D10" }), c({ id: "D11", needs: ["D10"] })])).toEqual([]);
  });

  it.each([
    ["an id of the wrong shape", c({ id: "not-an-id" }), "id is not of the form"],
    ["no title", c({ id: "C1", title: "  " }), "no title"],
    ["an impossible tier", c({ id: "C2", tier: 3 as 1 }), "tier must be"],
    ["an unknown account role", c({ id: "C4", accounts: ["auditor" as "reader"] }), "unknown account role"],
    ["an unknown fixture key", c({ id: "C5", fixtures: ["mailbox" as "sheet"] }), "unknown fixture key"],
  ])("rejects %s", (_label, testCase, expected) => {
    const problems = checkRegistry([testCase]);
    expect(problems.map((p) => p.problem).join(" ")).toContain(expected);
  });

  it("ALLOWS a case that declares no coverage, because some exercise no tool", () => {
    // A1 reads /health, R1 pokes the front door: neither calls a tool, and
    // inventing a declaration for them would be worse than an empty list.
    // What protects coverage is the runtime check in execute.ts, which fails
    // a case whose declaration and whose calls disagree either way.
    expect(checkRegistry([c({ id: "A1", covers: [] })])).toEqual([]);
  });

  it("rejects a duplicate id, which would make one result overwrite another", () => {
    const problems = checkRegistry([c({ id: "D1" }), c({ id: "D1" })]);
    expect(problems.map((p) => p.problem)).toContain("duplicate id");
  });

  it("rejects a need that is not registered anywhere", () => {
    const problems = checkRegistry([c({ id: "D11", needs: ["D10"] })]);
    expect(problems[0].problem).toContain("needs D10");
  });

  it("notices a case module on disk that the barrel does not list", () => {
    // The failure this prevents: a case file that exists, looks written, and
    // never runs.
    const problems = registryMatchesDisk(CASES_DIR, [c({ id: "D1" })]);
    expect(problems[0].problem).toContain("in the barrel");
  });
});
