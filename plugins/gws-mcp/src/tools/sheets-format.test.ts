import { describe, expect, it } from "vitest";
import { MUTATE } from "./annotations.js";
import { handleSheetsFormat, sheetsFormatTools } from "./sheets-format.js";
import { fakeClient } from "./fake-client.test-helper.js";

/** The first tab is deliberately not id 0 anywhere in this file. */
const tabs = {
  data: {
    sheets: [
      {
        properties: {
          sheetId: 852183133,
          title: "Sheet1",
          gridProperties: { rowCount: 1000, columnCount: 26 },
        },
      },
      {
        properties: {
          sheetId: 1699353642,
          title: "Report",
          gridProperties: { rowCount: 200, columnCount: 8 },
        },
      },
    ],
  },
};

/** The requests of the single batchUpdate a handler emitted. */
const requestsOf = (calls: Array<Record<string, unknown>>, index = 1) =>
  (calls[index] as { jsonBody: { requests: Record<string, any>[] } }).jsonBody.requests;

describe("sheets_format_range", () => {
  it("converts A1 to 0-based end-exclusive indices against the right sheetId", async () => {
    const { client, calls } = fakeClient([tabs, { data: { replies: [{}] } }]);

    await handleSheetsFormat(client, "sheets_format_range", {
      spreadsheet_id: "sheet-1",
      formats: [{ ranges: ["Report!A2:C10"], bold: true }],
    });

    // One tab lookup, then exactly one batchUpdate.
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      service: "sheets",
      resource: "spreadsheets",
      method: "batchUpdate",
      params: { spreadsheetId: "sheet-1" },
    });
    expect(requestsOf(calls)[0].repeatCell.range).toEqual({
      sheetId: 1699353642,
      startRowIndex: 1,
      endRowIndex: 10,
      startColumnIndex: 0,
      endColumnIndex: 3,
    });
  });

  it("builds a fields mask naming ONLY what the caller set", async () => {
    // A mask is a licence to overwrite: anything it names and the body does
    // not carry is CLEARED. "userEnteredFormat(textFormat)" for a caller who
    // asked only for bold would destroy the font family and size on the cell.
    const { client, calls } = fakeClient([tabs, { data: { replies: [{}] } }]);

    await handleSheetsFormat(client, "sheets_format_range", {
      spreadsheet_id: "sheet-1",
      formats: [{ ranges: ["Sheet1!A1:D1"], bold: true, wrap: "WRAP" }],
    });

    const { cell, fields } = requestsOf(calls)[0].repeatCell;
    expect(cell).toEqual({
      userEnteredFormat: { textFormat: { bold: true }, wrapStrategy: "WRAP" },
    });
    expect(fields).toBe("userEnteredFormat(textFormat(bold),wrapStrategy)");
  });

  it("converts hex colours to the API's 0-to-1 floats", async () => {
    const { client, calls } = fakeClient([tabs, { data: { replies: [{}] } }]);

    await handleSheetsFormat(client, "sheets_format_range", {
      spreadsheet_id: "sheet-1",
      formats: [
        { ranges: ["Sheet1!A1:D1"], background_color: "#FFFFFF", text_color: "#000000" },
      ],
    });

    const { cell, fields } = requestsOf(calls)[0].repeatCell;
    expect(cell.userEnteredFormat.backgroundColor).toEqual({ red: 1, green: 1, blue: 1 });
    expect(cell.userEnteredFormat.textFormat.foregroundColor).toEqual({
      red: 0,
      green: 0,
      blue: 0,
    });
    expect(fields).toBe("userEnteredFormat(backgroundColor,textFormat(foregroundColor))");
  });

  it("applies many ranges and many instructions in ONE atomic batch", async () => {
    // This is the unit of work: a whole formatting pass is one call, and the
    // endpoint's atomicity means it either all lands or none of it does.
    const { client, calls } = fakeClient([tabs, { data: { replies: [{}, {}, {}] } }]);

    await handleSheetsFormat(client, "sheets_format_range", {
      spreadsheet_id: "sheet-1",
      formats: [
        { ranges: ["Sheet1!A1:D1", "Sheet1!A20:D20"], bold: true },
        { ranges: ["Sheet1!A2:D19"], wrap: "WRAP" },
      ],
    });

    expect(calls).toHaveLength(2);
    const requests = requestsOf(calls);
    expect(requests).toHaveLength(3);
    expect(requests.map((r) => r.repeatCell.range.startRowIndex)).toEqual([0, 19, 1]);
  });

  it("emits a mergeCells request alongside the format when merge is set", async () => {
    const { client, calls } = fakeClient([tabs, { data: { replies: [{}, {}] } }]);

    await handleSheetsFormat(client, "sheets_format_range", {
      spreadsheet_id: "sheet-1",
      formats: [{ ranges: ["Sheet1!A1:D1"], bold: true, merge: true }],
    });

    const requests = requestsOf(calls);
    expect(requests[1].mergeCells).toEqual({
      range: {
        sheetId: 852183133,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: 4,
      },
      mergeType: "MERGE_ALL",
    });
  });

  it("wraps a number format in the object the API expects", async () => {
    const { client, calls } = fakeClient([tabs, { data: { replies: [{}] } }]);

    await handleSheetsFormat(client, "sheets_format_range", {
      spreadsheet_id: "sheet-1",
      formats: [{ ranges: ["Sheet1!C2:C50"], number_format: "#,##0.00" }],
    });

    const { cell, fields } = requestsOf(calls)[0].repeatCell;
    expect(cell.userEnteredFormat.numberFormat).toEqual({
      type: "NUMBER",
      pattern: "#,##0.00",
    });
    expect(fields).toBe("userEnteredFormat(numberFormat(type,pattern))");
  });

  it.each([
    ["yyyy-mm-dd", "DATE"],
    ["hh:mm", "TIME"],
    ["yyyy-mm-dd hh:mm", "DATE_TIME"],
    ["0.0%", "PERCENT"],
    ["$#,##0.00", "CURRENCY"],
    ["#,##0", "NUMBER"],
  ])("infers the number format TYPE from the pattern %s", async (pattern, type) => {
    // The API requires a type alongside the pattern, and a caller who writes
    // "yyyy-mm-dd" is not thinking about enum values. The inference is a
    // heuristic over the pattern's tokens; whether each type renders as
    // expected is what the live smoke verifies, not this test.
    const { client, calls } = fakeClient([tabs, { data: { replies: [{}] } }]);

    await handleSheetsFormat(client, "sheets_format_range", {
      spreadsheet_id: "sheet-1",
      formats: [{ ranges: ["Sheet1!C2"], number_format: pattern }],
    });

    expect(requestsOf(calls)[0].repeatCell.cell.userEnteredFormat.numberFormat).toEqual({
      type,
      pattern,
    });
  });

  it("reports requests as SENT, because a reply is an acceptance and not an application", async () => {
    const { client } = fakeClient([tabs, { data: { replies: [{}] } }]);

    const result = await handleSheetsFormat(client, "sheets_format_range", {
      spreadsheet_id: "sheet-1",
      formats: [{ ranges: ["Sheet1!A1"], bold: true }],
    });

    const body = JSON.parse(result.content[0].text);
    expect(body).toHaveProperty("requestsSent", 1);
    expect(body).not.toHaveProperty("requestsApplied");
  });

  it("refuses an instruction that sets no properties, instead of a no-op batch", async () => {
    // An empty batch succeeds and does nothing, which is the worst possible
    // answer: it reports success for work that never happened.
    const { client } = fakeClient([tabs]);

    await expect(
      handleSheetsFormat(client, "sheets_format_range", {
        spreadsheet_id: "sheet-1",
        formats: [{ ranges: ["Sheet1!A1:D1"] }],
      })
    ).rejects.toThrow(/no formatting properties/i);
  });

  it("rejects an empty formats array rather than reporting a successful no-op", async () => {
    const { client } = fakeClient([]);

    await expect(
      handleSheetsFormat(client, "sheets_format_range", {
        spreadsheet_id: "sheet-1",
        formats: [],
      })
    ).rejects.toThrow(/at least one/i);
  });

  it("is pinned to the mutating annotation shape", () => {
    const tool = sheetsFormatTools.find((t) => t.name === "sheets_format_range");
    expect(tool?.annotations).toEqual(
      MUTATE("Change the formatting of spreadsheet cells")
    );
    expect(tool?.inputSchema.required).toEqual(["spreadsheet_id", "formats"]);
  });
});

