import { describe, expect, it } from "vitest";
import { READ } from "./annotations.js";
import { handleSheetsRows, sheetsRowTools } from "./sheets-rows.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";

/** A small table whose header is row 1 of the searched range. */
const table = {
  data: {
    range: "Sheet1!A1:D5",
    values: [
      ["Name", "Email", "Joined", "Status"],
      ["Ana", "ana@example.com", "2026-01-04", "active"],
      ["Bo", "bo@example.com", "2026-02-11", "churned"],
      ["Cy", "cy@example.com", "2026-03-02", "active"],
      ["Di", "ana@example.com", "2026-04-19", "active"],
    ],
  },
};

describe("sheets_find_rows", () => {
  it("returns the 1-BASED sheet row number, which is the whole point", async () => {
    // Without the row number a find cannot be followed by an update, and the
    // caller is back to reading the whole range and counting by hand.
    const { client, calls } = fakeClient([table]);

    const result = await handleSheetsRows(client, "sheets_find_rows", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!A1:D5",
      column: "Email",
      values: ["cy@example.com"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      service: "sheets",
      resource: "spreadsheets.values",
      method: "get",
      params: { spreadsheetId: "sheet-1", range: "Sheet1!A1:D5" },
    });
    expect(payload(result).matches).toEqual([
      {
        value: "cy@example.com",
        rows: [
          {
            row: 4,
            range: "'Sheet1'!A4:D4",
            values: ["Cy", "cy@example.com", "2026-03-02", "active"],
          },
        ],
      },
    ]);
  });

  it("counts rows from the range's own start, not from row 1 of the sheet", async () => {
    // A range starting at A10 means the first data row is row 11, and getting
    // this wrong points every follow-up update at the wrong row while looking
    // entirely plausible.
    const { client } = fakeClient([
      {
        data: {
          range: "Sheet1!A10:B12",
          values: [
            ["Name", "Email"],
            ["Ana", "ana@example.com"],
            ["Bo", "bo@example.com"],
          ],
        },
      },
    ]);

    const result = await handleSheetsRows(client, "sheets_find_rows", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!A10:B12",
      column: "Email",
      values: ["bo@example.com"],
    });

    expect(payload(result).matches[0].rows[0]).toMatchObject({
      row: 12,
      range: "'Sheet1'!A12:B12",
    });
  });

  it("returns a range starting at the searched range's own first COLUMN", async () => {
    // A range of C10:F12 means the row's values are columns C to F. Returning
    // A12:D12 for that row hands the caller a range that a follow-up
    // sheets_update will write into the wrong four columns, with no error
    // anywhere. The row number alone is not enough; the column offset has to
    // travel with it.
    const { client } = fakeClient([
      {
        data: {
          range: "Sheet1!C10:F12",
          values: [
            ["Name", "Email", "X", "Y"],
            ["Ana", "ana@example.com", "1", "2"],
            ["Bo", "bo@example.com", "3", "4"],
          ],
        },
      },
    ]);

    const result = await handleSheetsRows(client, "sheets_find_rows", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!C10:F12",
      column: "Email",
      values: ["bo@example.com"],
    });

    expect(payload(result).matches[0].rows[0]).toMatchObject({
      row: 12,
      range: "'Sheet1'!C12:F12",
    });
  });

  it("searches MANY values in one call, which is the batch shape", async () => {
    // One call finds every matching row for every value. The competitor shape
    // is one lookup per call; ours is one call for the whole job.
    const { client, calls } = fakeClient([table]);

    const result = await handleSheetsRows(client, "sheets_find_rows", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!A1:D5",
      column: "Email",
      values: ["ana@example.com", "bo@example.com"],
    });

    expect(calls).toHaveLength(1);
    const { matches } = payload(result);
    expect(matches).toHaveLength(2);
    // Two rows share the first key, and both come back.
    expect(matches[0].rows.map((r: { row: number }) => r.row)).toEqual([2, 5]);
    expect(matches[1].rows.map((r: { row: number }) => r.row)).toEqual([3]);
  });

  it("reports values it did not find, rather than leaving the key out", async () => {
    // An empty result and a broken tool must not read identically.
    const { client } = fakeClient([table]);

    const result = await handleSheetsRows(client, "sheets_find_rows", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!A1:D5",
      column: "Email",
      values: ["nobody@example.com"],
    });

    const body = payload(result);
    expect(body.notFound).toEqual(["nobody@example.com"]);
    expect(body.matches).toEqual([]);
    expect(body.searchedRows).toBe(4);
  });

  it("accepts an A1 column letter as well as a header name", async () => {
    const { client } = fakeClient([table]);

    const result = await handleSheetsRows(client, "sheets_find_rows", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!A1:D5",
      column: "D",
      values: ["churned"],
    });

    expect(payload(result).matches[0].rows[0].row).toBe(3);
  });

  it("never returns the header row as a match", async () => {
    // Searching for "Email" in the Email column must not match its own header.
    const { client } = fakeClient([table]);

    const result = await handleSheetsRows(client, "sheets_find_rows", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!A1:D5",
      column: "B",
      values: ["Email"],
    });

    expect(payload(result).notFound).toEqual(["Email"]);
  });

  it("searches row 1 as data when has_header_row is false", async () => {
    const { client } = fakeClient([table]);

    const result = await handleSheetsRows(client, "sheets_find_rows", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!A1:D5",
      column: "B",
      values: ["Email"],
      has_header_row: false,
    });

    expect(payload(result).matches[0].rows[0].row).toBe(1);
  });

  it.each([
    ["contains", "example.com", 4],
    ["prefix", "bo@", 1],
  ])("supports match mode %s", async (match, value, expected) => {
    const { client } = fakeClient([table]);

    const result = await handleSheetsRows(client, "sheets_find_rows", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!A1:D5",
      column: "Email",
      values: [value],
      match,
    });

    expect(payload(result).matches[0].rows).toHaveLength(expected);
  });

  it("anchors prefix at the start, so it is not contains under another name", async () => {
    // Every address CONTAINS "example.com" and none starts with it. If prefix
    // quietly behaved as contains this returns four rows and the difference
    // between the two modes would be undetectable from the outside.
    const { client } = fakeClient([table]);

    const result = await handleSheetsRows(client, "sheets_find_rows", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!A1:D5",
      column: "Email",
      values: ["example.com"],
      match: "prefix",
    });

    expect(payload(result).notFound).toEqual(["example.com"]);
  });

  it("matches exactly and case-sensitively by default", async () => {
    // A default that quietly folded case would make "Active" and "active"
    // interchangeable, and the caller would never learn which rows it hit.
    const { client } = fakeClient([table]);

    const result = await handleSheetsRows(client, "sheets_find_rows", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!A1:D5",
      column: "Status",
      values: ["ACTIVE"],
    });

    expect(payload(result).notFound).toEqual(["ACTIVE"]);
  });

  it("caps results per searched value and says the cap was hit", async () => {
    const { client } = fakeClient([table]);

    const result = await handleSheetsRows(client, "sheets_find_rows", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!A1:D5",
      column: "Status",
      values: ["active"],
      max_results: 2,
    });

    const [first] = payload(result).matches;
    expect(first.rows).toHaveLength(2);
    // A silent truncation reads exactly like a complete result.
    expect(first.truncated).toBe(true);
  });

  it("names the column and lists the real headers when the column is unknown", async () => {
    const { client } = fakeClient([table]);

    await expect(
      handleSheetsRows(client, "sheets_find_rows", {
        spreadsheet_id: "sheet-1",
        range: "Sheet1!A1:D5",
        column: "Adress",
        values: ["x"],
      })
    ).rejects.toThrow(
      'No column "Adress" in this range. Headers: "Name", "Email", "Joined", "Status".'
    );
  });

  it("returns an empty result rather than throwing on an empty range", async () => {
    const { client } = fakeClient([{ data: { range: "Sheet1!A1:D5" } }]);

    const result = await handleSheetsRows(client, "sheets_find_rows", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!A1:D5",
      column: "A",
      values: ["x"],
    });

    expect(payload(result)).toEqual({
      matches: [],
      notFound: ["x"],
      searchedRows: 0,
    });
  });

  it("is read-only, pinned to the exact annotation shape", () => {
    const tool = sheetsRowTools.find((t) => t.name === "sheets_find_rows");
    expect(tool?.annotations).toEqual(READ("Find rows matching a value"));
    expect(tool?.inputSchema.required).toEqual([
      "spreadsheet_id",
      "range",
      "column",
      "values",
    ]);
  });
});

