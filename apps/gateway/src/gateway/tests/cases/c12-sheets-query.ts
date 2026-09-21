import type { TestCase } from "../types";
import { resultJson, resultText } from "../result-json";

/**
 * C12 (tier 1): the QUERY() path returns rows, and an out-of-range column is
 * REFUSED rather than answered with emptiness.
 *
 * The second half is the regression guard and the reason this is tier 1. A
 * range check that silently returns zero rows for a column that does not
 * exist hands a caller "no results" for what is actually a typo, and that
 * failure mode has already cost a debugging session once.
 *
 * WHAT IT DOES NOT ASSERT, deliberately: the identifiers in the sheet. The
 * source sheet is private and this repository is public, so the case checks
 * that two distinct non-empty rows came back, not what they say. The sheet
 * and tab arrive as configuration. That is weaker than the smoke sheet's own
 * version by exactly one property, fixture drift, and saying so is better
 * than quietly copying private ids into a public file.
 */
export const c12SheetsQuery: TestCase = {
  id: "C12",
  title: "a sheet query returns rows and refuses a column outside the range",
  tier: 1,
  covers: ["gws-mcp__sheets_query"],
  accounts: ["sender"],
  fixtures: ["querySheet", "queryTab"],
  run: async (ctx) => {
    const spreadsheet_id = ctx.fixture("querySheet");
    const range = ctx.fixture("queryTab");

    const ok = await ctx.call(
      "gws-mcp__sheets_query",
      { spreadsheet_id, range, query: "select Col1 limit 2" },
      { as: "sender" }
    );
    const body = resultJson<{ rows?: unknown[][] }>("sheets_query", ok);
    const rows = body.rows ?? [];
    ctx.evidence(`select Col1 limit 2 returned ${rows.length} row(s)`);

    if (rows.length !== 2) {
      throw new Error(`a query limited to 2 returned ${rows.length} rows, so QUERY() is down or misroutes`);
    }
    const values = rows.map((r) => String(r[0] ?? "").trim());
    if (values.some((v) => v === "")) throw new Error("a returned row has an empty first column");
    if (values[0] === values[1]) {
      throw new Error("both rows carry the same value, so the query is not reading distinct rows");
    }

    // The range check. A refusal that names the range is what lets a caller
    // fix a typo; an empty result tells them their data is missing.
    const refused = await ctx.call(
      "gws-mcp__sheets_query",
      { spreadsheet_id, range, query: "select Col99" },
      { as: "sender" }
    );
    const text = resultText(refused).trim();
    ctx.evidence(`select Col99 answered isError=${refused.isError === true}, ${text.length} characters`);

    if (!refused.isError) {
      throw new Error("a column outside the range was answered rather than refused, so a typo reads as no data");
    }
    if (!/col\s*99|range|column/i.test(text)) {
      throw new Error("the refusal does not name the column or the range, so it does not say what to fix");
    }
  },
};