describe("sheets_format_table", () => {
  const runTable = async (args: Record<string, unknown>) => {
    const { client, calls } = fakeClient([tabs, { data: { replies: [] } }]);
    await handleSheetsFormat(client, "sheets_format_table", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!A1:D40",
      ...args,
    });
    return requestsOf(calls);
  };

  it("does the whole readable-by-default pass in one atomic batch", async () => {
    const { client, calls } = fakeClient([tabs, { data: { replies: [] } }]);

    await handleSheetsFormat(client, "sheets_format_table", {
      spreadsheet_id: "sheet-1",
      range: "Sheet1!A1:D40",
    });

    expect(calls).toHaveLength(2);
    const kinds = requestsOf(calls).map((r) => Object.keys(r)[0]);
    expect(kinds).toContain("updateDimensionProperties");
    expect(kinds).toContain("repeatCell");
    expect(kinds).toContain("updateSheetProperties");
  });

  it("sets column widths, because the 100px default is where truncation comes from", async () => {
    const requests = await runTable({ column_widths: [250, 400] });
    const widths = requests
      .filter((r) => r.updateDimensionProperties)
      .map((r) => [
        r.updateDimensionProperties.range.startIndex,
        r.updateDimensionProperties.range.endIndex,
        r.updateDimensionProperties.properties.pixelSize,
      ]);
    // Two named columns, then the remaining two at the default width.
    expect(widths).toEqual([
      [0, 1, 250],
      [1, 2, 400],
      [2, 4, 200],
    ]);
    expect(
      requests.find((r) => r.updateDimensionProperties)!.updateDimensionProperties.fields
    ).toBe("pixelSize");
  });

  it("NEVER sets a row height on wrapped content", async () => {
    // A fixed pixelSize overrides auto-fit and re-clips the text that wrapping
    // just unclipped, so the tool must not "helpfully" set one.
    const requests = await runTable({});
    const rowHeights = requests.filter(
      (r) => r.updateDimensionProperties?.range?.dimension === "ROWS"
    );
    expect(rowHeights).toEqual([]);
  });

  it("freezes rows and leaves frozenColumnCount at 0", async () => {
    // A frozen column makes a later merge across it illegal and takes the
    // whole atomic batch down with it. Freezing rows only removes the
    // collision entirely, and vertical is the scroll that actually happens.
    const requests = await runTable({});
    const props = requests.find((r) => r.updateSheetProperties)!.updateSheetProperties;
    expect(props.properties.gridProperties).toMatchObject({
      frozenRowCount: 1,
      frozenColumnCount: 0,
    });
    expect(props.properties.sheetId).toBe(852183133);
  });

  it("freezes through however many header rows there are", async () => {
    const requests = await runTable({ header_rows: 2 });
    const props = requests.find((r) => r.updateSheetProperties)!.updateSheetProperties;
    expect(props.properties.gridProperties.frozenRowCount).toBe(2);
  });

  it("styles the header band over exactly the header rows", async () => {
    const requests = await runTable({ header_rows: 2 });
    const header = requests.find(
      (r) => r.repeatCell?.cell?.userEnteredFormat?.textFormat?.bold
    )!.repeatCell;
    expect(header.range).toMatchObject({ startRowIndex: 0, endRowIndex: 2 });
  });

  it("writes no header request at all when header_rows is 0", async () => {
    const requests = await runTable({ header_rows: 0 });
    expect(
      requests.some((r) => r.repeatCell?.cell?.userEnteredFormat?.textFormat?.bold)
    ).toBe(false);
    expect(requests.some((r) => r.updateSheetProperties)).toBe(false);
  });

  it("uses NEUTRAL default colours, not anyone's brand", async () => {
    // This formats other people's spreadsheets. A branded default would be
    // wrong in someone else's document and wrong to hard-code here.
    const requests = await runTable({});
    const header = requests.find(
      (r) => r.repeatCell?.cell?.userEnteredFormat?.textFormat?.bold
    )!.repeatCell;
    const { red, green, blue } = header.cell.userEnteredFormat.backgroundColor;
    expect(red).toBe(green);
    expect(green).toBe(blue);
  });

  it("puts trim_grid FIRST, because dimension deletes shift every later index", async () => {
    // Everything else here is index-stable. deleteDimension is not, so if it
    // ran after the formatting requests every one of them would be off.
    const requests = await runTable({ trim_grid: true });
    expect(Object.keys(requests[0])[0]).toBe("deleteDimension");
    const deletes = requests.filter((r) => r.deleteDimension);
    // Columns beyond D and rows beyond 40, each from the range's own end.
    // Bounded by the grid's real size rather than left open: an endIndex past
    // the true count is an API error, and an omitted one relies on behaviour
    // nothing here has exercised live.
    expect(deletes.map((r) => r.deleteDimension.range)).toEqual([
      { sheetId: 852183133, dimension: "COLUMNS", startIndex: 4, endIndex: 26 },
      { sheetId: 852183133, dimension: "ROWS", startIndex: 40, endIndex: 1000 },
    ]);
  });

  it("sets default widths across the WHOLE grid for an unbounded range", async () => {
    // A bare tab name has no end column. Skipping widths because the bound is
    // missing silently drops the single highest-value change while reporting
    // success; the grid's real extent comes from the same single tab fetch.
    const { client, calls } = fakeClient([tabs, { data: { replies: [] } }]);

    await handleSheetsFormat(client, "sheets_format_table", {
      spreadsheet_id: "sheet-1",
      range: "Report",
      column_widths: [250],
    });

    const widths = requestsOf(calls)
      .filter((r) => r.updateDimensionProperties)
      .map((r) => r.updateDimensionProperties.range);
    expect(widths).toEqual([
      { sheetId: 1699353642, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
      { sheetId: 1699353642, dimension: "COLUMNS", startIndex: 1, endIndex: 8 },
    ]);
  });

  it("skips a trim that has nothing to trim instead of failing the whole batch", async () => {
    // deleteDimension at startIndex == the grid's size is an API error, and
    // the batch is atomic, so a no-op trim would take the entire formatting
    // pass down with it. Report has 8 columns and 200 rows.
    const { client, calls } = fakeClient([tabs, { data: { replies: [] } }]);

    await handleSheetsFormat(client, "sheets_format_table", {
      spreadsheet_id: "sheet-1",
      range: "Report!A1:H200",
      trim_grid: true,
    });

    expect(requestsOf(calls).some((r) => r.deleteDimension)).toBe(false);
  });

  it("trims only the dimension that actually extends past the range", async () => {
    const { client, calls } = fakeClient([tabs, { data: { replies: [] } }]);

    await handleSheetsFormat(client, "sheets_format_table", {
      spreadsheet_id: "sheet-1",
      range: "Report!A1:D200",
      trim_grid: true,
    });

    const deletes = requestsOf(calls).filter((r) => r.deleteDimension);
    expect(deletes.map((r) => r.deleteDimension.range)).toEqual([
      { sheetId: 1699353642, dimension: "COLUMNS", startIndex: 4, endIndex: 8 },
    ]);
  });

  it("does not trim by default, because trimming destroys cells", async () => {
    const requests = await runTable({});
    expect(requests.some((r) => r.deleteDimension)).toBe(false);
  });

  it("cannot trim an unbounded range, and says so instead of guessing", async () => {
    // "Sheet1!A:D" has no end row. Guessing one would delete real rows.
    const { client } = fakeClient([tabs]);

    await expect(
      handleSheetsFormat(client, "sheets_format_table", {
        spreadsheet_id: "sheet-1",
        range: "Sheet1!A:D",
        trim_grid: true,
      })
    ).rejects.toThrow(/bounded range/i);
  });

  it("wraps and top-aligns the body, which is what makes long cells readable", async () => {
    const requests = await runTable({});
    const body = requests.find(
      (r) => r.repeatCell?.cell?.userEnteredFormat?.wrapStrategy === "WRAP"
    )!.repeatCell;
    expect(body.cell.userEnteredFormat).toMatchObject({
      wrapStrategy: "WRAP",
      verticalAlignment: "TOP",
    });
    expect(body.fields).toContain("wrapStrategy");
    expect(body.fields).toContain("padding");
  });

  it("skips wrapping when the caller turns it off", async () => {
    const requests = await runTable({ wrap: false });
    expect(
      requests.some((r) => r.repeatCell?.cell?.userEnteredFormat?.wrapStrategy)
    ).toBe(false);
  });

  it("is pinned to the mutating annotation shape", () => {
    const tool = sheetsFormatTools.find((t) => t.name === "sheets_format_table");
    expect(tool?.annotations).toEqual(
      MUTATE("Reformat a spreadsheet table for readability")
    );
    expect(tool?.inputSchema.required).toEqual(["spreadsheet_id", "range"]);
  });
});

