/**
 * Comparing two runs (SCRUM-303). Table-driven, including the two cases the
 * deploy gate actually rests on: a regression, and a case present on only
 * one side because the two runs come from different environments.
 */

import { describe, expect, it } from "vitest";
import { diffRuns, hasRegression, type DiffableResult } from "./diff";

const result = (over: Partial<DiffableResult> & { caseId: string }): DiffableResult => ({
  kind: "case",
  status: "pass",
  cleanup: "clean",
  durationMs: 100,
  evidence: "",
  ...over,
});

describe("diffRuns", () => {
  it("counts an unchanged pass rather than listing it", () => {
    const d = diffRuns([result({ caseId: "C1" })], [result({ caseId: "C1" })]);
    expect(d.unchanged).toBe(1);
    expect(d.regressed).toHaveLength(0);
    expect(d.compared).toBe(1);
  });

  it("reports a pass that became a failure as a regression, with both evidences", () => {
    const d = diffRuns(
      [result({ caseId: "D15", evidence: "before" })],
      [result({ caseId: "D15", status: "fail", evidence: "after" })]
    );
    expect(d.regressed.map((e) => e.caseId)).toEqual(["D15"]);
    expect(d.regressed[0].before?.evidence).toBe("before");
    expect(d.regressed[0].after?.evidence).toBe("after");
    expect(hasRegression(d)).toBe(true);
  });

  it("treats a leaked cleanup as a regression even though the assertion passed", () => {
    // The reason cleanup is its own column: green is not just "status pass".
    const d = diffRuns(
      [result({ caseId: "D10" })],
      [result({ caseId: "D10", cleanup: "leaked" })]
    );
    expect(d.regressed.map((e) => e.caseId)).toEqual(["D10"]);
  });

  it("reports a failure that now passes as fixed", () => {
    const d = diffRuns([result({ caseId: "E1", status: "fail" })], [result({ caseId: "E1" })]);
    expect(d.fixed.map((e) => e.caseId)).toEqual(["E1"]);
    expect(hasRegression(d)).toBe(false);
  });

  it("separates added and removed, which is how a scoped run explains itself", () => {
    const d = diffRuns([result({ caseId: "A1" })], [result({ caseId: "A2" })]);
    expect(d.removed.map((e) => e.caseId)).toEqual(["A1"]);
    expect(d.added.map((e) => e.caseId)).toEqual(["A2"]);
    expect(d.compared).toBe(0);
  });

  it("does not call a slower case a regression", () => {
    const d = diffRuns(
      [result({ caseId: "C3", durationMs: 100 })],
      [result({ caseId: "C3", durationMs: 9000 })]
    );
    expect(d.regressed).toHaveLength(0);
    expect(d.unchanged).toBe(1);
  });

  it("puts a change between two non-green states in changed, not in either list", () => {
    const d = diffRuns(
      [result({ caseId: "F3", status: "skip" })],
      [result({ caseId: "F3", status: "fail" })]
    );
    expect(d.changed.map((e) => e.caseId)).toEqual(["F3"]);
    expect(d.regressed).toHaveLength(0);
    expect(d.fixed).toHaveLength(0);
  });

  it("reports an uncovered tool that is now covered as fixed", () => {
    const d = diffRuns(
      [result({ caseId: "uncovered:x", kind: "uncovered", status: "uncovered", cleanup: "none_needed" })],
      [result({ caseId: "uncovered:x", kind: "uncovered", status: "pass", cleanup: "none_needed" })]
    );
    expect(d.fixed.map((e) => e.caseId)).toEqual(["uncovered:x"]);
  });

  it("handles two empty runs without inventing anything", () => {
    expect(diffRuns([], [])).toMatchObject({ regressed: [], added: [], removed: [], unchanged: 0, compared: 0 });
  });
});
