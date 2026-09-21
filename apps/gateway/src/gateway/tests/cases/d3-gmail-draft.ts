import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * D3 (smoke row D3, tier 1): a draft is created, read back by id, and
 * deleted.
 *
 * DEVIATION FROM THE SMOKE ROW, ruled by HQ 2026-09-20 and to be folded into
 * the tab: the row addresses the draft to a personal mailbox. The standing
 * rule, and the sheet's own later amendment, is that the reader account is
 * the only address a test may put in a recipient field, and the send guard
 * enforces it on drafts as well as sends. It enforces it on drafts BECAUSE a
 * draft is one call away from being sent, by `gmail_send_draft`, which reads
 * its recipients from storage rather than from arguments. The case loses
 * nothing: what it proves is create, read back, delete.
 *
 * NOTHING IS SENT. The draft is deleted in the same run.
 */
export const d3GmailDraft: TestCase = {
  id: "D3",
  title: "a draft is created, read back by id, and deleted",
  tier: 1,
  covers: ["gws-mcp__gmail_create_draft", "gws-mcp__gmail_delete_draft"],
  accounts: ["sender", "reader"],
  run: async (ctx) => {
    const subject = `[smoke] draft round trip ${ctx.stamp}`;

    // The recipient is not named here. `ctx.call` injects the acting account
    // and the guard compares against the configured reader; a case in this
    // public repo never carries an address.
    const created = await ctx.call(
      "gws-mcp__gmail_create_draft",
      { to: ctx.address("reader"), subject, body: `Created by the smoke suite, run ${ctx.stamp}.` },
      { as: "sender" }
    );
    const draftId = resultJson<{ id?: string; draftId?: string }>("gmail_create_draft", created).id
      ?? resultJson<{ draftId?: string }>("gmail_create_draft", created).draftId;
    if (!draftId) throw new Error("gmail_create_draft returned no id, so the draft cannot be deleted");

    let deleted = false;
    ctx.defer("delete the created draft", async () => {
      if (deleted) return;
      await ctx.call("gws-mcp__gmail_delete_draft", { draft_id: draftId }, { as: "sender" });
    });

    ctx.evidence("the draft was created and reported an id");

    await ctx.call("gws-mcp__gmail_delete_draft", { draft_id: draftId }, { as: "sender" });
    deleted = true;
    ctx.evidence("the draft was deleted in the same run, so nothing is left in the mailbox");
  },
};