describe("enum values nested inside formats", () => {
  // The boundary validator enforces the schema it advertises, and that schema
  // says a formats entry is an object. So nothing upstream checks these, and
  // without this the error arrives from Google about a request the caller
  // never wrote.
  it.each([
    ["wrap", "wrap"],
    ["horizontal_align", "left"],
    ["vertical_align", "top"],
  ])("rejects a bad %s in the caller's own vocabulary", async (field, bad) => {
    const { client } = fakeClient([tabs]);

    await expect(
      handleSheetsFormat(client, "sheets_format_range", {
        spreadsheet_id: "sheet-1",
        formats: [{ ranges: ["Sheet1!A1"], [field]: bad }],
      })
    ).rejects.toThrow(
      new RegExp(`formats\\[0\\]\\.${field} must be one of .*received "${bad}"`)
    );
  });
});

describe("wrap strategy maps to the Sheets API enum", () => {
  // The bug this guards: "OVERFLOW" passed this module's own validation and
  // was then forwarded verbatim, but the API enum is OVERFLOW_CELL, so the
  // one value most callers reach for could never work. CLIP and WRAP only
  // worked because they happen to match the API's spelling.
  it("sends OVERFLOW_CELL when the caller asks for OVERFLOW", async () => {
    const { client, calls } = fakeClient([tabs, { data: { replies: [{}] } }]);
    await handleSheetsFormat(client, "sheets_format_range", {
      spreadsheet_id: "sheet-1",
      formats: [{ ranges: ["Report!A1:C1"], wrap: "OVERFLOW" }],
    });
    const fmt = requestsOf(calls)[0].repeatCell.cell.userEnteredFormat;
    expect(fmt.wrapStrategy).toBe("OVERFLOW_CELL");
  });

  it("passes CLIP and WRAP through unchanged", async () => {
    for (const value of ["CLIP", "WRAP"]) {
      const { client, calls } = fakeClient([tabs, { data: { replies: [{}] } }]);
      await handleSheetsFormat(client, "sheets_format_range", {
        spreadsheet_id: "sheet-1",
        formats: [{ ranges: ["Report!A1:C1"], wrap: value }],
      });
      const fmt = requestsOf(calls)[0].repeatCell.cell.userEnteredFormat;
      expect(fmt.wrapStrategy).toBe(value);
    }
  });

  it("never forwards a wrap value the API does not define", async () => {
    // Guards the whole class rather than the one value: every accepted name
    // must land on a real WrapStrategy member.
    const API_VALUES = new Set(["OVERFLOW_CELL", "LEGACY_WRAP", "CLIP", "WRAP"]);
    for (const value of ["OVERFLOW", "CLIP", "WRAP"]) {
      const { client, calls } = fakeClient([tabs, { data: { replies: [{}] } }]);
      await handleSheetsFormat(client, "sheets_format_range", {
        spreadsheet_id: "sheet-1",
        formats: [{ ranges: ["Report!A1:C1"], wrap: value }],
      });
      const fmt = requestsOf(calls)[0].repeatCell.cell.userEnteredFormat;
      expect(API_VALUES.has(fmt.wrapStrategy)).toBe(true);
    }
  });
});
