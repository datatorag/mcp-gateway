import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * JR2 (Jira scenario): a user search answers with identified accounts.
 *
 * NO ADDRESS IS ASSERTED AND NONE IS PRINTED. A user search answers with
 * real people, and this repo is public: the case checks that every row
 * carries an `accountId`, counts them, and says nothing else about them.
 * `displayName` is somebody's name and stays out of every message too.
 *
 * The query is the fixture project's own key rather than a person: it is a
 * string we already use, it is not somebody's surname, and a tenant that
 * answers it at all is a tenant the connector reached. A search that matches
 * nobody is therefore not a failure of the connector and the case says so
 * rather than going red on the shape of our directory.
 *
 * WHICH MEANS THE EXPECTED RESULT IS EMPTY, and the title says "any account
 * it returns" for that reason: on most runs this step proves the endpoint
 * answered and nothing more. The per-row check is there for the run where
 * the directory does match, not as the usual outcome. Querying something
 * that reliably matched would mean putting a person into a public repo,
 * which is the worse trade.
 */
export const jr2JiraUsers: TestCase = {
  id: "JR2",
  title: "a jira user search answers, and any account it returns carries an account id",
  covers: ["atlassian-mcp__jira_search_users"],
  accounts: ["atlassian"],
  fixtures: ["jiraProject"],
  run: async (ctx) => {
    /* THE ANSWER MUST BE THE ARRAY, not merely contain one. This case is
     * the worst of the family, because the per-row check below is its ONLY
     * assertion, so anything that reaches it as an empty list passes.
     *
     * `firstArray` WAS NOT ENOUGH, and the first version of this fix used
     * it: it returns the first array under ANY key, so a Jira error
     * envelope like `{"errorMessages":[],"errors":{}}` handed back an empty
     * list and the case went green reporting "0 account(s)". `/user/search`
     * answers a BARE ARRAY, so that is what is required here. An empty one
     * still passes: nobody matching is a fact about our directory. */
    const answered = resultJson<unknown>(
      "jira_search_users",
      await ctx.call(
        "atlassian-mcp__jira_search_users",
        { query: ctx.fixture("jiraProject"), max_results: 5 },
        { as: "atlassian" }
      )
    );
    if (!Array.isArray(answered)) {
      throw new Error("jira_search_users answered with something that is not a list of accounts, so no account can be checked");
    }
    const users = answered as { accountId?: string }[];
    ctx.evidence(`the search answered with ${users.length} account(s)`);

    /* AN EMPTY RESULT IS NOT A FAILURE. It says the directory holds nobody
     * matching that string, which is a fact about our tenant rather than
     * about the connector; a tool that could not reach Jira throws instead
     * and `resultJson` turns that into a red with the tool's own words. */
    const anonymous = users.filter((u) => !u.accountId);
    if (anonymous.length > 0) {
      throw new Error(
        `${anonymous.length} of ${users.length} returned accounts carry no accountId, so they cannot be used to assign anything`
      );
    }
  },
};
