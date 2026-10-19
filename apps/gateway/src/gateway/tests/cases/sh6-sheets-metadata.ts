import type { TestCase } from "../types";
import { resultJson, resultText } from "../result-json";

type Tab = { title?: string; sheetId?: number; rows?: number; columns?: number; frozenRows?: number };

/**
 * SH6 (Sheets scenario): the structure of a spreadsheet, and none of its
 * cells.
 *
 * `sheets_get_metadata` exists because the only way to learn a
 * spreadsheet's tabs and their ids was the raw API tool. Two claims are
 * worth a step. The tool's answer has to AGREE WITH A SECOND READER: the
 * same spreadsheet read through the raw call, tab for tab, id for id, in
 * the same order, because a tool that reshapes a response can drop or
 * reorder a tab and still look complete. And the answer has to carry NO
 * CELL: by this point the scenario has written values into the first tab,
 * so a value from that tab appearing here would mean the field mask is
 * not doing its job.
 */
export const sh6SheetsMetadata: TestCase = {
  id: "SH6",
  title: "the spreadsheet's tabs, ids and sizes agree with the API, and no cell is returned",
  covers: ["gws-mcp__sheets_get_metadata", "gws-mcp__sheets_update", "gws-mcp__sheets_clear", "gws-mcp__gws_run"],
  accounts: ["sender"],
  needs: ["SH1"],
  run: async (ctx) => {
    const spreadsheet_id = ctx.from("SH1").spreadsheetId as string;
    const firstTab = ctx.from("SH1").firstTab as string;

    // A value of this step's own in the first tab, so "no cell came back"
    // is checked against something known to be there.
    const marker = `sh6-${ctx.stamp}`;
    const range = `${firstTab}!D1:D1`;
    ctx.defer("clear the marker cell", async () => {
      await ctx.call("gws-mcp__sheets_clear", { spreadsheet_id, range }, { as: "sender" });
    });
    await ctx.call("gws-mcp__sheets_update", { spreadsheet_id, range, values: [[marker]] }, { as: "sender" });

    const answered = await ctx.call("gws-mcp__sheets_get_metadata", { spreadsheet_id }, { as: "sender" });
    const meta = resultJson<{ spreadsheetId?: string; title?: string; tabCount?: number; tabs?: Tab[] }>(
      "sheets_get_metadata",
      answered
    );
    const tabs = meta.tabs ?? [];
    ctx.evidence(`metadata lists ${tabs.length} tab(s) and reports tabCount ${meta.tabCount ?? "absent"}`);

    if (resultText(answered).includes(marker)) {
      throw new Error("a cell value came back in the metadata, so the response is not structure only");
    }
    if (tabs.length === 0 || meta.tabCount !== tabs.length) {
      throw new Error("the metadata lists no tabs, or its count disagrees with its own list");
    }
    for (const tab of tabs) {
      if (typeof tab.sheetId !== "number" || !Number.isFinite(tab.sheetId)) {
        throw new Error("a tab came back without a numeric sheetId, which is the one thing a batch update needs from here");
      }
      if (!(Number(tab.rows) > 0) || !(Number(tab.columns) > 0) || typeof tab.frozenRows !== "number") {
        throw new Error("a grid tab came back without a size or without a frozen row count");
      }
    }

    // THE SECOND READER. Same spreadsheet, through the raw call.
    const raw = await ctx.call(
      "gws-mcp__gws_run",
      {
        service: "sheets",
        resource: "spreadsheets",
        method: "get",
        params: { spreadsheetId: spreadsheet_id, fields: "sheets.properties" },
      },
      { as: "sender" }
    );
    const api = (
      resultJson<{
        sheets?: { properties?: { title?: string; sheetId?: number; gridProperties?: { rowCount?: number; frozenRowCount?: number } } }[];
      }>("gws_run", raw).sheets ?? []
    ).map((s) => s.properties ?? {});

    if (api.length !== tabs.length) {
      throw new Error(`the API lists ${api.length} tab(s) where the metadata lists ${tabs.length}`);
    }
    api.forEach((p, i) => {
      const t = tabs[i];
      if (p.title !== t.title || p.sheetId !== t.sheetId) {
        throw new Error(`tab ${i + 1} differs between the metadata and the API in title or sheetId, or the order changed`);
      }
      if (p.gridProperties?.rowCount !== t.rows || (p.gridProperties?.frozenRowCount ?? 0) !== t.frozenRows) {
        throw new Error(`tab ${i + 1} differs between the metadata and the API in row count or frozen rows`);
      }
    });
    if (!tabs.some((t) => t.title === firstTab)) {
      throw new Error("the tab this scenario has been working in is missing from the metadata");
    }
    ctx.evidence("every tab agrees with the API in title, id, order, row count and frozen rows, and no cell value was returned");
  },
};
