import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { sameNotionId } from "../notion-shape";
import {
  assertParent,
  assertTrashed,
  createdId,
  notionLabel,
  onlyDataSource,
  schemaNames,
  type NotionDatabase,
  type NotionPage,
} from "../notion-artifacts";

/**
 * NT12 (Notion scenario): a database is created, its data source gains a
 * property and loses it again, the data source is trashed, and the page the
 * database was created in is trashed with it.
 *
 * IN A PAGE OF ITS OWN under the fixture page, rather than on the fixture
 * page itself. These tools can trash a data source but not the database
 * that holds it, so a database made straight under the fixture page would
 * leave an empty container there on every run. Trashing the page it lives
 * in takes the database with it, and that trash is read back.
 *
 * The data source's trash is proven by the data source Notion returns from
 * the change: no read tool here reads a data source's trash flag, and a
 * database read does not carry it.
 */
export const nt12NotionDatabase: TestCase = {
  id: "NT12",
  title: "create a database, add and remove a property, trash its data source and its page",
  covers: [
    "notion-mcp__notion_create_page",
    "notion-mcp__notion_create_database",
    "notion-mcp__notion_get_database",
    "notion-mcp__notion_update_data_source",
    "notion-mcp__notion_update_page",
    "notion-mcp__notion_get_page",
  ],
  accounts: ["notion"],
  fixtures: ["notionPage"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const holder = resultJson<NotionPage>(
      "notion_create_page",
      await ctx.call(
        "notion-mcp__notion_create_page",
        { parent_page_id: ctx.fixture("notionPage"), title: notionLabel(ctx, "NT12 holder") },
        { as: "notion" }
      )
    );
    const holderId = createdId("page holding the database", holder);
    let trashed = false;
    ctx.defer("trash the page holding the database", async () => {
      if (trashed) return;
      const gone = await ctx.call("notion-mcp__notion_update_page", { page_id: holderId, in_trash: true }, { as: "notion" });
      if (gone.isError) ctx.evidence("RESIDUE: the page holding the database could not be trashed; it is labelled with the run stamp");
    });

    const title = notionLabel(ctx, "NT12 database");
    const db = resultJson<NotionDatabase & { parent?: { type?: string; id?: string } }>(
      "notion_create_database",
      await ctx.call(
        "notion-mcp__notion_create_database",
        { parent_page_id: holderId, title, properties: { Name: "title", Note: "rich_text" } },
        { as: "notion" }
      )
    );
    const database_id = createdId("database", db);
    const data_source_id = onlyDataSource(db);
    if (db.title !== title) throw new Error("the database was created under a different title than it was given");
    if (!sameNotionId(db.parent?.id, holderId)) throw new Error("the database was not created in the page it was given");

    const schema = async () =>
      schemaNames(
        resultJson<NotionDatabase>(
          "notion_get_database",
          await ctx.call("notion-mcp__notion_get_database", { database_id }, { as: "notion" })
        ),
        data_source_id
      );
    const before = await schema();
    for (const name of ["Name", "Note"]) {
      if (!before.includes(name)) throw new Error(`the database reads back without the ${name} property it was created with`);
    }

    const extra = `Extra ${ctx.stamp}`;
    resultJson(
      "notion_update_data_source",
      await ctx.call("notion-mcp__notion_update_data_source", { data_source_id, properties: { [extra]: "number" } }, { as: "notion" })
    );
    if (!(await schema()).includes(extra)) throw new Error("the added property does not read back in the schema");

    resultJson(
      "notion_update_data_source",
      await ctx.call("notion-mcp__notion_update_data_source", { data_source_id, properties: { [extra]: null } }, { as: "notion" })
    );
    if ((await schema()).includes(extra)) throw new Error("the removed property still reads back in the schema");

    const dsGone = resultJson<{ in_trash?: boolean }>(
      "notion_update_data_source",
      await ctx.call("notion-mcp__notion_update_data_source", { data_source_id, in_trash: true }, { as: "notion" })
    );
    if (dsGone.in_trash !== true) throw new Error("the data source Notion returned from the trash is not in the trash");

    const read = async () =>
      resultJson<NotionPage>("notion_get_page", await ctx.call("notion-mcp__notion_get_page", { page_id: holderId }, { as: "notion" }));
    assertParent("page holding the database", await read(), ctx.fixture("notionPage"));
    const answer = resultJson<NotionPage>(
      "notion_update_page",
      await ctx.call("notion-mcp__notion_update_page", { page_id: holderId, in_trash: true }, { as: "notion" })
    );
    trashed = true;
    assertTrashed("page holding the database", answer, await read());
    ctx.evidence("database created; a property added and removed, each read back; data source and its page trashed");
  },
};
