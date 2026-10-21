import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { notionList, sameNotionId } from "../notion-shape";

/**
 * NT3 (Notion scenario): a search by the fixture page's title finds it.
 *
 * Notion's search matches titles only and its index is not immediate, which
 * is why the subject is a STANDING page rather than one this run made: a
 * page created a moment ago can be missing for reasons that are not ours.
 * Every result is held to the reduced shape the tool documents, so a search
 * that answered Notion's raw objects would fail here rather than pass on a
 * found id.
 */
export const nt3NotionSearch: TestCase = {
  id: "NT3",
  title: "search by title finds the fixture page",
  covers: ["notion-mcp__notion_search"],
  accounts: ["notion"],
  fixtures: ["notionPage"],
  needs: ["NT2"],
  run: async (ctx) => {
    const pageId = ctx.fixture("notionPage");
    const title = ctx.from("NT2").title;
    if (typeof title !== "string" || title === "") throw new Error("NT2 shared no title to search by");

    const answer = notionList(
      "notion_search",
      resultJson(
        "notion_search",
        await ctx.call("notion-mcp__notion_search", { query: title, object: "page", page_size: 20 }, { as: "notion" })
      )
    );
    ctx.evidence(`${answer.results.length} result(s), has_more ${answer.has_more}`);

    for (const item of answer.results) {
      const r = item as Record<string, unknown>;
      if (typeof r.id !== "string" || r.object !== "page" || typeof r.title !== "string") {
        throw new Error("a result is not the documented {id, object, title, ...} of a page");
      }
      if (!("url" in r) || !("parent" in r) || !("last_edited_time" in r)) {
        throw new Error("a result is missing url, parent or last_edited_time");
      }
    }
    const found = answer.results.find((item) => sameNotionId((item as Record<string, unknown>).id, pageId));
    if (!found) throw new Error("a search for the fixture page's own title did not return it");
    if ((found as Record<string, unknown>).title !== title) {
      throw new Error("the fixture page was found under a different title than get_page reported");
    }
  },
};
