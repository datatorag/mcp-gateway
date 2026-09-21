import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * C2: Gmail search answers, with the fields a caller reads.
 *
 * The query has to be one that ALWAYS matches. An empty result from a
 * narrow query is indistinguishable from a broken tool, and a case that
 * cannot tell those apart reports green on a dead connector.
 *
 * It asserts the FIELDS are populated, not just that a message came back:
 * gmail_search flattens from/subject/date, and a regression that returned
 * bare ids would still return a non-empty list.
 */
export const c2GmailSearch: TestCase = {
  id: "C2",
  title: "gmail search returns a message with its headers populated",
  covers: ["gws-mcp__gmail_search"],
  accounts: ["sender"],
  run: async (ctx) => {
    const result = await ctx.call(
      "gws-mcp__gmail_search",
      { query: "in:anywhere", max_results: 1 },
      { as: "sender" }
    );
    const messages = firstArray(resultJson("gmail_search", result));
    ctx.evidence(`in:anywhere returned ${messages?.length ?? 0} message(s)`);

    if (!messages || messages.length === 0) {
      throw new Error("a query that matches everything returned nothing, so Gmail reads are broken");
    }

    const first = messages[0] as Record<string, unknown>;
    // Named without their values: a subject line is somebody's mail.
    const missing = ["from", "subject", "date"].filter(
      (field) => typeof first[field] !== "string" || (first[field] as string).trim() === ""
    );
    if (missing.length > 0) {
      throw new Error(`the message came back without ${missing.join(", ")}, so the flattening regressed`);
    }
    ctx.evidence("from, subject and date are all present on the first result");
  },
};
