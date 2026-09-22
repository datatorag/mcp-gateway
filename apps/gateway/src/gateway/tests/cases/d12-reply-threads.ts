import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";
import { deliveredFromSearch } from "../mail-parts";

/**
 * D12 (smoke row D12): a reply lands in the SAME THREAD.
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
  covers: ["gws-mcp__gmail_reply", "gws-mcp__gmail_search", "gws-mcp__gmail_read"],
  accounts: ["sender", "reader"],
  needs: ["D10"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const from = ctx.from("D10") as { receivedId?: string; sentId?: string; subject?: string; runStamp?: string };
    if (!from.runStamp) throw new Error("D10 shared no run stamp");
    if (!from.receivedId) throw new Error("D10 shared no received message, so there is nothing to reply to");
    if (!from.sentId) throw new Error("D10 shared no sent copy, so the sender's thread cannot be read");

    /* THE THREAD IS READ IN THE MAILBOX THE REPLY IS READ IN. A Gmail
     * thread id belongs to one mailbox: the same conversation has a
     * different id in each account that holds it. This compared the
     * READER's thread for the original with the SENDER's thread for the
     * reply, which could not match whatever the plugin did, and that is the
     * whole of the run 1 failure "a different thread". The sender's copy of
     * the original is D10's sent id; with one account behind both roles it
     * is the same message as the received one. */
    const original = resultJson<{ threadId?: string; thread_id?: string }>(
      "gmail_read",
      await ctx.call("gws-mcp__gmail_read", { message_id: from.sentId }, { as: "sender" })
    );
    const originalThread = original.threadId ?? original.thread_id;
    if (!originalThread) throw new Error("the sender's copy reports no thread id, so threading cannot be checked");

    const token = `reply-${ctx.stamp}`;
    await ctx.call(
      "gws-mcp__gmail_reply",
      { message_id: from.receivedId, body: `Replying from the smoke suite. ${token}` },
      { as: "reader" }
    );

    /* REGISTERED BEFORE THE WAIT. The reply has already been sent by this
     * point, so a `until` that times out would otherwise leave live mail in
     * two mailboxes with nothing recording it.
     *
     * AN UNREADABLE SEARCH LOSES THE SWEEP AND THE RECORD OF LOSING IT, so
     * it is refused rather than falling back to an empty list. This comment
     * used to promise the sweep ran "whether or not the search below ever
     * succeeds", which the code did not do: an unreadable answer trashed
     * nothing, wrote no RESIDUE line, and the run still reported
     * `cleanup: clean`. A cleanup that cannot read its own search has to
     * say so, and a throwing undo is what marks the run leaked.
     *
     * The poll further down keeps its `?? []` on purpose: there an
     * unreadable probe returns undefined, the poll retries and finally
     * times out under its own label, which is a red rather than a silence. */
    ctx.defer("trash any reply this case sent", async () => {
      const found = await ctx.call(
        "gws-mcp__gmail_search",
        { query: `"${from.runStamp}" ${token}`, max_results: 10 },
        { as: "sender" }
      );
      const listed = firstArray(resultJson("gmail_search", found));
      if (listed === null) {
        ctx.evidence("RESIDUE: the sweep could not read its own search, so any reply this run sent is still in both mailboxes");
        throw new Error("gmail_search answered without a list anywhere in it, so the reply sweep could not run");
      }
      const hits = listed as { id?: string }[];
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
        // DELIVERED hits only, and the decoded body: see D10.
        for (const id of deliveredFromSearch(found)) {
          const read = resultJson<{ body?: unknown }>(
            "gmail_read",
            await ctx.call("gws-mcp__gmail_read", { message_id: id, text_only: true }, { as: "sender" })
          );
          if (typeof read.body === "string" && read.body.includes(token)) return id;
        }
        return undefined;
      },
      { everyMs: 5_000, forMs: 120_000 }
    );
    /* `text_only`, because the raw resource has no top-level `subject`:
     * read that way, the Re: check below could never have passed. The
     * flattened view carries both the thread id and the subject. */
    const replyRead = resultJson<{ threadId?: string; thread_id?: string; subject?: string }>(
      "gmail_read",
      await ctx.call("gws-mcp__gmail_read", { message_id: reply, text_only: true }, { as: "sender" })
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
