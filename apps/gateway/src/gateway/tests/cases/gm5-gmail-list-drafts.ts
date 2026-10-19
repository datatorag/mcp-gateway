import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type Listing = { count?: number; drafts?: { draft_id?: string; message_id?: string }[] };

/**
 * GM5 (Gmail scenario): a draft made in this run is in `gmail_list_drafts`
 * under its draft id, and is out of the list once deleted.
 *
 * Listing drafts was reached through the raw API tool, where the call
 * failed for want of a `userId` the caller had no reason to know about.
 * The step is narrowed by the run's own subject so it reads one draft in a
 * mailbox that may hold many, and it checks BOTH directions: present after
 * the create, absent after the delete. A list that returned every draft
 * regardless of the query, or kept returning a deleted one, would pass a
 * check that only looked once.
 */
export const gm5GmailListDrafts: TestCase = {
  id: "GM5",
  title: "a created draft is listed under its id, and is gone from the list once deleted",
  covers: ["gws-mcp__gmail_list_drafts", "gws-mcp__gmail_create_draft", "gws-mcp__gmail_delete_draft"],
  accounts: ["sender", "reader"],
  run: async (ctx) => {
    const subject = `[smoke] GM5 ${ctx.stamp}`;
    const query = `subject:"${ctx.stamp}"`;

    const list = async (): Promise<Listing> =>
      resultJson<Listing>(
        "gmail_list_drafts",
        await ctx.call("gws-mcp__gmail_list_drafts", { query, max_results: 10 }, { as: "sender" })
      );

    const nothingYet = await list();
    if (!Array.isArray(nothingYet.drafts) || nothingYet.count !== nothingYet.drafts.length) {
      throw new Error("an empty listing did not answer with a list and a matching count");
    }
    if (nothingYet.drafts.length !== 0) {
      throw new Error("a draft carrying this step's stamp exists before the step made one, so the query is not narrowing");
    }

    const created = await ctx.call(
      "gws-mcp__gmail_create_draft",
      { to: ctx.address("reader"), subject, body: `Created by the smoke suite, run ${ctx.stamp}.` },
      { as: "sender" }
    );
    const draftId = resultJson<{ id?: string; draftId?: string }>("gmail_create_draft", created).id
      ?? resultJson<{ draftId?: string }>("gmail_create_draft", created).draftId;
    if (!draftId) throw new Error("gmail_create_draft returned no id, so the draft cannot be found or deleted");

    let deleted = false;
    ctx.defer("delete the created draft", async () => {
      if (deleted) return;
      await ctx.call("gws-mcp__gmail_delete_draft", { draft_id: draftId }, { as: "sender" });
    });

    const present = await ctx.until(
      "the draft to be listed",
      async () => ((await list()).drafts ?? []).find((d) => d.draft_id === draftId),
      { everyMs: 3_000, forMs: 30_000 }
    );
    ctx.evidence(`the draft is listed, with ${present.message_id ? "a" : "no"} message id beside it`);
    if (!present.message_id) throw new Error("the listed draft carries no message id, so its content cannot be read");

    await ctx.call("gws-mcp__gmail_delete_draft", { draft_id: draftId }, { as: "sender" });
    deleted = true;

    await ctx.until(
      "the draft to leave the list",
      async () => (((await list()).drafts ?? []).some((d) => d.draft_id === draftId) ? undefined : true),
      { everyMs: 3_000, forMs: 30_000 }
    );
    ctx.evidence("the draft left the list once deleted");
  },
};
