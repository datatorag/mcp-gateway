/**
 * The scope parser refuses by default (SCRUM-303).
 *
 * FOUR ROUNDS OF REVIEW FOUND FOUR SPELLINGS OF ONE DEFECT, because the fix
 * each time was for the spelling rather than for the shape. Each was an
 * input that was neither "absent" nor "what we anticipated", each collapsed
 * the scope to `{}`, and `{}` means EVERYTHING, so a request that named one
 * case or zero cases ran all 55 and put real mail in the fixture inbox. A
 * run that widens does not look like a failure; it finishes and reports
 * none.
 *
 * So the table below is not a list of bugs found. It is the statement that
 * anything not exactly as declared is refused, with the historical
 * spellings marked, and it is written as a table so a fifth spelling is one
 * row rather than another round.
 */

import { describe, expect, it } from "vitest";
import { parseScope } from "./scope";

const refused: [string, unknown, string][] = [
  ["a scenario that is not a string (round 4)", { scenario: 7 }, "scenario must be a string."],
  ["a scenario that is a bare true", { scenario: true }, "scenario must be a string."],
  ["an unregistered scenario (round 1)", { scenario: "gmail" }, "No scenario named gmail"],
  ["an empty scenario name", { scenario: "" }, "No scenario named"],
  ["a scenario that is an array", { scenario: ["gateway"] }, "scenario must be a string."],
  ["case_ids that is a bare string (round 4)", { case_ids: "A1" }, "case_ids must be an array of strings."],
  ["case_ids with unusable elements (round 2)", { case_ids: [10, 11] }, "case_ids must be an array of strings."],
  ["case_ids MIXED, so nothing is silently dropped", { case_ids: ["A1", 10] }, "case_ids must be an array of strings."],
  ["case_ids that is an object", { case_ids: { 0: "A1" } }, "case_ids must be an array of strings."],
  ["case_ids holding a nested array", { case_ids: [["A1"]] }, "case_ids must be an array of strings."],
  ["both at once", { scenario: "gateway", case_ids: ["A1"] }, "not both"],
  ["a body that is an array", ["A1"], "must be an object"],
  ["a body that is a bare string", "gateway", "must be an object"],
];

describe("what the parser refuses", () => {
  it.each(refused)("refuses %s", (_label, body, expected) => {
    const parsed = parseScope(body);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toContain(expected);
  });
});

describe("what the parser accepts, and what it turns it into", () => {
  it("treats an absent body as everything", () => {
    expect(parseScope(undefined)).toEqual({ ok: true, scope: {} });
    expect(parseScope(null)).toEqual({ ok: true, scope: {} });
    expect(parseScope({})).toEqual({ ok: true, scope: {} });
  });

  it("treats explicit nulls as not asked for", () => {
    expect(parseScope({ scenario: null, case_ids: null })).toEqual({ ok: true, scope: {} });
  });

  it("takes a registered scenario", () => {
    expect(parseScope({ scenario: "gateway" })).toEqual({ ok: true, scope: { scenario: "gateway" } });
  });

  it("takes a list of ids without checking they exist", () => {
    // Whether an id names a real case is `selectCases`'s question; an
    // unknown id narrows to nothing, which is safe. This layer is about
    // SHAPE.
    expect(parseScope({ case_ids: ["A1", "NOPE"] })).toEqual({
      ok: true,
      scope: { caseIds: ["A1", "NOPE"] },
    });
  });

  it("KEEPS an empty list rather than dropping it (round 3)", () => {
    /* The single most important row. Dropping it produced `{}`, and `{}`
     * means everything. Kept, it selects nothing and the run is refused. */
    const parsed = parseScope({ case_ids: [] });
    expect(parsed).toEqual({ ok: true, scope: { caseIds: [] } });
    expect(parsed.ok === true && parsed.scope).not.toEqual({});
  });

  it("REFUSES a field it does not know, which it used to ignore", () => {
    /* This assertion is the exact inverse of what it said one round ago,
     * where "ignores fields it does not know" was written as forward
     * compatibility. It was the fifth spelling of the widening bug: the
     * scope is built from known fields only, so an unread field left the
     * scope empty, and empty means EVERYTHING. `{caseIds: ["A1"]}` named
     * one case and ran 55.
     *
     * Tolerating unknown input is only safe when the default is safe. Here
     * the default was the whole suite with its mail sends. */
    const parsed = parseScope({ caseIds: ["A1"] });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toContain("caseIds");
  });

  it.each([
    ["the camelCase spelling used elsewhere in this codebase", { caseIds: ["A1"] }],
    ["a singular typo", { case_id: "A1" }],
    ["a plural typo", { scenarios: ["gateway"] }],
    ["a misspelling", { scenrio: "gateway" }],
    ["a known field alongside an unknown one", { case_ids: ["A1"], extra: true }],
    ["the retired field", { tier: 1 }],
  ])("refuses %s by name", (_label, body) => {
    const parsed = parseScope(body);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toContain("Unknown field");
  });
});

/**
 * THE PROPERTY, rather than the examples: for every input, the parser
 * either refuses or produces a scope no wider than what was asked for.
 */
describe("no input can widen a request", () => {
  /* THE ORACLE USED TO BE BLIND IN EXACTLY THE DIRECTION OF THE BUG. It
   * derived "asked for nothing" from `input.scenario` and `input.case_ids`,
   * the same two names the parser reads, so a request that named something
   * under ANY OTHER name was classified as having asked for nothing and its
   * widening was invisible. Three typo rows were added to the list and the
   * suite stayed green while those inputs really did run all 55 cases.
   *
   * It now asks a question the parser's own vocabulary cannot influence:
   * did the caller put ANYTHING in the body? If they did, they asked for
   * something, and "something" must never come back as everything. */
  const inputs: unknown[] = [
    undefined, null, {}, [], "", "A1", 7, true,
    { scenario: "gateway" }, { scenario: "gmail" }, { scenario: 7 }, { scenario: null },
    { case_ids: [] }, { case_ids: ["A1"] }, { case_ids: "A1" }, { case_ids: [10] },
    { case_ids: ["A1", 10] }, { scenario: "gateway", case_ids: [] },
    { case_ids: null, scenario: null },
    // The family the old oracle could not see. Each names something.
    { caseIds: ["A1"] }, { case_id: "A1" }, { scenarios: ["gateway"] },
    { scenrio: "gateway" }, { tier: 1 }, { case_ids: ["A1"], extra: true },
  ];

  it.each(inputs.map((i) => [JSON.stringify(i) ?? String(i), i] as const))(
    "%s either refuses or narrows",
    (_label, input) => {
      const parsed = parseScope(input);
      if (!parsed.ok) return;

      const gotEverything =
        parsed.scope.scenario === undefined && parsed.scope.caseIds === undefined;
      if (!gotEverything) return;

      /* Everything came back. That is only allowed if the caller genuinely
       * asked for nothing: no body, or a body with no keys at all, or keys
       * whose values are all null. Note this never mentions `scenario` or
       * `case_ids`, so a field the parser does not read cannot slip past by
       * being unnamed here too. */
      const keys =
        input !== null && typeof input === "object" && !Array.isArray(input)
          ? Object.keys(input as Record<string, unknown>)
          : [];
      const meaningful = keys.filter(
        (k) => (input as Record<string, unknown>)[k] !== null && (input as Record<string, unknown>)[k] !== undefined
      );
      expect(
        meaningful,
        `a request naming ${meaningful.join(", ")} came back as the whole suite`
      ).toEqual([]);
    }
  );
});
