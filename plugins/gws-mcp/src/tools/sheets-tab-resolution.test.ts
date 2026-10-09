import { describe, expect, it } from "vitest";
import { fakeClient, payload } from "./fake-client.test-helper.js";
import { gridRangeResolver, matchTab, resolveRange, splitRange, tabNameFromRange } from "./sheets-grid.js";
import { handleSheetsQuery } from "./sheets-query.js";
import { handleSheetsFormat } from "./sheets-format.js";
import { handleSheetsRows } from "./sheets-rows.js";

/**
 * A name that is a tab is a tab (SCRUM-369).
 *
 * "Q3", "Log", "CRM" and "Jan" are valid cell or column references as text.
 * The query and format tools decided between "tab" and "cells" from the text
 * alone, so a bare range naming one of those tabs was applied to the FIRST
 * tab. The query endpoint made it worse: it answers a tab it cannot find with
 * the first tab's rows and no error. Every case here was a wrong result that
 * looked like a right one.
 */

const TITLES = ["Sheet1", "Log", "CRM", "Q3", "Bob's", "Wins!", "Inventory"];
// The first tab is deliberately not id 0, and ids are not in title order.
const IDS: Record<string, number> = { Sheet1: 900, Log: 633, CRM: 77, Q3: 1940, "Bob's": 2114, "Wins!": 1689, Inventory: 5 };
const TABS = { data: { sheets: TITLES.map((title) => ({ properties: { sheetId: IDS[title], title } })) } };
const TABS_WITH_GRID = {
  data: {
    sheets: TITLES.map((title) => ({
      properties: { sheetId: IDS[title], title, gridProperties: { rowCount: 1000, columnCount: 26 } },
    })),
  },
};
const TABLE = { text: `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ status: "ok", table: { cols: [{ id: "A", label: "id", type: "number" }], rows: [{ c: [{ v: 1 }] }] } })});` };

describe("resolveRange: the text, read against the tabs that exist", () => {
  it("a bare word that is a tab is that tab, even when it reads as a cell or a column", () => {
    for (const tab of ["Log", "CRM", "Q3"]) {
      expect(resolveRange(tab, TITLES)).toEqual({ tab, cells: "", ambiguous: true });
    }
    expect(resolveRange("Inventory", TITLES)).toEqual({ tab: "Inventory", cells: "", ambiguous: false });
  });

  it("a bare word that is no tab and reads as cells is cells on the first tab", () => {
    expect(resolveRange("B7", TITLES)).toEqual({ cells: "B7", ambiguous: false });
    expect(resolveRange("A1:D9", TITLES)).toEqual({ cells: "A1:D9", ambiguous: false });
    // "Jan" is a tab in some files and a column in this one.
    expect(resolveRange("Jan", TITLES)).toEqual({ cells: "Jan", ambiguous: false });
    expect(resolveRange("Jan", [...TITLES, "Jan"])).toEqual({ tab: "Jan", cells: "", ambiguous: true });
  });

  it("matches a tab without regard to case, as Sheets does, and answers with its real title", () => {
    expect(resolveRange("log", TITLES).tab).toBe("Log");
    expect(resolveRange("LOG!A1:B2", TITLES)).toEqual({ tab: "Log", cells: "A1:B2", ambiguous: false });
    expect(matchTab("crm", TITLES)).toBe("CRM");
  });

  it("un-doubles the quotes in a quoted tab name", () => {
    expect(resolveRange("'Bob''s'!A:B", TITLES)).toEqual({ tab: "Bob's", cells: "A:B", ambiguous: false });
    expect(resolveRange("'Bob''s'", TITLES)).toEqual({ tab: "Bob's", cells: "", ambiguous: false });
  });

  it("a '!' inside a quoted tab name does not end the name", () => {
    expect(resolveRange("'Wins!'!C10:F50", TITLES)).toEqual({ tab: "Wins!", cells: "C10:F50", ambiguous: false });
    expect(tabNameFromRange("'Wins!'!C10:F50")).toBe("Wins!");
    expect(splitRange("'Wins!'!C10:F50")).toEqual({ tab: "Wins!", cells: "C10:F50" });
    // Unquoted, the name ends at the last "!", since cells never hold one.
    expect(splitRange("Wins!!C10:F50")).toEqual({ tab: "Wins!", cells: "C10:F50" });
  });

  it("refuses a tab that does not exist, with the tabs that do", () => {
    expect(() => resolveRange("Lgo!A1:B2", TITLES)).toThrow(/No sheet named "Lgo".*"Sheet1", "Log", "CRM"/);
    expect(() => resolveRange("'Bobs'!A:B", TITLES)).toThrow(/No sheet named "Bobs"/);
    expect(() => resolveRange("Inventry", TITLES)).toThrow(/No sheet named "Inventry"/);
    expect(() => resolveRange("'Q4'", TITLES)).toThrow(/No sheet named "Q4"/);
  });

  it("an explicit tab is never ambiguous, and the first tab can still be named", () => {
    expect(resolveRange("Sheet1!Q3", TITLES)).toEqual({ tab: "Sheet1", cells: "Q3", ambiguous: false });
    expect(resolveRange("'Q3'!A1:B2", TITLES)).toEqual({ tab: "Q3", cells: "A1:B2", ambiguous: false });
  });
});

