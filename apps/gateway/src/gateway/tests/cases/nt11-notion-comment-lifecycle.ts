import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { notionList, sameNotionId } from "../notion-shape";
import { createdId, notionLabel } from "../notion-artifacts";

type Comment = { id?: string; discussion_id?: string; text?: string };

/**
 * NT11 (Notion scenario): a comment is added to the fixture page, edited,
 * and deleted, each step read back from the page's comments.
 *
 * NO MENTION. A comment that mentions a person notifies them, so the text
 * is the label and words, and the guard refuses an "@" in a test run's
 * comment.
 *
 * The delete is proven by absence AFTER presence: the comment was listed by
 * its id before, so its not being listed after an accepted delete means
 * something. Comments have no trash to read a flag from.
 */
export const nt11NotionCommentLifecycle: TestCase = {
  id: "NT11",
  title: "comment on the fixture page, edit the comment, delete it",
  covers: [
    "notion-mcp__notion_create_comment",
    "notion-mcp__notion_get_comments",
    "notion-mcp__notion_update_comment",
    "notion-mcp__notion_delete_comment",
  ],
  accounts: ["notion"],
  fixtures: ["notionPage"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const fixturePage = ctx.fixture("notionPage");
    const text = notionLabel(ctx, "NT11 comment");
    const answer = resultJson<Comment>(
      "notion_create_comment",
      await ctx.call("notion-mcp__notion_create_comment", { page_id: fixturePage, text }, { as: "notion" })
    );
    const comment_id = createdId("comment", answer);
    let deleted = false;
    ctx.defer("delete the comment", async () => {
      if (deleted) return;
      const gone = await ctx.call("notion-mcp__notion_delete_comment", { comment_id }, { as: "notion" });
      if (gone.isError) ctx.evidence("RESIDUE: the comment could not be deleted; it is labelled with the run stamp");
    });

    /** This comment as the page lists it, through every page of the list. */
    const listed = async (): Promise<Comment | undefined> => {
      let cursor: string | null = null;
      for (let pageNo = 0; pageNo < 20; pageNo++) {
        const args: Record<string, unknown> = { block_id: fixturePage, page_size: 100 };
        if (cursor) args.cursor = cursor;
        const page = notionList(
          "notion_get_comments",
          resultJson("notion_get_comments", await ctx.call("notion-mcp__notion_get_comments", args, { as: "notion" }))
        );
        const found = (page.results as Comment[]).find((c) => sameNotionId(c.id, comment_id));
        if (found) return found;
        if (!page.has_more) return undefined;
        cursor = page.next_cursor;
      }
      throw new Error("the fixture page has more than 2,000 open comments, so this one could not be looked for");
    };

    const first = await listed();
    if (!first) throw new Error("the new comment is not among the fixture page's comments");
    if (first.text !== text) throw new Error("the comment reads back with different text than it was created with");

    const editedText = notionLabel(ctx, "NT11 comment edited");
    resultJson(
      "notion_update_comment",
      await ctx.call("notion-mcp__notion_update_comment", { comment_id, text: editedText }, { as: "notion" })
    );
    const afterEdit = await listed();
    if (afterEdit?.text !== editedText) throw new Error("the edited text does not read back");

    const gone = resultJson<{ deleted?: boolean }>(
      "notion_delete_comment",
      await ctx.call("notion-mcp__notion_delete_comment", { comment_id }, { as: "notion" })
    );
    deleted = true;
    if (gone.deleted !== true) throw new Error("notion_delete_comment did not answer deleted true");
    if (await listed()) throw new Error("the comment is still listed on the fixture page after a delete Notion accepted");
    ctx.evidence("comment created, edited and deleted, each read back from the page's comments");
  },
};
