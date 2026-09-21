import type { TestCase } from "../types";
import { firstArray, resultJson, resultText } from "../result-json";

/**
 * D12 (smoke row D12, tier 2): a reply lands in the SAME THREAD.
 *
 * Rides D10's delivered message rather than sending another.
 *
 * WHY THIS ONE NEEDED A RULING. The reply goes back to the account that
 * sent the original, so its recipient is the configured sender, and the
 * send guard permitted exactly one address. There is no way to restructure
 * around it: proving a reply threads needs a message to travel back to us.
 * HQ ruled on 2026-09-20 that reply and forward may reach the configured
 * sender as well as the reader — an allowlist of two addresses we
 * configured, not a relaxation. `gmail_send` and the drafts are unchanged,
 * and the guard's tests pin both directions.
 */
export const d12ReplyThreads: TestCase = {
  id: "D12",
  title: "a reply to the delivered message lands in its thread",
  tier: 2,
  covers: ["gws-mcp__gmail_reply", "gws-mcp__gmail_search", "gws-mcp__gmail_read"],
  accounts: ["sender", "reader"],
  needs: ["D10"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const from = ctx.from("D10") as { receivedId?: string; subject?: string; runStamp?: string };
    if (!from.runStamp) throw new Error("D10 shared no run stamp");
    if (!from.receivedId) throw new Error("D10 shared no received message, so there is nothing to reply to");

    const original = resultJson<{ threadId?: string; thread_id?: string }>(
      "gmail_read",
      await ctx.call("gws-mcp__gmail_read", { message_id: from.receivedId }, { as: "reader" })
    );
    const originalThread = original.threadId ?? original.thread_id;
    if (!originalThread) throw new Error("the delivered message reports no thread id, so threading cannot be checked");

    const token = `reply-${ctx.stamp}`;
    await ctx.call(
      "gws-mcp__gmail_reply",
      { message_id: from.receivedId, body: `Replying from the smoke suite. ${token}` },
      { as: "reader" }
    );

    /* REGISTERED BEFORE THE WAIT. The reply has already been sent by this
     * point, so a `until` that times out would otherwise leave live mail in
     * two mailboxes with nothing recording it. This sweeps whatever this
     * run put there, whether or not the search below ever succeeds. */
    ctx.defer("trash any reply this case sent", async () => {
      const found = await ctx.call(
        "gws-mcp__gmail_search",
        { query: `"${from.runStamp}" ${token}`, max_results: 10 },
        { as: "sender" }
      );
      const hits = (firstArray(resultJson("gmail_search", found)) ?? []) as { id?: string }[];
      for (const hit of hits) {
        if (!hit.id) continue;
        if (!(await ctx.trashOwnMessage(hit.id, { as: "sender" }))) {
          ctx.evidence("RESIDUE: a reply could not be trashed");
        }
      }
    });

    const reply = await ctx.until(
      "the reply to arrive back with the sender",
      async () => {
        const found = await ctx.call(
          "gws-mcp__gmail_search",
          { query: `"${from.runStamp}"`, max_results: 25 },
          { as: "sender" }
        );
        const hits = (firstArray(resultJson("gmail_search", found)) ?? []) as { id?: string }[];
        for (const hit of hits) {
          if (!hit.id) continue;
          const body = resultText(
            await ctx.call("gws-mcp__gmail_read", { message_id: hit.id }, { as: "sender" })
          );
          if (body.includes(token)) return hit.id;
        }
        return undefined;
      },
      { everyMs: 5_000, forMs: 120_000 }
    );
    const replyRead = resultJson<{ threadId?: string; thread_id?: string; subject?: string }>(
      "gmail_read",
      await ctx.call("gws-mcp__gmail_read", { message_id: reply }, { as: "sender" })
    );
    const replyThread = replyRead.threadId ?? replyRead.thread_id;
    ctx.evidence(`threads match: ${replyThread === originalThread}`);

    if (replyThread !== originalThread) {
      throw new Error("the reply is in a different thread from the message it replied to");
    }
    if (!/^re:/i.test((replyRead.subject ?? "").trim())) {
      throw new Error(`the reply's subject is not the Re: form (${JSON.stringify(replyRead.subject ?? null)})`);
    }
  },
};
