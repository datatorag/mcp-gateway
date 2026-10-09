import { describe, expect, it } from "vitest";
import {
  a1ToGridBounds,
  columnIndexToLetter,
  columnLetterToIndex,
  fieldsMask,
  gridRangeResolver,
  hexToRgbColor,
  splitRange,
} from "./sheets-grid.js";
import { fakeClient } from "./fake-client.test-helper.js";

/**
 * A1 is 1-based and end-inclusive. A GridRange is 0-BASED and END-EXCLUSIVE.
 * Callers speak both conventions in the same task, minutes apart, and an
 * off-by-one here does not error — it styles the wrong row and looks
 * deliberate. So the conversion is pinned at boundaries rather than sampled in
 * the middle: row 1, the last row, the first column and the last column.
 */
describe("a1ToGridBounds", () => {
  it.each([
    ["A1:D10", { startRowIndex: 0, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 4 }],
    ["A2:D10", { startRowIndex: 1, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 4 }],
    ["B7:B7", { startRowIndex: 6, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 2 }],
    ["A5", { startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 1 }],
    ["AA1:AB2", { startRowIndex: 0, endRowIndex: 2, startColumnIndex: 26, endColumnIndex: 28 }],
  ])("%s converts to 0-based end-exclusive bounds", (cells, expected) => {
    expect(a1ToGridBounds(cells)).toEqual(expected);
  });

  it("omits the row bounds for a whole-column range, rather than guessing them", () => {
    // An omitted side is what the API reads as "to the end of the sheet".
    // Filling in a guess (0 to 1000) would silently stop matching the moment
    // the sheet grew.
    expect(a1ToGridBounds("A:A")).toEqual({ startColumnIndex: 0, endColumnIndex: 1 });
  });

  it("omits the column bounds for a whole-row range", () => {
    expect(a1ToGridBounds("2:2")).toEqual({ startRowIndex: 1, endRowIndex: 2 });
  });

  it("returns no bounds at all for an empty cell part, meaning the whole sheet", () => {
    expect(a1ToGridBounds("")).toEqual({});
  });

  it("normalises a reversed range instead of rejecting it", () => {
    // Sheets accepts D10:A1 in A1 notation, so rejecting it here would be a
    // new failure mode on input that works everywhere else.
    expect(a1ToGridBounds("D10:A1")).toEqual(a1ToGridBounds("A1:D10"));
  });

  it("rejects row 0, which does not exist and would become index -1", () => {
    // A1 rows start at 1. "A0" is not a typo the API corrects, it is a
    // negative GridRange index that either errors opaquely or, worse, is
    // clamped to something the caller did not ask for.
    expect(() => a1ToGridBounds("A0")).toThrow(/row 0/i);
    expect(() => a1ToGridBounds("A0:B2")).toThrow(/row 0/i);
    expect(() => a1ToGridBounds("0:0")).toThrow(/row 0/i);
  });

  it("throws on an unparseable range instead of returning empty bounds", () => {
    // Empty bounds mean THE WHOLE SHEET. Falling back to them on garbage
    // input would turn a typo into a spreadsheet-wide formatting change.
    expect(() => a1ToGridBounds("A1:D10:E5")).toThrow(/could not be read/i);
    expect(() => a1ToGridBounds("!!!")).toThrow(/could not be read/i);
  });
});

describe("column letters", () => {
  it.each([
    ["A", 0],
    ["Z", 25],
    ["AA", 26],
    ["AB", 27],
    ["ZZ", 701],
  ])("%s is index %i", (letter, index) => {
    expect(columnLetterToIndex(letter)).toBe(index);
    expect(columnIndexToLetter(index)).toBe(letter);
  });

  it("is case-insensitive on the way in", () => {
    expect(columnLetterToIndex("ab")).toBe(27);
  });
});

describe("gridRangeResolver", () => {
  // The first tab is deliberately NOT id 0 in every fixture here. A fixture
  // where it happened to be 0 would let a resolver that hardcodes 0 pass.
  const threeTabs = {
    data: {
      sheets: [
        { properties: { sheetId: 852183133, title: "Sheet1" } },
        { properties: { sheetId: 1699353642, title: "Q3 Data" } },
        { properties: { sheetId: 675874145, title: "Notes" } },
      ],
    },
  };

  it("resolves a tab-prefixed range to that tab's real sheetId", async () => {
    const { client } = fakeClient([threeTabs]);
    const resolve = await gridRangeResolver(client, "sheet-1");
    expect(resolve("'Q3 Data'!A2:C5")).toEqual({
      sheetId: 1699353642,
      startRowIndex: 1,
      endRowIndex: 5,
      startColumnIndex: 0,
      endColumnIndex: 3,
    });
  });

  it("NEVER defaults an unprefixed range to sheetId 0", async () => {
    // sheetId 0 is an arbitrary identifier, not "the first tab". Defaulting to
    // it writes formatting to whichever tab happens to hold that id, or fails
    // in a way indistinguishable from a bad range.
    const { client } = fakeClient([threeTabs]);
    const resolve = await gridRangeResolver(client, "sheet-1");
    expect(resolve("A1:B2").sheetId).toBe(852183133);
  });

  it("treats a bare tab name as the whole of that tab", async () => {
    const { client } = fakeClient([threeTabs]);
    const resolve = await gridRangeResolver(client, "sheet-1");
    expect(resolve("Notes")).toEqual({ sheetId: 675874145 });
  });

  it("reads the tab list ONCE however many ranges are resolved", async () => {
    // One spreadsheets.get per tool call, not per range. A tool formatting
    // eight ranges must not make nine API calls to do it.
    const { client, calls } = fakeClient([threeTabs]);
    const resolve = await gridRangeResolver(client, "sheet-1");
    resolve("Sheet1!A1");
    resolve("Notes!B2:C3");
    resolve("'Q3 Data'!A:A");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      service: "sheets",
      resource: "spreadsheets",
      method: "get",
    });
  });

  it("names the missing tab and lists the real ones", async () => {
    const { client } = fakeClient([threeTabs]);
    const resolve = await gridRangeResolver(client, "sheet-1");
    expect(() => resolve("Inventory!A1")).toThrow(
      'No sheet named "Inventory" in this spreadsheet. ' +
        'Existing tabs: "Sheet1", "Q3 Data", "Notes".'
    );
  });
});

