import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * D2 (smoke row D2): an updated cell reads back changed, and is put
 * back the way it was found.
 *
 * It restores the ORIGINAL VALUE rather than clearing, because the cell it
 * writes to belongs to a fixture other cases read. A cleanup that leaves a
 * blank where a value was is not a cleanup, it is a slower kind of damage.
 */
export const d2SheetsUpdate: TestCase = {
  id: "D2",
  title: "an updated cell reads back changed and is then restored",
  covers: ["gws-mcp__sheets_update", "gws-mcp__sheets_read"],
  accounts: ["sender"],
  needs: ["SH1"],
  run: async (ctx) => {
  /* WRITES ON THE SCENARIO'S OWN SPREADSHEET, not the standing fixture
   * (HQ, 2026-09-21). This used to write to the fixture sheet's scratch
   * tab, so a cleanup that failed halfway damaged the artefact four read
   * steps and two other scenarios depend on. SH1 creates it, SH5 removes
   * it, and `needs` means this skips with a reason rather than failing
   * against a spreadsheet that was never made. */
    const spreadsheet_id = ctx.from("SH1").spreadsheetId as string;
    const cell = `${ctx.from("SH1").firstTab as string}!D1`;

    const before = await ctx.call("gws-mcp__sheets_read", { spreadsheet_id, range: cell }, { as: "sender" });
    const original = resultJson<{ values?: string[][] }>("sheets_read", before).values?.[0]?.[0] ?? "";
    ctx.evidence(`the cell held ${original === "" ? "nothing" : `${original.length} characters`} before`);

    const marker = `d2-${ctx.stamp}`;
    await ctx.call(
      "gws-mcp__sheets_update",
      { spreadsheet_id, range: cell, values: [[marker]] },
      { as: "sender" }
    );
    ctx.defer("restore the cell's original value", async () => {
      await ctx.call(
        "gws-mcp__sheets_update",
        { spreadsheet_id, range: cell, values: [[original]] },
        { as: "sender" }
      );
    });

    const after = await ctx.call("gws-mcp__sheets_read", { spreadsheet_id, range: cell }, { as: "sender" });
    const now = resultJson<{ values?: string[][] }>("sheets_read", after).values?.[0]?.[0] ?? "";
    if (now !== marker) {
      throw new Error("the cell did not read back as the value just written to it");
    }
  },
};
