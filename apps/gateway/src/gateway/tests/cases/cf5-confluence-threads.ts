import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

type Comment = { id?: string; type?: string; parent_id?: string | null; body?: string | null; selection?: string | null };

/**
 * CF5 (Confluence scenario, SCRUM-428): comment threads. A footer comment and
 * a reply to it, an inline comment anchored to a word of the page and a reply
 * to that, all through `confluence_add_comment`, and `confluence_get_comments`
 * then lists the four with the right type and parent.
 *
 * The reply to the inline comment is the one that matters most: it has to go
 * to the inline endpoint, which the tool works out from the parent, and a
 * reply sent to the wrong endpoint is refused by Confluence rather than
 * misfiled. The page is made here with the anchor word in it once, and
 * deleting it removes every comment.
 */
export const cf5ConfluenceThreads: TestCase = {
  id: "CF5",
  title: "footer and inline comments and their replies are listed in their threads",
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
    const anchor = `anchor${ctx.stamp.replace(/[^A-Za-z0-9]/g, "")}`;
    const page_id = resultJson<{ id?: string }>(
      "confluence_create_page",
      await ctx.call(
        "atlassian-mcp__confluence_create_page",
        {
          space_key: ctx.fixture("confluenceSpace"),
          title: `[smoke] CF5 ${ctx.stamp}`,
          content: `<p>A page the smoke suite comments on. The word ${anchor} is where the inline comment goes.</p>`,
        },
        { as: "atlassian" }
      )
    ).id;
    if (!page_id) throw new Error("confluence_create_page answered without an id, so there is nothing to comment on");
    ctx.defer("delete the created page", async () => {
      const gone = await ctx.call("atlassian-mcp__confluence_delete_page", { page_id }, { as: "atlassian" });
      if (gone.isError) ctx.evidence("RESIDUE: the commented page could not be deleted and is still in the space");
    });

    const add = async (args: Record<string, unknown>, what: string) => {
      const res = await ctx.call("atlassian-mcp__confluence_add_comment", { page_id, ...args }, { as: "atlassian" });
      if (res.isError) throw new Error(`confluence_add_comment refused the ${what}`);
      const out = resultJson<Comment>("confluence_add_comment", res);
      if (!out.id) throw new Error(`confluence_add_comment answered the ${what} without an id`);
      return out.id;
    };
    const footer = await add({ body: `CF5 footer ${ctx.stamp}` }, "footer comment");
    const footerReply = await add({ body: `CF5 footer reply ${ctx.stamp}`, parent_comment_id: footer }, "reply to the footer comment");
    const inline = await add({ body: `CF5 inline ${ctx.stamp}`, inline_text: anchor }, "inline comment");
    const inlineReply = await add({ body: `CF5 inline reply ${ctx.stamp}`, parent_comment_id: inline }, "reply to the inline comment");

    const listed = firstArray(
      resultJson("confluence_get_comments", await ctx.call("atlassian-mcp__confluence_get_comments", { page_id }, { as: "atlassian" }))
    ) as Comment[] | null;
    if (listed === null) throw new Error("confluence_get_comments answered without a list");
    const byId = new Map(listed.map((c) => [c.id, c]));
    ctx.evidence(`listed: ${listed.map((c) => `${c.type}${c.parent_id ? " reply" : ""}`).join(", ")}`);
    if (listed.length !== 4) throw new Error(`four comments were added and ${listed.length} are listed`);
    const check = (id: string, type: string, parent: string | null) => {
      const c = byId.get(id);
      if (!c) throw new Error(`comment ${id} is not listed`);
      if (c.type !== type || (c.parent_id ?? null) !== parent) {
        throw new Error(`comment ${id} is listed as ${c.type} under ${c.parent_id ?? "the page"}, not ${type} under ${parent ?? "the page"}`);
      }
    };
    check(footer, "footer", null);
    check(footerReply, "footer", footer);
    check(inline, "inline", null);
    check(inlineReply, "inline", inline);
    const anchored = byId.get(inline)?.selection;
    if (anchored !== anchor) throw new Error(`the inline comment is anchored to ${JSON.stringify(anchored)}, not the word it was placed on`);
  },
};
