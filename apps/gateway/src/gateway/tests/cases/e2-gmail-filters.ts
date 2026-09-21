import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * E2 (smoke row E2, tier 2): an account with no filters answers a
 * WELL-FORMED EMPTY LIST, not an empty string.
 *
 * The distinction is the case. "No filters" and "the call fell over quietly"
 * look identical to a caller that only checks for truthiness, and an empty
 * string is what a tool returns when it has lost track of its own shape. A
 * list of length zero is an answer; an empty string is a shrug.
 */
export const e2GmailFilters: TestCase = {
  id: "E2",
  title: "an account with no filters answers an empty list, not an empty string",
  tier: 2,
  covers: ["gws-mcp__gmail_list_filters"],
  accounts: ["sender"],
  run: async (ctx) => {
    const result = await ctx.call("gws-mcp__gmail_list_filters", {}, { as: "sender" });
    const parsed = resultJson("gmail_list_filters", result);
    const list = firstArray(parsed);

    ctx.evidence(`filters answered a ${Array.isArray(parsed) ? "bare array" : typeof parsed}`);
    if (list === null) {
      throw new Error("gmail_list_filters answered without a list anywhere in it, so zero filters is indistinguishable from a broken call");
    }
    ctx.evidence(`${list.length} filter(s), which is a fine number including zero`);
  },
};
