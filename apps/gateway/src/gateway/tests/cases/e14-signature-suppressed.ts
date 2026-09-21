import type { TestCase } from "../types";
import { firstArray, resultJson, resultText } from "../result-json";

/**
 * E14 (smoke row E14): `signature: false` must SUPPRESS, and the
 * send must say so.
 *
 * The escape hatch for the signature feature, and the setting the triage
 * digest depends on. Two halves, and the second is why this is not just
 * "assert the signature is absent": the response must report the signature
 * as SUPPRESSED rather than as unavailable or applied, because that word is
 * what a caller reads to know the flag did anything. A send that quietly
 * failed to find a signature would also produce a message without one.
 */
export const e14SignatureSuppressed: TestCase = {
  id: "E14",
  title: "signature false suppresses the signature and the send reports it",
  covers: ["gws-mcp__gmail_send", "gws-mcp__gmail_search", "gws-mcp__gmail_read"],
  accounts: ["sender", "reader"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const subject = `[smoke] E14 ${ctx.stamp}`;
    const token = `token-${ctx.stamp}`;

    const sent = await ctx.call(
      "gws-mcp__gmail_send",
      { to: ctx.address("reader"), subject, body: `Unsigned by request. ${token}`, signature: false },
      { as: "sender" }
    );
    const answer = resultText(sent);
    const sentId = resultJson<{ id?: string }>("gmail_send", sent).id;
    ctx.evidence(`the send answered ${answer.length} characters`);

    const received = await ctx.until(
      "the unsigned message to arrive",
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
    ctx.defer("trash the sent copy", async () => {
      if (!sentId) return;
      if (!(await ctx.trashOwnMessage(sentId, { as: "sender" }))) {
        ctx.evidence("RESIDUE: a sent copy could not be trashed");
      }
    });

    // SUPPRESSED, not merely absent. "unavailable" would mean the lookup
    // failed and the flag did nothing, which produces the same message.
    if (/unavailable/i.test(answer)) {
      throw new Error("the send reports the signature as unavailable, so the flag is indistinguishable from a failed lookup");
    }
    if (!/suppress/i.test(answer)) {
      throw new Error("the send does not report the signature as suppressed, so a caller cannot tell the flag worked");
    }

    const body = resultText(
      await ctx.call("gws-mcp__gmail_read", { message_id: received }, { as: "reader" })
    );
    if (/gmail_signature/.test(body)) {
      throw new Error("the delivered message carries a gmail_signature element despite signature false");
    }
    if (!body.includes(token)) throw new Error("the delivered message does not carry its token");
  },
};
