import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { notionList } from "../notion-shape";

/**
 * NT6 (Notion scenario): the fixture page's comments come back in the list
 * shape.
 *
 * It does not require a comment: an open comment can be resolved by anyone
 * in the workspace, and Notion's API does not return resolved ones, so a
 * count would go red for a reason that is not ours. Whatever does come back
 * is held to the reduced shape the tool documents.
 */
export const nt6NotionComments: TestCase = {
  id: "NT6",
  title: "get_comments on the fixture page answers the list shape",
  covers: ["notion-mcp__notion_get_comments"],
  accounts: ["notion"],
  fixtures: ["notionPage"],
  run: async (ctx) => {
    const answer = notionList(
      "notion_get_comments",
      resultJson(
        "notion_get_comments",
        await ctx.call("notion-mcp__notion_get_comments", { block_id: ctx.fixture("notionPage") }, { as: "notion" })
      )
    );
    for (const item of answer.results) {
      const c = item as Record<string, unknown>;
      if (typeof c.id !== "string" || typeof c.discussion_id !== "string" || typeof c.text !== "string") {
        throw new Error("a comment is not the documented {id, discussion_id, text, ...}");
      }
      if (!("created_time" in c) || !("created_by" in c) || !("parent" in c)) {
        throw new Error("a comment is missing created_time, created_by or parent");
      }
    }
    ctx.evidence(`${answer.results.length} open comment(s), has_more ${answer.has_more}`);
  },
};
