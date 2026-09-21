import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * C8: Confluence answers a bounded search.
 *
 * ALSO A TENANT-EXPIRY ALARM, which is why it earns a case despite asserting
 * so little. A free tenant suspends after months idle and keeps its data for
 * a short window after that, so the useful signal is "this still responds at
 * all", caught early enough to act on.
 *
 * It deliberately does not require a hit: an empty space is a fair state of
 * the world, and asserting content would make this red for a reason that is
 * not ours.
 */
export const c8ConfluenceSearch: TestCase = {
  id: "C8",
  title: "a bounded confluence search returns without error",
  covers: ["atlassian-mcp__confluence_search"],
  accounts: ["atlassian"],
  run: async (ctx) => {
    const result = await ctx.call(
      "atlassian-mcp__confluence_search",
      { cql: "type = page ORDER BY lastmodified DESC", limit: 5 },
      { as: "atlassian" }
    );
    // Parsed rather than merely not-error: a tool that answered prose on a
    // suspended tenant would pass an isError check.
    resultJson("confluence_search", result);
    ctx.evidence("the tenant answered a bounded CQL search");
  },
};