describe("splitRange", () => {
  it("treats anything with a colon as cells, never as a tab name", () => {
    // "A1:" is a broken range, not a tab called "A1:". Routing it to a tab
    // lookup produces a "no sheet named A1:" error that sends the caller off
    // to check their tab list instead of their range.
    expect(() => a1ToGridBounds(splitRange("A1:").cells)).toThrow(/could not be read/i);
    expect(() => a1ToGridBounds(splitRange(":D10").cells)).toThrow(/could not be read/i);
    expect(splitRange("A1:")).toEqual({ cells: "A1:" });
  });

  it("reads a bare tab name, a quoted one, and a name with spaces", () => {
    expect(splitRange("Inventory")).toEqual({ tab: "Inventory", cells: "" });
    expect(splitRange("'Q3'")).toEqual({ tab: "Q3", cells: "" });
    expect(splitRange("Data 2026")).toEqual({ tab: "Data 2026", cells: "" });
  });
});

describe("gridRangeResolver grid sizes", () => {
  it("exposes each tab's real row and column count from the same single fetch", async () => {
    // Formatting an unbounded range needs the grid's actual extent, and a
    // second API call to get it would break the one-lookup-per-call rule.
    const { client, calls } = fakeClient([
      {
        data: {
          sheets: [
            {
              properties: {
                sheetId: 852183133,
                title: "Sheet1",
                gridProperties: { rowCount: 1000, columnCount: 26 },
              },
            },
          ],
        },
      },
    ]);
    const resolve = await gridRangeResolver(client, "sheet-1");
    expect(resolve.gridSize(852183133)).toEqual({ rowCount: 1000, columnCount: 26 });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { params: { fields: string } }).params.fields).toContain("gridProperties");
  });
});

describe("hexToRgbColor", () => {
  it("converts to the API's 0-to-1 floats, which is what nobody remembers to do", () => {
    expect(hexToRgbColor("#FFFFFF")).toEqual({ red: 1, green: 1, blue: 1 });
    expect(hexToRgbColor("#000000")).toEqual({ red: 0, green: 0, blue: 0 });
  });

  it("accepts the hash or no hash, and either case", () => {
    expect(hexToRgbColor("ff0000")).toEqual(hexToRgbColor("#FF0000"));
  });

  it("rejects anything that is not six hex digits", () => {
    // A silently-wrong colour is invisible in the reply and only shows up in
    // the render, so this fails at the boundary instead.
    expect(() => hexToRgbColor("blue")).toThrow(/#RRGGBB/);
    expect(() => hexToRgbColor("#FFF")).toThrow(/#RRGGBB/);
  });
});

describe("fieldsMask", () => {
  it("names only the leaves that were actually set", () => {
    // A mask listing a property the caller never set WIPES that property.
    // "userEnteredFormat(textFormat)" when only bold was asked for destroys
    // the font family and size already on the cell, so the mask is computed
    // from the built object and is never a constant.
    expect(
      fieldsMask({ userEnteredFormat: { textFormat: { bold: true }, wrapStrategy: "WRAP" } })
    ).toBe("userEnteredFormat(textFormat(bold),wrapStrategy)");
  });

  it("descends into nested objects", () => {
    expect(
      fieldsMask({ userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.0" } } })
    ).toBe("userEnteredFormat(numberFormat(type,pattern))");
  });

  it("treats colours and padding as whole values, matching the masks known to work", () => {
    // These are always sent complete, so naming their channels individually
    // buys nothing and is a mask form nothing here has exercised live. The
    // whole-value form is the one every measured recipe used.
    expect(
      fieldsMask({
        userEnteredFormat: {
          backgroundColor: { red: 1, green: 1, blue: 1 },
          padding: { top: 8, right: 12, bottom: 8, left: 12 },
          textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, bold: true },
        },
      })
    ).toBe("userEnteredFormat(backgroundColor,padding,textFormat(foregroundColor,bold))");
  });

  it("treats an array as a leaf rather than descending into its indices", () => {
    expect(fieldsMask({ properties: { values: [1, 2, 3] } })).toBe("properties(values)");
  });
});
