import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { rawProperty, sameNotionId } from "../notion-shape";
import { assertTrashed, createdId, notionLabel, onlyDataSource, type NotionDatabase, type NotionPage } from "../notion-artifacts";

/**
 * NT13 (Notion scenario): a row's property values are changed as plain
 * values and restored, each read back as plain values.
 *
 * On a database this case creates, with a schema it chose, so the values
 * set and restored are known and no fixture row is touched: the fixture
 * data source's schema is whatever a person made it, and a restore that
 * failed halfway would leave a fixture row changed for NT5.
 */
export const nt13NotionRowProperties: TestCase = {
  id: "NT13",
  title: "set a row's properties as plain values, read them back, restore them",
  covers: [
    "notion-mcp__notion_create_page",
    "notion-mcp__notion_create_database",
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
        { parent_page_id: ctx.fixture("notionPage"), title: notionLabel(ctx, "NT13 holder") },
        { as: "notion" }
      )
    );
    const holderId = createdId("page holding the database", holder);
    let holderTrashed = false;
    ctx.defer("trash the page holding the database", async () => {
      if (holderTrashed) return;
      const gone = await ctx.call("notion-mcp__notion_update_page", { page_id: holderId, in_trash: true }, { as: "notion" });
      if (gone.isError) ctx.evidence("RESIDUE: the page holding the database could not be trashed; it is labelled with the run stamp");
    });

    const db = resultJson<NotionDatabase>(
      "notion_create_database",
      await ctx.call(
        "notion-mcp__notion_create_database",
        {
          parent_page_id: holderId,
          title: notionLabel(ctx, "NT13 database"),
          properties: { Name: "title", Note: "rich_text", Done: "checkbox", Stage: { type: "select", options: ["Todo", "Done"] } },
        },
        { as: "notion" }
      )
    );
    const data_source_id = onlyDataSource(db);

    const before = { Note: "before", Done: false, Stage: "Todo" };
    const after = { Note: "after", Done: true, Stage: "Done" };
    const title = notionLabel(ctx, "NT13 row");
    const row = resultJson<NotionPage>(
      "notion_create_page",
      await ctx.call(
        "notion-mcp__notion_create_page",
        { parent_data_source_id: data_source_id, title, properties: before },
        { as: "notion" }
      )
    );
    const page_id = createdId("row", row);

    const read = async (id: string) =>
      resultJson<NotionPage>("notion_get_page", await ctx.call("notion-mcp__notion_get_page", { page_id: id }, { as: "notion" }));
    const expectValues = async (want: Record<string, unknown>, when: string) => {
      const page = await read(page_id);
      if (page.parent?.type !== "data_source" || !sameNotionId(page.parent.id, data_source_id)) {
        throw new Error("the row does not read back as a row of the data source it was created in");
      }
      const props = page.properties ?? {};
      if (rawProperty(props) !== null) throw new Error("a property came back as Notion's typed envelope, not a plain value");
      for (const [name, value] of Object.entries(want)) {
        if (props[name] !== value) throw new Error(`${name} reads back as ${JSON.stringify(props[name])} ${when}, not ${JSON.stringify(value)}`);
      }
      if (props.Name !== title) throw new Error(`the row's title does not read back ${when}`);
    };

    await expectValues(before, "after the create");
    resultJson("notion_update_page", await ctx.call("notion-mcp__notion_update_page", { page_id, properties: after }, { as: "notion" }));
    await expectValues(after, "after the change");
    resultJson("notion_update_page", await ctx.call("notion-mcp__notion_update_page", { page_id, properties: before }, { as: "notion" }));
    await expectValues(before, "after the restore");

    const rowGone = resultJson<NotionPage>(
      "notion_update_page",
      await ctx.call("notion-mcp__notion_update_page", { page_id, in_trash: true }, { as: "notion" })
    );
    assertTrashed("row", rowGone, await read(page_id));

    const holderGone = resultJson<NotionPage>(
      "notion_update_page",
      await ctx.call("notion-mcp__notion_update_page", { page_id: holderId, in_trash: true }, { as: "notion" })
    );
    holderTrashed = true;
    assertTrashed("page holding the database", holderGone, await read(holderId));
    ctx.evidence("text, checkbox and select set and restored as plain values, each read back; row and its page trashed");
  },
};
