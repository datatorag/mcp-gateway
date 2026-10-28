import { describe, expect, it } from "vitest";
import { handleSheetsRows } from "./sheets-rows.js";
import { handleDocs } from "./docs.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";

/* SCRUM-456: a name a caller reaches for that is not the tool's, accepted as
 * the one it means, with the answer naming the argument it was read as. */

const table = {
  data: {
    range: "Sheet1!A1:B3",
    values: [
      ["Name", "Email"],
      ["Ana", "ana@example.com"],
      ["Bo", "bo@example.com"],
    ],
  },
};

const FIND = { spreadsheet_id: "sheet-1", range: "Sheet1!A1:B3", column: "Email" };

describe("sheets_find_rows: query is values with one value", () => {
  it("finds the row, and the answer names values as what query was read as", async () => {
    const { client } = fakeClient([table]);
    const out = payload(await handleSheetsRows(client, "sheets_find_rows", { ...FIND, query: "bo@example.com" }));
    expect(out.matches).toEqual([
      { value: "bo@example.com", rows: [expect.objectContaining({ row: 3 })] },
    ]);
    expect(out.aliased).toEqual({ query: "values" });
  });

  it("the same call with values carries no alias note", async () => {
    const { client } = fakeClient([table]);
    const out = payload(await handleSheetsRows(client, "sheets_find_rows", { ...FIND, values: ["bo@example.com"] }));
    expect(out.aliased).toBeUndefined();
  });

  it("refuses values and query together, and neither, before any request", async () => {
    const both = fakeClient([table]);
    await expect(
      handleSheetsRows(both.client, "sheets_find_rows", { ...FIND, values: ["a"], query: "b" })
    ).rejects.toThrow('give "values" or "query", not both');
    expect(both.calls).toHaveLength(0);

    const neither = fakeClient([table]);
    await expect(handleSheetsRows(neither.client, "sheets_find_rows", { ...FIND })).rejects.toThrow(
      'missing required parameter "values" (or "query")'
    );
    expect(neither.calls).toHaveLength(0);
  });
});

describe("docs_write: content is text", () => {
  it("writes the content as the text, and the answer names text", async () => {
    const { client, calls } = fakeClient([{ data: { documentId: "doc-1", replies: [{}] } }]);
    const out = payload(await handleDocs(client, "docs_write", { document_id: "doc-1", content: "hello" }));
    expect(calls[0]).toMatchObject({
      method: "batchUpdate",
      jsonBody: { requests: [{ insertText: { location: { index: 1 }, text: "hello" } }] },
    });
    expect(out).toMatchObject({ documentId: "doc-1", aliased: { content: "text" } });
  });

  it("refuses text and content together, and neither, before any request", async () => {
    const both = fakeClient([]);
    await expect(handleDocs(both.client, "docs_write", { document_id: "d", text: "a", content: "b" })).rejects.toThrow(
      'give "text" or "content", not both'
    );
    const neither = fakeClient([]);
    await expect(handleDocs(neither.client, "docs_write", { document_id: "d" })).rejects.toThrow(
      'missing required parameter "text" (or "content")'
    );
    expect([...both.calls, ...neither.calls]).toHaveLength(0);
  });
});
