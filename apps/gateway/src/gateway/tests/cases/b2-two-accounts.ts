import type { TestCase } from "../types";

/**
 * B2 (Gateway scenario): the same tool, two accounts, DIFFERENT answers.
 *
 * Asserting that both calls succeed would pass while the gateway served the
 * same account twice, which is the failure worth catching: multi-account is
 * the one capability the native connectors cannot match, so a silent
 * collapse to one account breaks the product's whole claim while every call
 * returns 200.
 */
export const b2TwoAccounts: TestCase = {
  id: "B2",
  title: "the same tool answers differently for two accounts",
  covers: ["gws-mcp__gmail_list_labels"],
  accounts: ["sender", "reader"],
  /* With one Google account behind both roles there is no second account
   * to compare, and the payloads would be identical by construction. */
  distinctAccounts: true,
  run: async (ctx) => {
    const first = await ctx.call("gws-mcp__gmail_list_labels", {}, { as: "sender" });
    const second = await ctx.call("gws-mcp__gmail_list_labels", {}, { as: "reader" });

    const a = first.content.map((c) => c.text ?? "").join("");
    const b = second.content.map((c) => c.text ?? "").join("");
    ctx.evidence(`sender payload ${a.length} characters, reader payload ${b.length}`);

    if (first.isError || second.isError) {
      throw new Error("one of the two accounts could not be read, so the comparison proves nothing");
    }
    if (a === b) {
      throw new Error(
        "both accounts returned an identical payload, which is what serving the same account twice looks like"
      );
    }
  },
};
