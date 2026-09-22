import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { deliveredFromSearch } from "../mail-parts";

/**
 * D13 (smoke row D13): a forward must CARRY THE ORIGINAL.
 *
 * A self-forward, reader to reader, so no third mailbox is involved. The
 * assertion is that BOTH the new note and D10's original token survive: a
 * forward that dropped the quoted original would still deliver something
 * that looks like a forward.
 */
export const d13ForwardCarries: TestCase = {
  id: "D13",
  title: "a forward carries both the note and the original's token",
  covers: ["gws-mcp__gmail_forward", "gws-mcp__gmail_search", "gws-mcp__gmail_read"],
  accounts: ["reader"],
  needs: ["D10"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const from = ctx.from("D10") as { receivedId?: string; token?: string; runStamp?: string };
    if (!from.receivedId || !from.token || !from.runStamp) {
      throw new Error("D10 shared no delivered message, so there is nothing to forward");
    }

    const note = `note-${ctx.stamp}`;
    await ctx.call(
      "gws-mcp__gmail_forward",
      {
        // gmail_forward takes no subject: it derives its own from the
        // original, which is why the search below looks for the run stamp
        // rather than a subject this case chose.
        message_id: from.receivedId,
        to: ctx.address("reader"),
        body: `Forwarded by the smoke suite. ${note}`,
      },
      { as: "reader" }
    );

    const forwarded = await ctx.until(
      "the forward to arrive",
      async () => {
        const found = await ctx.call(
          "gws-mcp__gmail_search",
          { query: `"${from.runStamp}" ${note}`, max_results: 10 },
          { as: "reader" }
        );
        return deliveredFromSearch(found)[0];
      },
      { everyMs: 5_000, forMs: 120_000 }
    );
    ctx.defer("trash the forward", async () => {
      if (!(await ctx.trashOwnMessage(forwarded, { as: "reader" }))) {
        ctx.evidence("RESIDUE: a forwarded message could not be trashed");
      }
    });

    /* THE DECODED BODY. This read the raw Gmail resource, where the body
     * parts are base64: the note was found only because Gmail's `snippet`
     * reaches the first line, and the original's token, further down, was
     * never in plain text at all. That alone accounts for the run 1 failure
     * "the quoted message was dropped": the plugin writes the original into
     * both parts of the forward, and the next run says whether it arrives. */
    const read = resultJson<{ body?: unknown }>(
      "gmail_read",
      await ctx.call("gws-mcp__gmail_read", { message_id: forwarded, text_only: true }, { as: "reader" })
    );
    const body = typeof read.body === "string" ? read.body : "";
    if (body === "") throw new Error("gmail_read returned no decoded body for the forward, so nothing was read");
    const hasNote = body.includes(note);
    const hasOriginal = body.includes(from.token);
    ctx.evidence(`the forward carries the note: ${hasNote}, and the original's token: ${hasOriginal}`);

    if (!hasNote) throw new Error("the forward does not carry the note that was written on it");
    if (!hasOriginal) {
      throw new Error("the forward does not carry the original's token, so the quoted message was dropped");
    }
  },
};
