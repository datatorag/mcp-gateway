import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * E3 (smoke row E3): a value that LOOKS like a formula is stored as
 * text and does not evaluate.
 *
 * A regression guard rather than a curiosity: a
 * leading `=` or `+` reaching Sheets as a formula turns a user's data into a
 * computation, and the damage is silent because the cell shows a plausible
 * result. The suite's most valuable cases are the ones with a proven failure
 * mode, and this is one.
 */
export const e3SheetsText: TestCase = {
  id: "E3",
  title: "values beginning = and + are stored as text and do not evaluate",
  covers: ["gws-mcp__sheets_append", "gws-mcp__sheets_read", "gws-mcp__sheets_clear"],
  accounts: ["sender"],
  fixtures: ["sheet", "scratchTab"],
  serial: "scratch-tab",
  run: async (ctx) => {
    const spreadsheet_id = ctx.fixture("sheet");
    const tab = ctx.fixture("scratchTab");
    const marker = `e3-${ctx.stamp}`;
    // Chosen so that EVALUATION IS VISIBLE: if Sheets computed these, the
    // cells would read 3 and 7 instead of the text that was sent.
    const formulaish = "=1+2";
    const plusish = "+3+4";

    const appended = await ctx.call(
      "gws-mcp__sheets_append",
      { spreadsheet_id, range: tab, values: [[marker, formulaish, plusish]] },
      { as: "sender" }
    );
    const body = resultJson<{ updates?: { updatedRange?: string }; updatedRange?: string }>(
      "sheets_append",
      appended
    );
    const written = body.updates?.updatedRange ?? body.updatedRange;
    if (written) {
      ctx.defer("clear the appended row", async () => {
        await ctx.call("gws-mcp__sheets_clear", { spreadsheet_id, range: written }, { as: "sender" });
      });
    }

    const read = await ctx.call("gws-mcp__sheets_read", { spreadsheet_id, range: tab }, { as: "sender" });
    const row = (resultJson<{ values?: string[][] }>("sheets_read", read).values ?? []).find(
      (r) => r[0] === marker
    );
    if (!row) throw new Error("the appended row is not in the tab, so nothing can be concluded about it");
    ctx.evidence(`read back column B as ${JSON.stringify(row[1])} and column C as ${JSON.stringify(row[2])}`);

    if (row[1] !== formulaish) {
      throw new Error(`a value beginning "=" came back as ${JSON.stringify(row[1])}, so it evaluated`);
    }
    if (row[2] !== plusish) {
      throw new Error(`a value beginning "+" came back as ${JSON.stringify(row[2])}, so it evaluated`);
    }
  },
};
