import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { notionList, sameNotionId } from "../notion-shape";
import { assertTrashed, createdId, notionLabel, onlyDataSource, type NotionDatabase, type NotionPage } from "../notion-artifacts";

type View = { id?: string; name?: string; type?: string; database_id?: string; data_source_id?: string };

/**
 * NT14 (Notion scenario): a view is added to a database this case creates,
 * its rows are queried through the view, the view is renamed, and the query
 * runs again through it.
 *
 * The rename is read from the view Notion returns: no tool reads a view by
 * itself. The view still answering a query afterwards, with the row in it,
 * is the read-back that it is the same view. A view goes when its database
 * does, so the page holding both is what gets trashed.
 */
export const nt14NotionView: TestCase = {
  id: "NT14",
  title: "create a view, query rows through it, rename it",
  covers: [
    "notion-mcp__notion_create_page",
    "notion-mcp__notion_create_database",
    "notion-mcp__notion_create_view",
    "notion-mcp__notion_query_data_source",
    "notion-mcp__notion_update_view",
    "notion-mcp__notion_update_page",
    "notion-mcp__notion_get_page",
  ],
  accounts: ["notion"],
  fixtures: ["notionPage"],
  timeoutMs: 240_000,
  run: async (ctx) => {
    const holder = resultJson<NotionPage>(
      "notion_create_page",
      await ctx.call(
        "notion-mcp__notion_create_page",
        { parent_page_id: ctx.fixture("notionPage"), title: notionLabel(ctx, "NT14 holder") },
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
        { parent_page_id: holderId, title: notionLabel(ctx, "NT14 database"), properties: { Name: "title" } },
        { as: "notion" }
      )
    );
    const database_id = createdId("database", db);
    const data_source_id = onlyDataSource(db);
    const row = resultJson<NotionPage>(
      "notion_create_page",
      await ctx.call(
        "notion-mcp__notion_create_page",
        { parent_data_source_id: data_source_id, title: notionLabel(ctx, "NT14 row") },
        { as: "notion" }
      )
    );
    const rowId = createdId("row", row);

    const name = notionLabel(ctx, "NT14 view");
    const view = resultJson<View>(
      "notion_create_view",
      await ctx.call("notion-mcp__notion_create_view", { database_id, data_source_id, name, type: "table" }, { as: "notion" })
    );
    const view_id = createdId("view", view);
    if (view.name !== name || view.type !== "table") throw new Error("the view came back with a different name or type than it was created with");
    if (!sameNotionId(view.database_id, database_id) || !sameNotionId(view.data_source_id, data_source_id)) {
      throw new Error("the view came back on a different database or data source than it was created on");
    }

    /** The row, as the view lists it. Polled: a row made a moment ago can
     * take a little while to appear in a view's query. */
    const rowInView = (when: string) =>
      ctx.until(
        `the row to be listed by the view ${when}`,
        async () => {
          const rows = notionList(
            "notion_query_data_source",
            resultJson("notion_query_data_source", await ctx.call("notion-mcp__notion_query_data_source", { view_id }, { as: "notion" }))
          );
          return (rows.results as { id?: string }[]).some((r) => sameNotionId(r.id, rowId)) ? true : undefined;
        },
        { everyMs: 3_000, forMs: 45_000 }
      );
    await rowInView("after it was created");

    const renamed = notionLabel(ctx, "NT14 view renamed");
    const updated = resultJson<View>(
      "notion_update_view",
      await ctx.call("notion-mcp__notion_update_view", { view_id, name: renamed }, { as: "notion" })
    );
    if (!sameNotionId(updated.id, view_id)) throw new Error("notion_update_view answered about a different view");
    if (updated.name !== renamed) throw new Error("the view Notion returned from the rename does not carry the new name");
    await rowInView("after it was renamed");

    const answer = resultJson<NotionPage>(
      "notion_update_page",
      await ctx.call("notion-mcp__notion_update_page", { page_id: holderId, in_trash: true }, { as: "notion" })
    );
    holderTrashed = true;
    const back = resultJson<NotionPage>(
      "notion_get_page",
      await ctx.call("notion-mcp__notion_get_page", { page_id: holderId }, { as: "notion" })
    );
    assertTrashed("page holding the database and its view", answer, back);
    ctx.evidence("view created on a new database, queried, renamed and queried again; its page trashed");
  },
};
