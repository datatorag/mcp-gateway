import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { notionList, rawProperty } from "../notion-shape";

/**
 * NT5 (Notion scenario): the fixture data source's rows come back as plain
 * values, a page at a time.
 *
 * A page size of one against a data source of two rows or more is what
 * makes the cursor claim real: the first page must say there is more and
 * give a cursor, and that cursor must return a DIFFERENT row. A query that
 * ignored `cursor` and answered the first row again would pass every
 * shape check and fail here.
 */
export const nt5NotionQuery: TestCase = {
  id: "NT5",
  title: "query returns plain-valued rows, and has_more with a cursor that moves",
  covers: ["notion-mcp__notion_query_data_source"],
  accounts: ["notion"],
  fixtures: ["notionDataSource"],
  run: async (ctx) => {
    const dataSourceId = ctx.fixture("notionDataSource");
    const page = async (cursor?: string) =>
      notionList(
        "notion_query_data_source",
        resultJson(
          "notion_query_data_source",
          await ctx.call(
            "notion-mcp__notion_query_data_source",
            // An absent cursor is the start of the list; undefined is dropped on the wire.
            { data_source_id: dataSourceId, page_size: 1, cursor },
            { as: "notion" }
          )
        )
      );

    const rowOf = (results: unknown[]): Record<string, unknown> => {
      if (results.length !== 1) throw new Error(`a page of one answered ${results.length} rows`);
      const row = results[0] as Record<string, unknown>;
      if (typeof row.id !== "string") throw new Error("a row has no id");
      for (const field of ["url", "created_time", "last_edited_time"]) {
        if (!(field in row)) throw new Error(`a row is missing ${field}`);
      }
      const properties = row.properties;
      if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
        throw new Error("a row's properties are not an object keyed by property name");
      }
      if (Object.keys(properties).length === 0) throw new Error("a row came back with no properties");
      if (rawProperty(properties as Record<string, unknown>) !== null) {
        throw new Error("a row property came back as Notion's typed envelope, not a plain value");
      }
      return row;
    };

    const first = await page();
    const firstRow = rowOf(first.results);
    if (!first.has_more || first.next_cursor === null) {
      throw new Error("a page of one said there was nothing after it; the fixture data source needs two rows or more");
    }

    const second = await page(first.next_cursor);
    const secondRow = rowOf(second.results);
    if (secondRow.id === firstRow.id) throw new Error("the cursor returned the same row again");
    ctx.evidence(`two pages of one row each, different rows; second page has_more ${second.has_more}`);
  },
};
