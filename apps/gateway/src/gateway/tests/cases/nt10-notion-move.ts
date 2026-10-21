import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { assertParent, assertTrashed, createdId, notionLabel, type NotionPage } from "../notion-artifacts";

/**
 * NT10 (Notion scenario): two pages are created under the fixture page, one
 * is moved under the other and back, each move read back from the page's
 * own parent, and both are trashed.
 *
 * The fixture page is never what moves: the guard holds a move to a page
 * this run created.
 */
export const nt10NotionMove: TestCase = {
  id: "NT10",
  title: "move a created page under another and back, then trash both",
  covers: [
    "notion-mcp__notion_create_page",
    "notion-mcp__notion_move_page",
    "notion-mcp__notion_get_page",
    "notion-mcp__notion_update_page",
  ],
  accounts: ["notion"],
  fixtures: ["notionPage"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const fixturePage = ctx.fixture("notionPage");
    const pages: { id: string; trashed: boolean; what: string }[] = [];

    for (const what of ["moved page", "destination page"]) {
      const answer = resultJson<NotionPage>(
        "notion_create_page",
        await ctx.call(
          "notion-mcp__notion_create_page",
          { parent_page_id: fixturePage, title: notionLabel(ctx, `NT10 ${what}`) },
          { as: "notion" }
        )
      );
      const own = { id: createdId(what, answer), trashed: false, what };
      pages.push(own);
      ctx.defer(`trash the ${what}`, async () => {
        if (own.trashed) return;
        const gone = await ctx.call("notion-mcp__notion_update_page", { page_id: own.id, in_trash: true }, { as: "notion" });
        if (gone.isError) ctx.evidence(`RESIDUE: the ${what} could not be trashed; it is labelled with the run stamp`);
      });
    }
    const [moved, destination] = pages;
    const read = async (page_id: string) =>
      resultJson<NotionPage>("notion_get_page", await ctx.call("notion-mcp__notion_get_page", { page_id }, { as: "notion" }));

    assertParent("page to move", await read(moved.id), fixturePage);

    resultJson(
      "notion_move_page",
      await ctx.call("notion-mcp__notion_move_page", { page_id: moved.id, parent_page_id: destination.id }, { as: "notion" })
    );
    assertParent("moved page", await read(moved.id), destination.id);

    resultJson(
      "notion_move_page",
      await ctx.call("notion-mcp__notion_move_page", { page_id: moved.id, parent_page_id: fixturePage }, { as: "notion" })
    );
    assertParent("page moved back", await read(moved.id), fixturePage);

    for (const own of pages) {
      const answer = resultJson<NotionPage>(
        "notion_update_page",
        await ctx.call("notion-mcp__notion_update_page", { page_id: own.id, in_trash: true }, { as: "notion" })
      );
      own.trashed = true;
      assertTrashed(own.what, answer, await read(own.id));
    }
    ctx.evidence("moved under a created page and back under the fixture, each read back; both trashed");
  },
};
