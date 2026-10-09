import { describe, expect, it } from "vitest";
import { fakeClient, payload } from "./fake-client.test-helper.js";
import { buildQueryUrl, handleSheetsQuery, parseGvizBody, rewriteColumnNames, sheetsQueryTools } from "./sheets-query.js";
import { READ } from "./annotations.js";
import { allTools, toolHandlers } from "./index.js";

/* SCRUM-261: a filtered read is one call. The Visualization query endpoint
 * answers a QUERY()-language query with a JSONP-wrapped table; the tool
 * turns that into header, rows and a count, and turns its errors into
 * ones that name the column. */

const wrap = (json: unknown) => `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify(json)});`;

const TABLE = {
  version: "0.6",
  status: "ok",
  sig: "1",
  table: {
    cols: [
      { id: "A", label: "Task", type: "string" },
      { id: "C", label: "Priority", type: "number" },
      { id: "F", label: "Due", type: "date", pattern: "yyyy-MM-dd" },
    ],
    rows: [
      { c: [{ v: "Renew cert" }, { v: 3, f: "3" }, { v: "Date(2026,8,12)", f: "2026-09-12" }] },
      { c: [{ v: "Ship 261" }, { v: 2, f: "2" }, null] },
      { c: [{ v: "Write notes" }, { v: 1, f: "1" }, { v: null }] },
    ],
  },
};

/** The tab list every call that names a tab reads first (SCRUM-369). */
const TABS = {
  data: {
    sheets: [
      { properties: { sheetId: 11, title: "First" } },
      { properties: { sheetId: 12, title: "Tasks" } },
      { properties: { sheetId: 13, title: "Tab" } },
    ],
  },
};

