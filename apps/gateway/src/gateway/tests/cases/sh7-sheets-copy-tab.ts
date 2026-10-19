import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type Tab = { title?: string; sheetId?: number };

/**
 * SH7 (Sheets scenario): a tab copied through `sheets_copy_tab_to` really
 * exists afterwards, with the values it was copied with.
 *
 * The copy goes into the scenario's own spreadsheet, so nothing outside it
 * is touched and SH5 takes the residue with the file if cleanup here
 * fails. "It answered with a sheetId" is not the claim: the id has to be
 * one the spreadsheet did not have before and does have after, and a value
 * written to the source before the copy has to read back from the copy.
 * A copy that produced an empty tab would pass the first half.
 */
export const sh7SheetsCopyTab: TestCase = {
  id: "SH7",
  title: "a copied tab appears with a new id and carries the source's values",
  covers: [
    "gws-mcp__sheets_copy_tab_to",
    "gws-mcp__sheets_get_metadata",
    "gws-mcp__sheets_add_tab",
    "gws-mcp__sheets_update",
    "gws-mcp__sheets_read",
    "gws-mcp__sheets_delete_tab",
  ],
  accounts: ["sender"],
  needs: ["SH1"],
  run: async (ctx) => {
    const spreadsheet_id = ctx.from("SH1").spreadsheetId as string;
    const source = `copy-src-${ctx.stamp}`.slice(0, 40);
    const marker = `sh7-${ctx.stamp}`;

    const tabs = async (): Promise<Tab[]> =>
      resultJson<{ tabs?: Tab[] }>(
        "sheets_get_metadata",
        await ctx.call("gws-mcp__sheets_get_metadata", { spreadsheet_id }, { as: "sender" })
      ).tabs ?? [];

    /* CLEANUP BY WHAT IS THERE, registered before anything is made: every
     * tab whose title carries this step's source name, which is the source
     * itself and whatever Google named the copy after it. */
    ctx.defer("remove the source tab and its copy", async () => {
      for (const tab of await tabs()) {
        if (tab.title && tab.title.includes(source)) {
          await ctx.call("gws-mcp__sheets_delete_tab", { spreadsheet_id, title: tab.title }, { as: "sender" }).catch(() => {});
        }
      }
    });

    await ctx.call("gws-mcp__sheets_add_tab", { spreadsheet_id, title: source }, { as: "sender" });
    await ctx.call(
      "gws-mcp__sheets_update",
      { spreadsheet_id, range: `${source}!A1:A1`, values: [[marker]] },
      { as: "sender" }
    );
    const before = await tabs();

    const copied = resultJson<{ sheetId?: number; title?: string }>(
      "sheets_copy_tab_to",
      await ctx.call(
        "gws-mcp__sheets_copy_tab_to",
        { spreadsheet_id, title: source, destination_spreadsheet_id: spreadsheet_id },
        { as: "sender" }
      )
    );
    ctx.evidence(`the copy answered with a sheetId of type ${typeof copied.sheetId} and a ${copied.title ? "title" : "missing title"}`);
    if (typeof copied.sheetId !== "number" || !copied.title) {
      throw new Error("the copy answered without a sheetId or a title, so the new tab cannot be addressed");
    }
    if (before.some((t) => t.sheetId === copied.sheetId)) {
      throw new Error("the copy reports a sheetId the spreadsheet already had, so it describes an existing tab");
    }

    const after = await tabs();
    if (after.length !== before.length + 1) {
      throw new Error(`the spreadsheet has ${after.length} tab(s) after the copy where it had ${before.length} before`);
    }
    const landed = after.find((t) => t.sheetId === copied.sheetId);
    if (!landed || landed.title !== copied.title) {
      throw new Error("the tab the copy reported is not in the spreadsheet under the id and title it gave");
    }
    if (!after.some((t) => t.title === source)) {
      throw new Error("the source tab is gone after the copy, which is a move and not a copy");
    }

    const read = resultJson<{ values?: unknown[][] }>(
      "sheets_read",
      await ctx.call("gws-mcp__sheets_read", { spreadsheet_id, range: `'${copied.title}'!A1:A1` }, { as: "sender" })
    );
    if (read.values?.[0]?.[0] !== marker) {
      throw new Error("the copied tab does not hold the value the source held, so an empty or different tab was made");
    }
    ctx.evidence("the copy is a new tab, the source is still there, and the copy reads back the source's value");
  },
};
