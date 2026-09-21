import type { TestCase } from "../types";
import { resultText } from "../result-json";

/**
 * JR7 (Jira scenario): the delete refuses a key it does not recognise.
 *
 * `jira_delete_issue` is the one call in this connector that cannot be taken
 * back, and it is the only one that validates its argument's SHAPE before
 * sending anything. Everywhere else a malformed key costs a 404; here it
 * would be an irreversible request built from input nobody recognised.
 *
 * THE GUARD IS THE PRODUCT BEHAVIOUR, so it gets a step. A case that only
 * exercised the happy path would let the check be deleted as dead code.
 *
 * A REFUSAL ARRIVES AS `isError`, NOT AS A THROW. The first version of this
 * case used try/catch, which is how a tool failure reads in most languages
 * and is not how it reads here: the gateway's plugin proxy returns
 * `{ content, isError: true }` on both its success and its catch path, so
 * `ctx.call` resolves either way and the catch never ran. That version could
 * not pass. It would have reported that the irreversible delete ACCEPTS
 * arbitrary input, against a guard doing its job, and written that into the
 * evidence a person reads. Every other refusal case in the suite already
 * checks `isError`; this one now does too.
 *
 * THE TEXT IS CHECKED, NOT JUST THE REFUSAL. A 404 from Jira is also an
 * `isError`, and a 404 means the request was sent, which is the thing this
 * case exists to prevent. Only the local message distinguishes them.
 */
export const jr7JiraKeyRefused: TestCase = {
  id: "JR7",
  title: "deleting an issue is refused locally when the key is not a jira key",
  covers: ["atlassian-mcp__jira_delete_issue"],
  accounts: ["atlassian"],
  fixtures: ["jiraProject"],
  run: async (ctx) => {
    /* None of these is an issue: a bare project key, a JQL fragment, a path
     * traversal, a negative number, a key with the number missing, and
     * nothing at all.
     *
     * THE PROJECT COMES FROM THE FIXTURE, not a literal. An earlier version
     * spelled it out, which contradicted the rule stated where the fixture
     * keys are declared, and `no-fixture-values.test.ts` could not catch it:
     * that guard ignores values under nine characters. */
    const project = ctx.fixture("jiraProject");
    const notKeys = [project, `project = ${project}`, "../../admin", "-1", "scrum-", ""];

    for (const issue_key of notKeys) {
      const result = await ctx.call(
        "atlassian-mcp__jira_delete_issue",
        { issue_key },
        { as: "atlassian" }
      );
      if (!result.isError) {
        throw new Error(
          `deleting ${JSON.stringify(issue_key)} was accepted, so a delete can be built from input that is not an issue key`
        );
      }
      const said = resultText(result);
      if (!/not a jira issue key/i.test(said)) {
        throw new Error(
          `deleting ${JSON.stringify(issue_key)} was refused, but not by the local key-shape check, so the request may have reached Jira`
        );
      }
    }
    ctx.evidence(`${notKeys.length} inputs that are not issue keys were each refused before any request`);
  },
};