describe("sheets_query (SCRUM-261)", () => {
  it("is a read tool, registered and dispatched like the rest", () => {
    const tool = sheetsQueryTools.find((t) => t.name === "sheets_query");
    expect(tool?.annotations).toEqual(READ("Query a spreadsheet"));
    expect(tool?.inputSchema.required).toEqual(["spreadsheet_id", "query"]);
    expect(allTools.some((t) => t.name === "sheets_query")).toBe(true);
    expect(toolHandlers.get("sheets_query")).toBe(handleSheetsQuery);
  });

  it("select with where and order by returns the subset in the order the endpoint gave, header first", async () => {
    const { client, calls } = fakeClient([TABS, { text: wrap(TABLE) }]);
    const result = payload(
      await handleSheetsQuery(client, "sheets_query", {
        spreadsheet_id: "s",
        range: "Tasks",
        query: "select A, C, F where C > 0 order by C desc",
      })
    );
    // The tab list, then the one query.
    expect(calls).toHaveLength(2);
    const url = new URL(calls[1].url as string);
    expect(url.origin + url.pathname).toBe("https://docs.google.com/spreadsheets/d/s/gviz/tq");
    expect(url.searchParams.get("tq")).toBe("select A, C, F where C > 0 order by C desc");
    expect(url.searchParams.get("tqx")).toBe("out:json");
    expect(url.searchParams.get("headers")).toBe("1");
    expect(url.searchParams.get("sheet")).toBe("Tasks");
    expect(url.searchParams.has("range")).toBe(false);
    expect(result).toEqual({
      query: "select A, C, F where C > 0 order by C desc",
      header: ["Task", "Priority", "Due"],
      rowCount: 3,
      // Dates come back as the formatted text, not the Date(...) form; an
      // empty cell is an empty string so every row has every column.
      rows: [
        ["Renew cert", 3, "2026-09-12"],
        ["Ship 261", 2, ""],
        ["Write notes", 1, ""],
      ],
    });
  });

  it("group by with count returns the aggregate columns, labelled as the endpoint labels them", async () => {
    const { client } = fakeClient([
      {
        text: wrap({
          status: "ok",
          table: {
            cols: [
              { id: "B", label: "Status", type: "string" },
              { id: "count-A", label: "count Task", type: "number" },
            ],
            rows: [
              { c: [{ v: "open" }, { v: 12, f: "12" }] },
              { c: [{ v: "done" }, { v: 30, f: "30" }] },
            ],
          },
        }),
      },
    ]);
    const result = payload(
      await handleSheetsQuery(client, "sheets_query", { spreadsheet_id: "s", query: "select B, count(A) group by B" })
    );
    expect(result.header).toEqual(["Status", "count Task"]);
    expect(result.rows).toEqual([["open", 12], ["done", 30]]);
    expect(result.rowCount).toBe(2);
  });

  it("a query naming a column outside the range is a structured error naming the column", async () => {
    const { client } = fakeClient([
      TABS,
      {
        text: wrap({
          status: "error",
          errors: [
            {
              reason: "invalid_query",
              message: "INVALID_QUERY",
              detailed_message: "Invalid query: NO_COLUMN: Z",
            },
          ],
        }),
      },
    ]);
    await expect(
      handleSheetsQuery(client, "sheets_query", { spreadsheet_id: "s", range: "Tasks!A1:F500", query: "select Z" })
    ).rejects.toThrow(/column Z, which is outside the range Tasks!A1:F500/);
  });

  it("an empty result is an empty rows array with the header, never a bare string", async () => {
    const { client } = fakeClient([
      { text: wrap({ status: "ok", table: { cols: [{ id: "A", label: "Task", type: "string" }], rows: [] } }) },
    ]);
    const result = payload(await handleSheetsQuery(client, "sheets_query", { spreadsheet_id: "s", query: "select A where A = 'nothing'" }));
    expect(result).toEqual({ query: "select A where A = 'nothing'", header: ["Task"], rowCount: 0, rows: [] });
  });

  it("puts a tab and a block on the URL separately, and turns headers off when told", () => {
    const url = new URL(buildQueryUrl("s", "select A", "Tasks!A1:F500", false));
    expect(url.searchParams.get("sheet")).toBe("Tasks");
    expect(url.searchParams.get("range")).toBe("A1:F500");
    expect(url.searchParams.get("headers")).toBe("0");
    const bare = new URL(buildQueryUrl("s", "select A", "A1:B9", true));
    expect(bare.searchParams.has("sheet")).toBe(false);
    expect(bare.searchParams.get("range")).toBe("A1:B9");
    const quoted = new URL(buildQueryUrl("s", "select A", "'Q3 Plan'!A:D", true));
    expect(quoted.searchParams.get("sheet")).toBe("Q3 Plan");
  });

  it("explains a refusal and a missing spreadsheet, and rejects an answer that is not a table", async () => {
    const forbidden = fakeClient([{ status: 403, text: "<html>login</html>" }]);
    await expect(handleSheetsQuery(forbidden.client, "sheets_query", { spreadsheet_id: "s", query: "select A" })).rejects.toThrow(
      /refused the request \(403\)/
    );
    const missing = fakeClient([{ status: 404, text: "" }]);
    await expect(handleSheetsQuery(missing.client, "sheets_query", { spreadsheet_id: "s", query: "select A" })).rejects.toThrow(
      /no spreadsheet with that ID/
    );
    expect(() => parseGvizBody("<html>not a table</html>")).toThrow(/did not answer with a table/);
    const blank = fakeClient([]);
    await expect(handleSheetsQuery(blank.client, "sheets_query", { spreadsheet_id: "s", query: "   " })).rejects.toThrow(
      /query must not be blank/
    );
  });
});

/* SCRUM-268: Col1, Col2 is QUERY()'s array column form, which the endpoint
 * does not know. The tool maps it onto the range's columns before sending,
 * and a NO_COLUMN error names the column exactly as the endpoint gave it. */

const OK = { text: wrap({ status: "ok", table: { cols: [{ id: "B", label: "Task", type: "string" }], rows: [] } }) };
const noColumn = (name: string) => ({
  text: wrap({
    status: "error",
    errors: [{ reason: "invalid_query", message: "INVALID_QUERY", detailed_message: `Invalid query: NO_COLUMN: ${name}` }],
  }),
});