describe("sheets_find_rows against a tab that does not exist (SCRUM-177)", () => {
  // Failing shape before the fix, stated up front: Google's raw
  // "Unable to parse range: Ghost!A1:A100" surfaced verbatim, so the
  // 'No sheet named' assertion below FAILED. The two pass-through cases
  // are the positive controls in the same run: they prove this seam does
  // not swallow other errors into a wrong missing-tab claim.
  it("names the tabs the spreadsheet actually has", async () => {
    const { client } = fakeClient([
      { throws: "Unable to parse range: Ghost!A1:A100" },
      {
        data: {
          sheets: [
            { properties: { sheetId: 0, title: "Data" } },
            { properties: { sheetId: 1, title: "Archive" } },
          ],
        },
      },
    ]);
    await expect(
      handleSheetsRows(client, "sheets_find_rows", {
        spreadsheet_id: "sheet-1",
        range: "Ghost!A1:A100",
        column: "A",
        values: ["x"],
      })
    ).rejects.toThrow(
      'No sheet named "Ghost" in this spreadsheet. Existing tabs: "Data", "Archive".'
    );
  });

  it("control: an unrelated Google error passes through untouched", async () => {
    const { client, calls } = fakeClient([
      { throws: "The caller does not have permission" },
    ]);
    await expect(
      handleSheetsRows(client, "sheets_find_rows", {
        spreadsheet_id: "sheet-1",
        range: "Data!A1:A100",
        column: "A",
        values: ["x"],
      })
    ).rejects.toThrow("The caller does not have permission");
    expect(calls).toHaveLength(1); // no tab-list lookup for a non-range error
  });

  it("control: an unparseable range whose tab EXISTS keeps the raw error", async () => {
    const { client } = fakeClient([
      { throws: "Unable to parse range: Data!A0:A" },
      { data: { sheets: [{ properties: { sheetId: 0, title: "Data" } }] } },
    ]);
    await expect(
      handleSheetsRows(client, "sheets_find_rows", {
        spreadsheet_id: "sheet-1",
        range: "Data!A0:A",
        column: "A",
        values: ["x"],
      })
    ).rejects.toThrow("Unable to parse range: Data!A0:A");
  });
});
