/**
 * Registry invariants (SCRUM-303), checked against deliberately broken sets
 * as well as the real one. The real registry is EMPTY in phase 2, so a test
 * that only ever looked at it would pass while checking nothing.
 */

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
  it("is empty in phase 2, on purpose, and matches the directory", () => {
    // Stated as an assertion rather than left implicit: the first run against
    // a real gateway reports every served tool as uncovered, and that is the
    // honest starting number rather than a defect.
    expect(CASES).toHaveLength(0);
    expect(caseFilesOnDisk(CASES_DIR)).toEqual([]);
    expect(registryMatchesDisk(CASES_DIR, CASES)).toEqual([]);
    expect(checkRegistry(CASES)).toEqual([]);
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
    ["no declared coverage", c({ id: "C3", covers: [] }), "no tools in covers"],
    ["an unknown account role", c({ id: "C4", accounts: ["auditor" as "reader"] }), "unknown account role"],
    ["an unknown fixture key", c({ id: "C5", fixtures: ["mailbox" as "sheet"] }), "unknown fixture key"],
  ])("rejects %s", (_label, testCase, expected) => {
    const problems = checkRegistry([testCase]);
    expect(problems.map((p) => p.problem).join(" ")).toContain(expected);
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
