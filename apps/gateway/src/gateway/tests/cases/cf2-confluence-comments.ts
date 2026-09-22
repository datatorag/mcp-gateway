import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

type Comment = { id?: string; type?: string; body?: string | null };

/**
 * CF2 (Confluence scenario): a comment is added and a later read sees it.
 *
 * ON A PAGE THIS CASE CREATES AND REMOVES, so the comment count below is
 * this case's to assert. On a page somebody uses it would not be.
 *
 * THERE IS NO EDIT AND NO DELETE FOR A CONFLUENCE COMMENT in this
 * connector, unlike Jira's, so this lifecycle is shorter than JR4's by the
 * connector's shape rather than by choice. Deleting the page is what
 * removes the comment.
 *
 * `confluence_add_comment` POSTS A FOOTER COMMENT and answers with
 * `{id, version}` only, so the comment's text has to come from the later
 * read. `confluence_get_comments` returns footer and inline comments in one
 * flat array and stamps each with a `type`. THAT STAMP IS THE HANDLER'S,
 * added per endpoint, not a field Confluence returns, so asserting it
 * proves the comment was listed by `footer-comments` rather than by
 * `inline-comments` and nothing about Confluence's own vocabulary. The body
 * arrives as storage XHTML, because the handler wraps the text in a
 * paragraph and escapes the three XML characters on the way in.
 *
 * A MISTYPED SPACE KEY DOES fail loudly, and an earlier revision of this
 * comment said the opposite. `getSpaceIdByKey` asks `/spaces?keys=<key>`,
 * so the filter is server side, and it throws `Confluence space with key
 * '...' not found.` when nothing comes back. Its `?? results[0]` fallback
 * can only fire if the API returns a row that does not match the key it was
 * filtered on. I wrote the pessimistic version from a review note without
 * reading the client, which is how an invented failure mode gets committed
 * as a fact. CF3's docblock had it right all along.
 */
export const cf2ConfluenceComments: TestCase = {
  id: "CF2",
  title: "a comment added to a page is visible to a later read of that page",
  covers: [
    "atlassian-mcp__confluence_create_page",
    "atlassian-mcp__confluence_add_comment",
    "atlassian-mcp__confluence_get_comments",
    "atlassian-mcp__confluence_delete_page",
  ],
  accounts: ["atlassian"],
  fixtures: ["confluenceSpace"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const created = resultJson<{ id?: string }>(
      "confluence_create_page",
      await ctx.call(
        "atlassian-mcp__confluence_create_page",
        {
          space_key: ctx.fixture("confluenceSpace"),
          title: `[smoke] CF2 ${ctx.stamp}`,
          content: "<p>A page the smoke suite comments on and then removes.</p>",
        },
        { as: "atlassian" }
      )
    );
    const page_id = created.id;
    if (!page_id) throw new Error("confluence_create_page answered without an id, so there is nothing to comment on");
    ctx.defer("delete the created page", async () => {
      const gone = await ctx.call("atlassian-mcp__confluence_delete_page", { page_id }, { as: "atlassian" });
      if (gone.isError) ctx.evidence("RESIDUE: the commented page could not be deleted and is still in the space");
    });

    /* NO `?? []`. An unreadable listing would have become an empty one, so
     * the zero-comment precondition below would assert nothing and the red
     * would land on `add_comment` for a fault in the read. Empty is a fair
     * answer; an unreadable shape is not. */
    const commentsNow = async (): Promise<Comment[]> => {
      const listed = firstArray(
        resultJson(
          "confluence_get_comments",
          await ctx.call("atlassian-mcp__confluence_get_comments", { page_id }, { as: "atlassian" })
        )
      );
      if (listed === null) {
        throw new Error("confluence_get_comments answered without a list anywhere in it, so the comments cannot be counted");
      }
      return listed as Comment[];
    };

    /* A NEW PAGE, so this is zero. Asserted rather than assumed: a template
     * or an automation that seeded a comment would put every count below
     * out by one and the case would blame the wrong verb. */
    const before = await commentsNow();
    if (before.length !== 0) {
      throw new Error(`a newly created page already carries ${before.length} comment(s), so the count below cannot be attributed to this case`);
    }

    const marker = `CF2-comment-${ctx.stamp}`;
    const added = resultJson<{ id?: string }>(
      "confluence_add_comment",
      await ctx.call("atlassian-mcp__confluence_add_comment", { page_id, body: marker }, { as: "atlassian" })
    );
    if (!added.id) throw new Error("confluence_add_comment answered without an id, so the comment cannot be identified");

    const after = await commentsNow();
    if (after.length !== 1) {
      throw new Error(`after one comment the page reports ${after.length}, not one`);
    }
    const ours = after.find((c) => c.id === added.id);
    if (!ours) throw new Error("the added comment's id is not among the comments the page reports");
    if (ours.type !== "footer") {
      throw new Error(`the added comment came back as ${JSON.stringify(ours.type ?? null)}, not the footer comment the tool posts`);
    }
    if (!(ours.body ?? "").includes(marker)) {
      throw new Error("the added comment's stored body does not carry the text it was added with");
    }
    ctx.evidence("one footer comment added and found by a later read, with its text");
  },
};
