import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * D7 (smoke row D7, tier 2): a tab created on the fixture gets a REAL id,
 * and is gone afterwards.
 *
 * The id is the assertion the sheet asks for. A create that answered with a
 * null or absent sheetId would still look like a success, and the next call
 * that tried to use it would fail somewhere unrelated.
 */
export const d7SheetsTab: TestCase = {
  id: "D7",
  title: "a created tab returns a real sheet id and is then deleted",
  tier: 2,
  covers: ["gws-mcp__sheets_add_tab", "gws-mcp__sheets_delete_tab"],
  accounts: ["sender"],
  fixtures: ["sheet"],
  run: async (ctx) => {
    const spreadsheet_id = ctx.fixture("sheet");
    // Tab titles are short; the run stamp keeps two runs from colliding.
    const title = `smoke-${ctx.stamp}`.slice(0, 40);

    const created = await ctx.call(
      "gws-mcp__sheets_add_tab",
      { spreadsheet_id, title },
      { as: "sender" }
    );
    ctx.defer("delete the created tab", async () => {
      await ctx.call("gws-mcp__sheets_delete_tab", { spreadsheet_id, title }, { as: "sender" });
    });

    const body = resultJson<{ sheetId?: unknown; properties?: { sheetId?: unknown } }>(
      "sheets_add_tab",
      created
    );
    const sheetId = body.sheetId ?? body.properties?.sheetId;
    ctx.evidence(`add_tab answered with sheetId of type ${typeof sheetId}`);

    if (typeof sheetId !== "number" || !Number.isFinite(sheetId)) {
      throw new Error(`the created tab has no usable sheet id (${JSON.stringify(sheetId ?? null)})`);
    }
  },
};