describe("sheets_query runs over the tab that was named", () => {
  async function query(range: string) {
    const { client, calls } = fakeClient([TABS, TABLE]);
    await handleSheetsQuery(client, "sheets_query", { spreadsheet_id: "s", query: "select A", range });
    const url = new URL(calls[calls.length - 1].url as string);
    return { sheet: url.searchParams.get("sheet"), range: url.searchParams.get("range"), calls };
  }

  it("a bare Log, CRM or Q3 is sent as that tab, not as cells on the first tab", async () => {
    for (const tab of ["Log", "CRM", "Q3"]) {
      expect(await query(tab)).toMatchObject({ sheet: tab, range: null });
    }
  });

  it("Bob's is sent with one apostrophe, however the caller quoted it", async () => {
    expect(await query("'Bob''s'!A:B")).toMatchObject({ sheet: "Bob's", range: "A:B" });
    expect(await query("'Bob''s'")).toMatchObject({ sheet: "Bob's", range: null });
  });

  it("a tab with '!' in its name keeps its name and its block", async () => {
    expect(await query("'Wins!'!C10:F50")).toMatchObject({ sheet: "Wins!", range: "C10:F50" });
  });

  it("a misspelt tab is refused with the tab list, and the query is never sent", async () => {
    const { client, calls } = fakeClient([TABS]);
    await expect(
      handleSheetsQuery(client, "sheets_query", { spreadsheet_id: "s", query: "select A", range: "Lgo!A:B" })
    ).rejects.toThrow(/No sheet named "Lgo" in this spreadsheet. Existing tabs: "Sheet1", "Log"/);
    expect(calls.some((c) => "url" in c)).toBe(false);
  });

  it("a bare block with a colon is the first tab and costs no tab lookup", async () => {
    const { client, calls } = fakeClient([TABLE]);
    await handleSheetsQuery(client, "sheets_query", { spreadsheet_id: "s", query: "select A", range: "A1:D9" });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url as string);
    expect(url.searchParams.get("sheet")).toBeNull();
    expect(url.searchParams.get("range")).toBe("A1:D9");
  });

  it("no range at all is the first tab and costs no tab lookup", async () => {
    const { client, calls } = fakeClient([TABLE]);
    await handleSheetsQuery(client, "sheets_query", { spreadsheet_id: "s", query: "select A" });
    expect(calls).toHaveLength(1);
  });

  it("error messages quote the range as the caller wrote it", async () => {
    const noColumn = {
      text: `x(${JSON.stringify({ status: "error", errors: [{ reason: "invalid_query", detailed_message: "Invalid query: NO_COLUMN: Z" }] })});`,
    };
    const { client } = fakeClient([TABS, noColumn]);
    await expect(
      handleSheetsQuery(client, "sheets_query", { spreadsheet_id: "s", query: "select Z", range: "log!A:B" })
    ).rejects.toThrow(/outside the range log!A:B/);
  });
});

