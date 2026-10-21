import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { sameNotionId } from "../notion-shape";

/**
 * NT4 (Notion scenario): the fixture database answers with its data
 * sources, and one of them is the fixture data source, with a schema.
 *
 * Two ids configured separately are checked against each other here: the
 * database's own answer has to name the data source NT5 queries. A schema
 * is a list of {name, type}; every Notion data source has exactly one title
 * property, so a schema without one is not a schema that came from Notion.
 */
export const nt4NotionGetDatabase: TestCase = {
  id: "NT4",
  title: "get_database returns the fixture data source's schema",
  covers: ["notion-mcp__notion_get_database"],
  accounts: ["notion"],
  fixtures: ["notionDatabase", "notionDataSource"],
  run: async (ctx) => {
    const databaseId = ctx.fixture("notionDatabase");
    const dataSourceId = ctx.fixture("notionDataSource");
    const db = resultJson<Record<string, unknown>>(
      "notion_get_database",
      await ctx.call("notion-mcp__notion_get_database", { database_id: databaseId }, { as: "notion" })
    );

    if (!sameNotionId(db.id, databaseId)) throw new Error("the database that came back is not the one asked for");
    if (db.in_trash !== false) throw new Error("the fixture database reads as in the trash");
    if (!Array.isArray(db.data_sources)) throw new Error("data_sources is not a list");

    const source = db.data_sources.find((d) => sameNotionId((d as Record<string, unknown>)?.id, dataSourceId)) as
      | Record<string, unknown>
      | undefined;
    ctx.evidence(`${db.data_sources.length} data source(s)`);
    if (!source) throw new Error("the fixture database does not list the fixture data source");

    const properties = source.properties;
    if (!Array.isArray(properties) || properties.length === 0) {
      throw new Error("the fixture data source came back with no schema");
    }
    for (const p of properties as Record<string, unknown>[]) {
      if (typeof p?.name !== "string" || typeof p?.type !== "string") {
        throw new Error("a schema entry is not the documented {name, type}");
      }
      if (["select", "multi_select", "status"].includes(p.type) && !Array.isArray(p.options)) {
        throw new Error(`a ${p.type} property came back without its option names`);
      }
    }
    const titles = (properties as Record<string, unknown>[]).filter((p) => p.type === "title").length;
    if (titles !== 1) throw new Error(`the schema has ${titles} title properties, and a Notion data source has one`);
    ctx.evidence(`the fixture data source's schema has ${properties.length} properties`);
  },
};
