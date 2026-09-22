import type { TestCase } from "../types";
import { jiraProjectKey } from "../jira-project";
import { resultText } from "../result-json";

/**
 * B1 (Gateway scenario): a stored provider token still works.
 *
 * The failure here is silent and delayed: a token that expired last night
 * breaks every write today, and nobody learns until they try a tool. One
 * authenticated call per connected provider is the cheapest possible alarm.
 *
 * The refresh-event half stays with the agent. Asserting the CALL is the
 * stronger claim anyway: an event says a refresh happened, a successful call
 * says the credential works.
 */
export const b1StoredToken: TestCase = {
  id: "B1",
  title: "a stored token authenticates a call to each connected provider",
  covers: ["gws-mcp__gmail_list_labels", "atlassian-mcp__jira_search"],
  accounts: ["sender", "atlassian"],
  fixtures: ["jiraProject"],
  run: async (ctx) => {
    const google = await ctx.call("gws-mcp__gmail_list_labels", {}, { as: "sender" });
    const googleText = resultText(google);
    ctx.evidence(`google: ${google.isError ? "error" : `${googleText.length} characters`}`);
    if (google.isError) throw new Error(`the stored Google token did not authenticate: ${googleText}`);

    const atlassian = await ctx.call(
      "atlassian-mcp__jira_search",
      { jql: `project = ${jiraProjectKey(ctx)} ORDER BY created DESC`, max_results: 1 },
      { as: "atlassian" }
    );
    const atlassianText = resultText(atlassian);
    ctx.evidence(`atlassian: ${atlassian.isError ? "error" : `${atlassianText.length} characters`}`);
    if (atlassian.isError) {
      throw new Error(`the stored Atlassian token did not authenticate: ${atlassianText}`);
    }
  },
};