describe("the format tools resolve the same way", () => {
  it("gridRangeResolver sends a bare Q3 to the tab Q3, not to cell Q3 of the first tab", async () => {
    const { client } = fakeClient([TABS_WITH_GRID]);
    const resolve = await gridRangeResolver(client, "s");
    expect(resolve("Q3")).toEqual({ sheetId: IDS.Q3 });
    expect(resolve("Log")).toEqual({ sheetId: IDS.Log });
    expect(resolve("B7")).toMatchObject({ sheetId: IDS.Sheet1, startRowIndex: 6, startColumnIndex: 1 });
    expect(resolve("'Wins!'!C10:F50")).toMatchObject({ sheetId: IDS["Wins!"], startRowIndex: 9, startColumnIndex: 2 });
    expect(resolve("'Bob''s'!A1:B2")).toMatchObject({ sheetId: IDS["Bob's"] });
    expect(() => resolve("Lgo!A1:B2")).toThrow(/No sheet named "Lgo"/);
  });

  it("sheets_format_range formats the tab that was named", async () => {
    const { client, calls } = fakeClient([TABS_WITH_GRID, { data: { replies: [{}] } }]);
    await handleSheetsFormat(client, "sheets_format_range", {
      spreadsheet_id: "s",
      formats: [{ ranges: ["CRM"], bold: true }],
    });
    const requests = (calls[1].jsonBody as { requests: Array<{ repeatCell: { range: { sheetId: number } } }> }).requests;
    expect(requests[0].repeatCell.range).toEqual({ sheetId: IDS.CRM });
  });

  it("trim_grid on a bare word that is both a tab and a cell is refused, and nothing is sent", async () => {
    const { client, calls } = fakeClient([TABS_WITH_GRID]);
    await expect(
      handleSheetsFormat(client, "sheets_format_table", { spreadsheet_id: "s", range: "Q3", trim_grid: true })
    ).rejects.toThrow(/cannot trim "Q3": that is both the name of a tab and a cell reference/);
    expect(calls).toHaveLength(1);
  });

  it("trim_grid on a range that names its tab outright still works", async () => {
    const { client, calls } = fakeClient([TABS_WITH_GRID, { data: { replies: [{}] } }]);
    await handleSheetsFormat(client, "sheets_format_table", { spreadsheet_id: "s", range: "'Q3'!A1:E60", trim_grid: true });
    const requests = (calls[1].jsonBody as { requests: Array<Record<string, { range?: { sheetId: number } }>> }).requests;
    expect(requests[0].deleteDimension?.range?.sheetId).toBe(IDS.Q3);
  });

  it("trim_grid on a bare cell that is no tab is not called ambiguous", async () => {
    // "B7" names no tab here, so it means the first tab's cell and the
    // ordinary bounded-range rule decides the trim.
    const { client } = fakeClient([TABS_WITH_GRID]);
    const resolve = await gridRangeResolver(client, "s");
    expect(resolve.ambiguous("B7")).toBe(false);
    expect(resolve.ambiguous("Q3")).toBe(true);
    expect(resolve.ambiguous("'Q3'!A1:B2")).toBe(false);
  });
});

describe("sheets_find_rows counts rows from the cell part, not from a '!' in the tab name", () => {
  it("a match on a tab named Wins! reports its real sheet row and range", async () => {
    const { client } = fakeClient([
      {
        data: {
          range: "'Wins!'!C10:F12",
          values: [
            ["id", "name", "x", "y"],
            ["507", "g", "", ""],
            ["508", "h", "", ""],
          ],
        },
      },
    ]);
    const result = payload(
      await handleSheetsRows(client, "sheets_find_rows", {
        spreadsheet_id: "s",
        range: "'Wins!'!C10:F12",
        column: "id",
        values: ["508"],
      })
    ) as { matches: Array<{ rows: Array<{ row: number; range: string }> }> };
    expect(result.matches[0].rows[0]).toMatchObject({ row: 12, range: "'Wins!'!C12:F12" });
  });
});
