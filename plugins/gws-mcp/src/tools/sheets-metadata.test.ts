import { describe, expect, it } from "vitest";
import { CREATE, READ } from "./annotations.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";
import { METADATA_FIELDS, handleSheetsMetadata, sheetsMetadataTools } from "./sheets-metadata.js";

/* SCRUM-419: a spreadsheet's structure without its cells, and a tab copied
 * across spreadsheets. */

const tool = (name: string) => sheetsMetadataTools.find((t) => t.name === name)!;

describe("sheets_get_metadata", () => {
  it("asks for structure only: the field mask names no cell data", async () => {
    const { client, calls } = fakeClient([{ data: {} }]);
    await handleSheetsMetadata(client, "sheets_get_metadata", { spreadsheet_id: "s1" });
    expect(calls).toEqual([
      { service: "sheets", resource: "spreadsheets", method: "get", params: { spreadsheetId: "s1", fields: METADATA_FIELDS } },
    ]);
    // The mask is the whole guarantee, so it is held to what it may name.
    expect(METADATA_FIELDS).not.toMatch(/\bdata\b|rowData|values|effectiveValue|userEnteredValue|merges|conditionalFormats/);
    expect((calls[0].params as Record<string, unknown>).includeGridData).toBeUndefined();
  });

  it("returns one entry per tab in the order given, with sizes and frozen counts", async () => {
    const { client } = fakeClient([
      {
        data: {
          spreadsheetId: "s1",
          spreadsheetUrl: "https://docs.google.com/spreadsheets/d/s1/edit",
          properties: { title: "Budget", locale: "en_US", timeZone: "America/Los_Angeles" },
          sheets: [
            { properties: { sheetId: 0, title: "Summary", index: 0, sheetType: "GRID", gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: 1 } } },
            { properties: { sheetId: 918273, title: "Raw data", index: 1, sheetType: "GRID", hidden: true, gridProperties: { rowCount: 50, columnCount: 4, frozenRowCount: 2, frozenColumnCount: 1 } } },
            { properties: { sheetId: 5, title: "Chart", index: 2, sheetType: "OBJECT" } },
          ],
        },
      },
    ]);
    expect(payload(await handleSheetsMetadata(client, "sheets_get_metadata", { spreadsheet_id: "s1" }))).toEqual({
      spreadsheetId: "s1",
      title: "Budget",
      locale: "en_US",
      timeZone: "America/Los_Angeles",
      url: "https://docs.google.com/spreadsheets/d/s1/edit",
      tabCount: 3,
      tabs: [
        // Google omits a frozen count of zero; a grid tab still gets a number.
        { title: "Summary", sheetId: 0, index: 0, type: "GRID", hidden: false, rows: 1000, columns: 26, frozenRows: 1, frozenColumns: 0 },
        { title: "Raw data", sheetId: 918273, index: 1, type: "GRID", hidden: true, rows: 50, columns: 4, frozenRows: 2, frozenColumns: 1 },
        // A chart sheet has no grid, so it claims no size.
        { title: "Chart", sheetId: 5, index: 2, type: "OBJECT", hidden: false },
      ],
    });
  });

  it("keeps a sheetId of 0: it is an id like any other, not a missing value", async () => {
    const { client } = fakeClient([{ data: { sheets: [{ properties: { sheetId: 0, title: "A" } }] } }]);
    expect(payload(await handleSheetsMetadata(client, "sheets_get_metadata", { spreadsheet_id: "s1" })).tabs[0].sheetId).toBe(0);
  });

  it("is a read", () => {
    expect(tool("sheets_get_metadata").annotations).toEqual(READ("Read spreadsheet structure"));
  });
});

describe("sheets_copy_tab_to", () => {
  const tabs = { data: { sheets: [{ properties: { sheetId: 0, title: "Summary" } }, { properties: { sheetId: 918273, title: "Raw data" } }] } };

  it("resolves the title to its sheetId, then copies with the destination in the body", async () => {
    const { client, calls } = fakeClient([tabs, { data: { sheetId: 44, title: "Copy of Raw data", index: 3 } }]);
    const result = payload(
      await handleSheetsMetadata(client, "sheets_copy_tab_to", { spreadsheet_id: "src", title: "Raw data", destination_spreadsheet_id: "dst" })
    );
    expect(calls[1]).toEqual({
      service: "sheets",
      resource: "spreadsheets.sheets",
      method: "copyTo",
      params: { spreadsheetId: "src", sheetId: 918273 },
      jsonBody: { destinationSpreadsheetId: "dst" },
    });
    expect(result).toEqual({ destination_spreadsheet_id: "dst", sheetId: 44, title: "Copy of Raw data", index: 3 });
  });

  it("copies the tab whose id is 0 as id 0, not as a missing id", async () => {
    const { client, calls } = fakeClient([tabs, { data: { sheetId: 45 } }]);
    await handleSheetsMetadata(client, "sheets_copy_tab_to", { spreadsheet_id: "src", title: "Summary", destination_spreadsheet_id: "dst" });
    expect((calls[1].params as { sheetId: number }).sheetId).toBe(0);
  });

  it("a title the spreadsheet does not have is refused with the real tab names, and nothing is copied", async () => {
    const { client, calls } = fakeClient([tabs]);
    await expect(
      handleSheetsMetadata(client, "sheets_copy_tab_to", { spreadsheet_id: "src", title: "Nope", destination_spreadsheet_id: "dst" })
    ).rejects.toThrow('No sheet named "Nope" in this spreadsheet. Existing tabs: "Summary", "Raw data".');
    expect(calls).toHaveLength(1);
  });

  it("adds and does not destroy", () => {
    expect(tool("sheets_copy_tab_to").annotations).toEqual(CREATE("Copy a tab into another spreadsheet"));
  });
});
