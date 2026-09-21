import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * C7 (tier 1): the Atlassian connector answers a bounded search.
 *
 * The account is passed explicitly by ROLE, which matters more here than
 * anywhere else in the suite: the default Atlassian site is not ours, and a
 * test that silently hits the wrong tenant is worse than no test. The role
 * cannot resolve to a default account — an unmapped role skips the case.
 */
export const c7JiraSearch: TestCase = {
  id: "C7",
  title: "a bounded jira search returns issues from our own project",
  tier: 1,
  covers: ["atlassian-mcp__jira_search"],
  accounts: ["atlassian"],
  run: async (ctx) => {
    const result = await ctx.call(
      "atlassian-mcp__jira_search",
      { jql: "project = SCRUM ORDER BY created DESC", max_results: 5 },
      { as: "atlassian" }
    );
    const issues = firstArray(resultJson("jira_search", result)) ?? [];
    ctx.evidence(`the bounded JQL returned ${issues.length} issue(s)`);

    if (issues.length === 0) {
      throw new Error("a search of our own project returned nothing, so the Atlassian connector is down or pointed elsewhere");
    }
    const keys = issues.map((i) => (i as { key?: string }).key ?? "");
    const wrong = keys.filter((k) => !/^SCRUM-\d+$/.test(k));
    if (wrong.length > 0) {
      throw new Error(`${wrong.length} of ${keys.length} results are not SCRUM keys, so the search reached a different project or tenant`);
    }
  },
};
