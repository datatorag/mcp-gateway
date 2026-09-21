import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * C1 (tier 1): a read comes back with the VALUES it should.
 *
 * Comparing against known constants rather than checking the call succeeded
 * is the whole difference between this and a test that cannot fail. A read
 * that returns the wrong cells returns them with a 200.
 *
 * The control strings are synthetic and live in the fixture sheet beside a
 * note saying so, so a human editing them turns this red on purpose.
 */
export const c1SheetsRead: TestCase = {
  id: "C1",
  title: "the fixture sheet reads back its exact control values",
  tier: 1,
  covers: ["gws-mcp__sheets_read"],
  accounts: ["sender"],
  fixtures: ["sheet"],
  run: async (ctx) => {
    const result = await ctx.call(
      "gws-mcp__sheets_read",
      { spreadsheet_id: ctx.fixture("sheet"), range: "A1:C4" },
      { as: "sender" }
    );
    const body = resultJson<{ values?: string[][] }>("sheets_read", result);
    const rows = body.values ?? [];
    ctx.evidence(`read ${rows.length} rows from the fixture sheet`);

    // By KEY, never by row number: a row inserted above the controls would
    // otherwise fail this case while nothing was wrong with the read.
    const value = (key: string) => rows.find((r) => r[0] === key)?.[1];
    const expected: [string, string][] = [
      ["control_row_1", "datatorag-smoke-control-do-not-change"],
      // A STRING. sheets_read returns display values, so the read-back of a
      // numeric cell is "42" and demanding a number here is unsatisfiable.
      // Type coercion is E4's business, not this case's.
      ["control_row_2", "42"],
      ["control_row_3", "2026-08-07"],
    ];

    const wrong = expected
      .filter(([key, want]) => value(key) !== want)
      .map(([key, want]) => `${key}: expected ${JSON.stringify(want)}, read ${JSON.stringify(value(key) ?? null)}`);
    if (wrong.length > 0) throw new Error(wrong.join(" | "));
  },
};
