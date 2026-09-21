import type { TestCase } from "../types";
import { firstArray, resultJson, resultText } from "../result-json";

/**
 * D10 (smoke row D10): mail actually leaves us and arrives.
 *
 * THE ONLY CASE THAT PROVES IT. `gmail_send` went untested for months
 * because there was nowhere safe to send: every address we had belonged to
 * a real person. The reader mailbox is one WE own and can read, and that is
 * what makes a send testable at all — the assertion is not "the API
 * returned 200", it is "the message arrived and says what we sent", which
 * requires reading the destination.
 *
 * The received id is the evidence, not the sent id. They differ, and only
 * the received one proves delivery.
 *
 * It shares its token with D12 and D13, which ride this message rather than
 * sending three more.
 */
export const d10MailArrives: TestCase = {
  id: "D10",
  title: "a sent message arrives in the reader mailbox carrying its token",
  covers: ["gws-mcp__gmail_send", "gws-mcp__gmail_search", "gws-mcp__gmail_read"],
  accounts: ["sender", "reader"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const subject = `[smoke] D10 ${ctx.stamp}`;
    const token = `token-${ctx.stamp}`;

    const sent = await ctx.call(
      "gws-mcp__gmail_send",
      { to: ctx.address("reader"), subject, body: `Sent by the smoke suite. ${token}` },
      { as: "sender" }
    );
    const sentId = resultJson<{ id?: string }>("gmail_send", sent).id;
    ctx.evidence(`send reported an id: ${sentId ? "yes" : "no"}`);

    // POLLED, NOT SLEPT. Delivery is not instant and a fixed wait is either
    // flaky or slow; `until` states its own budget.
    const received = await ctx.until(
      "the message to arrive in the reader mailbox",
      async () => {
        const found = await ctx.call(
          "gws-mcp__gmail_search",
          { query: `subject:"${ctx.stamp}"`, max_results: 5 },
          { as: "reader" }
        );
        const hits = (firstArray(resultJson("gmail_search", found)) ?? []) as { id?: string }[];
        return hits.find((h) => h.id)?.id;
      },
      { everyMs: 5_000, forMs: 120_000 }
    );

    // The RUN stamp, not this case's: D12 and D13 hunt for mail that
    // carries D10's subject, and the trash helper recognises the same
    // prefix. Sharing it is what makes a cross-case ride findable.
    ctx.share({ receivedId: received, token, subject, runStamp: ctx.runId.slice(0, 8) });
    ctx.defer("trash the received message", async () => {
      const gone = await ctx.trashOwnMessage(received, { as: "reader" });
      if (!gone) ctx.evidence(`RESIDUE: a received message could not be trashed`);
    });
    ctx.defer("trash the sent copy", async () => {
      if (!sentId) return;
      const gone = await ctx.trashOwnMessage(sentId, { as: "sender" });
      if (!gone) ctx.evidence(`RESIDUE: the sent copy could not be trashed`);
    });

    if (received === sentId) {
      throw new Error("the received id equals the sent id, so the search matched our own copy rather than the delivered one");
    }

    const body = resultText(
      await ctx.call("gws-mcp__gmail_read", { message_id: received }, { as: "reader" })
    );
    ctx.evidence(`the received message is ${body.length} characters`);
    if (!body.includes(token)) {
      throw new Error("the delivered message does not carry the token it was sent with");
    }
  },
};
