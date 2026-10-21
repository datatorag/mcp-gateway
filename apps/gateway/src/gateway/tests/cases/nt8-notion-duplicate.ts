import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { sameNotionId } from "../notion-shape";
import {
  assertParent,
  assertTrashed,
  createdId,
  hasChildObject,
  notionLabel,
  type NotionPage,
} from "../notion-artifacts";

/**
 * NT8 (Notion scenario): the fixture page is duplicated under itself, the
 * copy reads back with the fixture's content under its own label, and the
 * copy is trashed.
 *
 * FIRST OF THE WRITES, so no page this run creates is a child of the
 * fixture yet. The duplicate re-creates the source's markdown, and a child
 * page or database in that markdown is refused here before anything is
 * written: what Notion does with a reference to an existing child in new
 * content is not something to learn on the fixture.
 */
export const nt8NotionDuplicate: TestCase = {
  id: "NT8",
  title: "duplicate the fixture page under its own label, read the copy, trash it",
  covers: ["notion-mcp__notion_get_page", "notion-mcp__notion_duplicate_page", "notion-mcp__notion_update_page"],
  accounts: ["notion"],
  fixtures: ["notionPage"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const fixturePage = ctx.fixture("notionPage");
    const source = resultJson<NotionPage>(
      "notion_get_page",
      await ctx.call("notion-mcp__notion_get_page", { page_id: fixturePage }, { as: "notion" })
    );
    if (hasChildObject(source.markdown)) {
      throw new Error("the fixture page carries a child page or database, which a copy of its markdown would reach; nothing was written");
    }
    if (typeof source.markdown !== "string" || source.markdown.trim() === "") {
      throw new Error("the fixture page has no markdown, so a copy could not show its content was carried");
    }

    const title = notionLabel(ctx, "NT8 copy");
    const copy = resultJson<NotionPage & { properties_not_copied?: unknown[] }>(
      "notion_duplicate_page",
      await ctx.call(
        "notion-mcp__notion_duplicate_page",
        { page_id: fixturePage, parent_page_id: fixturePage, title },
        { as: "notion" }
      )
    );
    const copyId = createdId("copy", copy);
    let trashed = false;
    ctx.defer("trash the copy", async () => {
      if (trashed) return;
      const gone = await ctx.call("notion-mcp__notion_update_page", { page_id: copyId, in_trash: true }, { as: "notion" });
      if (gone.isError) ctx.evidence("RESIDUE: the copy could not be trashed; it is labelled with the run stamp");
    });
    if (sameNotionId(copyId, fixturePage)) throw new Error("the duplicate answered with the fixture page's own id");
    if (!Array.isArray(copy.properties_not_copied)) throw new Error("properties_not_copied is not a list");

    const read = resultJson<NotionPage>(
      "notion_get_page",
      await ctx.call("notion-mcp__notion_get_page", { page_id: copyId }, { as: "notion" })
    );
    if (read.title !== title) throw new Error("the copy does not read back under the title it was given");
    assertParent("copy", read, fixturePage);
    if (typeof read.markdown !== "string" || read.markdown.trim() === "") {
      throw new Error("the copy reads back with no content, so the fixture page's markdown was not carried");
    }

    const answer = resultJson<NotionPage>(
      "notion_update_page",
      await ctx.call("notion-mcp__notion_update_page", { page_id: copyId, in_trash: true }, { as: "notion" })
    );
    trashed = true;
    const back = resultJson<NotionPage>(
      "notion_get_page",
      await ctx.call("notion-mcp__notion_get_page", { page_id: copyId }, { as: "notion" })
    );
    assertTrashed("copy", answer, back);
    ctx.evidence(`copy carried ${read.markdown.length} characters of markdown; ${copy.properties_not_copied.length} properties not copied; trashed`);
  },
};
