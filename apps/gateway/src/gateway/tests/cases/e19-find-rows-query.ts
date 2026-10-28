import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * E19 (Sheets scenario, SCRUM-456): sheets_find_rows takes `query`, the name
 * an agent reaches for, as `values` with that one value, finds the row, and
 * says in its answer that query was read as values. Read-only, on the fixture
 * sheet's control rows, which C1 pins.
 */
export const e19FindRowsQuery: TestCase = {
  id: "E19",
  title: "sheets_find_rows takes query as one value and says it read it as values",
  covers: ["gws-mcp__sheets_find_rows"],
  accounts: ["sender"],
  fixtures: ["sheet"],
  run: async (ctx) => {
    const found = resultJson<{
      matches?: Array<{ value?: string; rows?: Array<{ row?: number }> }>;
      notFound?: string[];
      aliased?: Record<string, string>;
    }>(
      "sheets_find_rows",
      await ctx.call(
        "gws-mcp__sheets_find_rows",
        { spreadsheet_id: ctx.fixture("sheet"), range: "A1:C4", column: "A", has_header_row: false, query: "control_row_2" },
        { as: "sender" }
      )
    );
    const rows = found.matches?.find((m) => m.value === "control_row_2")?.rows ?? [];
    ctx.evidence(`query matched ${rows.length} row(s); aliased ${JSON.stringify(found.aliased ?? null)}`);
    if (rows.length !== 1) throw new Error(`query found ${rows.length} rows for a key the fixture sheet holds once`);
    if (found.aliased?.query !== "values") throw new Error("the answer does not say query was read as values");
  },
};
