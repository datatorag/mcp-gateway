import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * D11 (smoke row D11): a draft that is sent must LEAVE the drafts
 * folder.
 *
 * Three claims, and the third is the one that goes wrong quietly: the
 * message arrives, the draft is gone, and no orphan draft is left behind. A
 * send that copies rather than moves leaves a draft that looks unsent, and
 * whoever finds it sends it again.
 */
export const d11DraftSent: TestCase = {
  id: "D11",
  title: "a sent draft arrives and is gone from drafts",
  covers: [
    "gws-mcp__gmail_create_draft",
    "gws-mcp__gmail_send_draft",
    "gws-mcp__gmail_search",
    "gws-mcp__gmail_delete_draft",
  ],
  accounts: ["sender", "reader"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const subject = `[smoke] D11 ${ctx.stamp}`;
    const token = `token-${ctx.stamp}`;

    const created = await ctx.call(
      "gws-mcp__gmail_create_draft",
      { to: ctx.address("reader"), subject, body: `Draft from the smoke suite. ${token}` },
      { as: "sender" }
    );
    const draftId = resultJson<{ id?: string; draftId?: string }>("gmail_create_draft", created).id
      ?? resultJson<{ draftId?: string }>("gmail_create_draft", created).draftId;
    if (!draftId) throw new Error("gmail_create_draft returned no id");

    let sentAlready = false;
    ctx.defer("delete the draft if it was never sent", async () => {
      if (sentAlready) return;
      await ctx.call("gws-mcp__gmail_delete_draft", { draft_id: draftId }, { as: "sender" });
    });

    await ctx.call("gws-mcp__gmail_send_draft", { draft_id: draftId }, { as: "sender" });
    sentAlready = true;

    const received = await ctx.until(
      "the sent draft to arrive",
      async () => {
        const found = await ctx.call(
          "gws-mcp__gmail_search",
          { query: `subject:"${ctx.stamp}"`, max_results: 5 },
          { as: "reader" }
        );
        return ((firstArray(resultJson("gmail_search", found)) ?? []) as { id?: string }[]).find((h) => h.id)?.id;
      },
      { everyMs: 5_000, forMs: 120_000 }
    );
    ctx.defer("trash the received message", async () => {
      if (!(await ctx.trashOwnMessage(received, { as: "reader" }))) {
        ctx.evidence("RESIDUE: a received message could not be trashed");
      }
    });
    ctx.evidence("the sent draft arrived in the reader mailbox");

    // THE DRAFT MUST BE GONE. Asked of the drafts folder, not inferred from
    // the send succeeding.
    const drafts = await ctx.call(
      "gws-mcp__gmail_search",
      { query: `in:draft subject:"${ctx.stamp}"`, max_results: 5 },
      { as: "sender" }
    );
    const remaining = (firstArray(resultJson("gmail_search", drafts)) ?? []) as unknown[];
    ctx.evidence(`drafts matching this run after sending: ${remaining.length}`);
    if (remaining.length > 0) {
      throw new Error("the draft is still in drafts after being sent, so a second send is one click away");
    }
  },
};