describe("sheets_query Col1-style names (SCRUM-268)", () => {
  it("maps Col<n> to the sheet letter counted from the range's first column, sends it, and echoes it", async () => {
    const { client, calls } = fakeClient([TABS, OK]);
    const result = payload(
      await handleSheetsQuery(client, "sheets_query", {
        spreadsheet_id: "s",
        range: "Tab!B1:F9",
        query: "select Col1, Col3 where Col2 = 'x'",
      })
    );
    const url = new URL(calls[1].url as string);
    expect(url.searchParams.get("tq")).toBe("select B, D where C = 'x'");
    expect(url.searchParams.get("range")).toBe("B1:F9");
    expect(result.query).toBe("select B, D where C = 'x'");
  });

  it("leaves Col1 inside a string literal alone, in either quote", () => {
    expect(rewriteColumnNames("select Col1 where Col2 = 'Col1' or Col2 = \"col3\"", "Tab!C1:F9")).toBe(
      "select C where D = 'Col1' or D = \"col3\""
    );
  });

  it("with no range block Col1 is A, and lower case maps too", () => {
    expect(rewriteColumnNames("select col2, COL1", undefined)).toBe("select B, A");
    expect(rewriteColumnNames("select Col1", "Tasks")).toBe("select A");
    expect(rewriteColumnNames("select Col27 label Col1 'n'", "Tasks")).toBe("select AA label A 'n'");
    // A column past Z counts on from a two-letter start, and a row-only block starts at A.
    expect(rewriteColumnNames("select Col2", "Tab!AZ1:BC9")).toBe("select BA");
    expect(rewriteColumnNames("select Col3", "Tab!2:9")).toBe("select C");
  });

  it("does not touch what is not a whole Col<n> word, so a query that works today is sent unchanged", () => {
    const q = "select A, B where Column1 = 1 and xCol1 = 2 and Col1_a = 3 and C > 0";
    expect(rewriteColumnNames(q, "Tab!A1:F9")).toBe(q);
    expect(new URL(buildQueryUrl("s", "select A", "Tab!A1:F9", true)).searchParams.get("tq")).toBe("select A");
  });

  it("refuses a Col<n> past the range's last column before any request, naming the column it would be", async () => {
    const { client, calls } = fakeClient([]);
    await expect(
      handleSheetsQuery(client, "sheets_query", { spreadsheet_id: "s", range: "A1:F500", query: "select Col9" })
    ).rejects.toThrow(/Col9 would be column I, past the last column F of the range A1:F500/);
    expect(calls).toHaveLength(0);
  });

  it("refuses Col0, naming the range's first column", async () => {
    const { client, calls } = fakeClient([TABS]);
    await expect(
      handleSheetsQuery(client, "sheets_query", { spreadsheet_id: "s", range: "Tab!C1:F9", query: "select Col0" })
    ).rejects.toThrow(/Col0 names no column; Col1 is the first column of the range, C/);
    // The tab was looked up; the query itself was never sent.
    expect(calls.some((c) => "url" in c)).toBe(false);
  });

  it("a real letter outside the range keeps the existing message", async () => {
    const { client } = fakeClient([noColumn("Z")]);
    await expect(
      handleSheetsQuery(client, "sheets_query", { spreadsheet_id: "s", range: "A1:F500", query: "select Z" })
    ).rejects.toThrow(/column Z, which is outside the range A1:F500/);
  });

  it("a NO_COLUMN name with digits or underscores is named whole, as a bad id rather than a range problem", async () => {
    const { client } = fakeClient([noColumn("Status_2")]);
    const err = handleSheetsQuery(client, "sheets_query", { spreadsheet_id: "s", range: "A1:F500", query: "select Status_2" });
    await expect(err).rejects.toThrow(/names column Status_2, which is not a column id/);
    await expect(err).rejects.not.toThrow(/outside the range/);
  });
});

/* SCRUM-289 follow-up. The id becomes a path segment on docs.google.com, the
 * one host outside the API that takes the token. Encoding keeps it on that
 * host, but ".." still moves the request to another path there, so the id
 * is held to the alphabet Google's ids are written in. */
describe("sheets_query refuses a spreadsheet id that is not an id", () => {
  it.each([[".."], ["."], ["a/b"], ["a?b"], ["a#b"], ["a b"], ["%2e%2e"], [""], [42], [undefined]])(
    "%j is refused before any request",
    async (spreadsheet_id) => {
      const { client, calls } = fakeClient([{ text: "unused" }]);
      await expect(handleSheetsQuery(client, "sheets_query", { spreadsheet_id, query: "select A" })).rejects.toThrow(
        /spreadsheet_id must be the ID from the spreadsheet's URL/
      );
      expect(calls).toHaveLength(0);
    }
  );

  it("an id with every allowed character still goes out, unchanged", async () => {
    const { client, calls } = fakeClient([{ text: wrap(TABLE) }]);
    await handleSheetsQuery(client, "sheets_query", { spreadsheet_id: "Ab3_x-Yz9", query: "select A" });
    expect(String(calls[0].url)).toContain("/spreadsheets/d/Ab3_x-Yz9/gviz/tq");
  });
});
