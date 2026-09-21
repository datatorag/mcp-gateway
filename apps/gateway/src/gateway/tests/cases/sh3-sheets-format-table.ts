import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * SH3 (Sheets scenario): formatting a table freezes the header and leaves
 * the values alone.
 *
 * A new step. `sheets_format_table` is the convenience wrapper that does
 * several things at once, and the failure worth catching is not that it
 * errors, it is that formatting is supposed to be NON-DESTRUCTIVE. A
 * wrapper that rewrote the range to apply its formatting would return
 * success and silently replace the caller's data, which is the kind of
 * defect nobody finds until it has run over something that mattered.
 *
 * So the case writes known values, formats, and asserts BOTH: the frozen
 * row count really changed, and the values read back unchanged. The freeze
 * is read through `gws_run`, because no read tool reports grid properties;
 * that is a read, which is all the send guard permits it to be.
 */
export const sh3SheetsFormatTable: TestCase = {
  id: "SH3",
  title: "formatting a table freezes the header without touching the values",
  covers: [
    "gws-mcp__sheets_format_table",
    "gws-mcp__sheets_update",
    "gws-mcp__sheets_read",
    "gws-mcp__gws_run",
    // The cleanup calls it, and the runtime check counts cleanup: a case
    // that tidies up with a tool it never declared reports that tool as
    // uncovered while actually exercising it.
    "gws-mcp__sheets_clear",
  ],
  accounts: ["sender"],
  needs: ["SH1"],
  run: async (ctx) => {
    const spreadsheet_id = ctx.from("SH1").spreadsheetId as string;
    const tab = ctx.from("SH1").firstTab as string;
    const range = `${tab}!A1:B2`;
    const values = [
      ["header-a", "header-b"],
      [`row-${ctx.stamp}`, "second"],
    ];

    await ctx.call("gws-mcp__sheets_update", { spreadsheet_id, range, values }, { as: "sender" });
    ctx.defer("clear the formatted range", async () => {
      await ctx.call("gws-mcp__sheets_clear", { spreadsheet_id, range }, { as: "sender" });
    });

    /** Frozen rows on the first tab, straight from the API. */
    const frozenRows = async (): Promise<number> => {
      const res = await ctx.call(
        "gws-mcp__gws_run",
        {
          service: "sheets",
          resource: "spreadsheets",
          method: "get",
          params: { spreadsheetId: spreadsheet_id, fields: "sheets.properties" },
        },
        { as: "sender" }
      );
      const body = resultJson<{
        sheets?: { properties?: { title?: string; gridProperties?: { frozenRowCount?: number } } }[];
      }>("gws_run", res);
      const found = (body.sheets ?? []).find((s) => s.properties?.title === tab);
      return found?.properties?.gridProperties?.frozenRowCount ?? 0;
    };

    const before = await frozenRows();

    await ctx.call(
      "gws-mcp__sheets_format_table",
      { spreadsheet_id, range, header_rows: 1, freeze_header: true, banded: true },
      { as: "sender" }
    );

    const after = await frozenRows();
    ctx.evidence(`frozen rows went from ${before} to ${after}`);
    /* AGAINST THE BASELINE, not against 1. Asserting `after >= 1` says
     * nothing on a spreadsheet that already had a frozen row, and the
     * evidence line above claims a comparison the assertion was not
     * making. */
    if (after <= before) {
      throw new Error(`the header was not frozen: frozen rows went from ${before} to ${after}`);
    }

    // THE VALUES SURVIVED. Formatting that rewrote the range would pass a
    // freeze check and quietly destroy the caller's data.
    const read = await ctx.call("gws-mcp__sheets_read", { spreadsheet_id, range }, { as: "sender" });
    const back = resultJson<{ values?: string[][] }>("sheets_read", read).values ?? [];
    const flatBefore = values.flat().join("|");
    const flatAfter = back.flat().join("|");
    if (flatAfter !== flatBefore) {
      throw new Error("the values changed when the range was formatted, so formatting is not non-destructive");
    }
  },
};
