import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type Comment = { id?: string; body?: unknown };

/**
 * Every string in an ADF document, in order.
 *
 * HARVESTS TEXT, DOES NOT ASSERT A SHAPE. An earlier version of this case
 * declined to read the body at all, on the grounds that walking ADF would be
 * testing the converter; that reasoning was wrong and it cost the edit its
 * only real assertion. Collecting `text` from every node at any depth makes
 * no claim about how ADF nests, so a change to that nesting cannot break it,
 * while an edit that never reached Jira still shows up as unchanged text.
 */
function adfText(node: unknown): string {
  if (Array.isArray(node)) return node.map(adfText).join("");
  if (node && typeof node === "object") {
    const o = node as { text?: unknown; content?: unknown };
    const here = typeof o.text === "string" ? o.text : "";
    return here + (o.content === undefined ? "" : adfText(o.content));
  }
  return "";
}

/**
 * JR4 (Jira scenario): the whole comment lifecycle on one issue.
 *
 * add, get, edit, get, delete, get. Four tools in one step because a comment
 * cannot be edited or deleted without first being added, and splitting them
 * would mean four issues created to prove one thing.
 *
 * EVERY VERB IS CHECKED BY A SUBSEQUENT READ, never by its own answer.
 * `jira_edit_comment` and `jira_delete_comment` report success in words, so
 * a handler that never issued the request would pass a case that believed
 * them.
 *
 * THE COUNT IS CHECKED AS WELL AS THE CONTENT. A delete that removed every
 * comment, or an edit that added a second one instead of changing the first,
 * both leave the text assertion satisfiable; the count is what separates
 * them.
 *
 * AND THE TEXT IS CHECKED AS WELL AS THE COUNT, which is the half an earlier
 * version left out. After an edit it asserted only that there was still one
 * comment and that its id was unchanged, and both of those were already true
 * BEFORE the edit ran, so the step passed whether or not the edit reached
 * Jira, in a case whose own comment said every verb is proven by a re-read.
 */
export const jr4JiraComments: TestCase = {
  id: "JR4",
  title: "a comment is added, edited, and deleted, and each is visible to a later read",
  covers: [
    "atlassian-mcp__jira_create_issue",
    "atlassian-mcp__jira_add_comment",
    "atlassian-mcp__jira_get_comments",
    "atlassian-mcp__jira_edit_comment",
    "atlassian-mcp__jira_delete_comment",
    "atlassian-mcp__jira_delete_issue",
  ],
  accounts: ["atlassian"],
  fixtures: ["jiraProject"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const created = resultJson<{ key?: string }>(
      "jira_create_issue",
      await ctx.call(
        "atlassian-mcp__jira_create_issue",
        { project_key: ctx.fixture("jiraProject"), summary: `[smoke] JR4 ${ctx.stamp}` },
        { as: "atlassian" }
      )
    );
    const issue_key = created.key;
    if (!issue_key) throw new Error("jira_create_issue answered without a key, so there is nothing to comment on");
    ctx.defer("delete the created issue", async () => {
      /* A CLEANUP THAT FAILED MUST SAY SO. `ctx.call` resolves on a tool
       * error, so an unchecked delete here would leave a live issue on the
       * tenant while the run reported `cleanup: clean`. */
      const gone = await ctx.call("atlassian-mcp__jira_delete_issue", { issue_key }, { as: "atlassian" });
      if (gone.isError) ctx.evidence("RESIDUE: the created issue could not be deleted and is still on the board");
    });

    const commentsNow = async (): Promise<Comment[]> => {
      const envelope = resultJson<{ comments?: Comment[] }>(
        "jira_get_comments",
        await ctx.call("atlassian-mcp__jira_get_comments", { issue_key }, { as: "atlassian" })
      );
      return envelope.comments ?? [];
    };

    /* A NEW ISSUE, so this is zero. Asserted rather than assumed: if Jira
     * ever seeded a comment on create, every count below would be off by one
     * and the case would blame the wrong verb. */
    const startingCount = (await commentsNow()).length;
    if (startingCount !== 0) {
      throw new Error(`a newly created issue already carries ${startingCount} comment(s), so the counts below cannot be attributed to this case`);
    }

    const added = resultJson<{ id?: string }>(
      "jira_add_comment",
      await ctx.call(
        "atlassian-mcp__jira_add_comment",
        { issue_key, comment: `[smoke] JR4 added ${ctx.stamp}` },
        { as: "atlassian" }
      )
    );
    const comment_id = added.id;
    if (!comment_id) throw new Error("jira_add_comment answered without an id, so the comment cannot be edited or deleted");

    const afterAdd = await commentsNow();
    if (afterAdd.length !== 1) {
      throw new Error(`after one add the issue carries ${afterAdd.length} comment(s), not one`);
    }
    if (!afterAdd.some((c) => c.id === comment_id)) {
      throw new Error("the added comment's id is not among the comments the issue reports");
    }

    /* The text as stored, before the edit, so the comparison afterwards is
     * against what Jira actually holds rather than against what we sent. */
    const textBefore = adfText(afterAdd[0]?.body);
    if (textBefore === "") {
      throw new Error("the added comment's stored body carries no text at all, so an edit to it could not be detected");
    }

    const editedMarker = `[smoke] JR4 edited ${ctx.stamp}`;
    const edited = await ctx.call(
      "atlassian-mcp__jira_edit_comment",
      { issue_key, comment_id, comment: editedMarker },
      { as: "atlassian" }
    );
    if (edited.isError) throw new Error("jira_edit_comment refused the edit, so the text below would be unchanged for that reason rather than a silent no-op");
    const afterEdit = await commentsNow();
    if (afterEdit.length !== 1) {
      throw new Error(`after an edit the issue carries ${afterEdit.length} comment(s), so the edit added or removed one instead of changing it`);
    }
    if (afterEdit[0]?.id !== comment_id) {
      throw new Error("after an edit the issue's one comment is not the one that was edited");
    }
    const textAfter = adfText(afterEdit[0]?.body);
    if (textAfter === textBefore) {
      throw new Error("the comment's stored text is unchanged after an edit, so the edit was reported rather than made");
    }
    if (!textAfter.includes(editedMarker)) {
      throw new Error("the comment's stored text changed but does not carry the text it was edited to");
    }

    const removed = await ctx.call(
      "atlassian-mcp__jira_delete_comment",
      { issue_key, comment_id },
      { as: "atlassian" }
    );
    if (removed.isError) throw new Error("jira_delete_comment refused the delete, so the count below would be unchanged for that reason");
    const afterDelete = await commentsNow();
    if (afterDelete.length !== 0) {
      throw new Error(`after deleting the only comment the issue still carries ${afterDelete.length}`);
    }
    ctx.evidence("one comment added, edited in place, and deleted, each confirmed by a re-read");
  },
};
