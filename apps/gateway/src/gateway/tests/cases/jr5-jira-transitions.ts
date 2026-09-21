import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * JR5 (Jira scenario): an issue moves to a status the board offered.
 *
 * THE TRANSITION IS CHOSEN FROM WHAT JIRA OFFERS, never from a literal. A
 * transition id is workflow configuration: hard-coding one would pin this
 * tenant's board into a public repo and would go red the day somebody edits
 * the workflow. `jira_get_transitions` is therefore not decoration before
 * the write, it is where the argument comes from.
 *
 * THE ASSERTION RE-READS THE STATUS. `jira_transition_issue` answers with
 * the sentence `Issue KEY transitioned successfully (transition N).` and
 * carries no state, so believing it would pass against a handler that never
 * issued the POST.
 *
 * WHAT A CHANGED STATUS DOES AND DOES NOT PROVE: the case asserts the status
 * is no longer the one the issue was created in. It does not assert which
 * status it became, because the transition's `to` name is workflow
 * configuration again. A board whose offered transition leads back to the
 * same status would fail this honestly rather than silently, and the message
 * says so.
 */
export const jr5JiraTransitions: TestCase = {
  id: "JR5",
  title: "an issue transitions to a status the board offered, and a later get shows it",
  covers: [
    "atlassian-mcp__jira_create_issue",
    "atlassian-mcp__jira_get_transitions",
    "atlassian-mcp__jira_transition_issue",
    "atlassian-mcp__jira_get_issue",
    "atlassian-mcp__jira_delete_issue",
  ],
  accounts: ["atlassian"],
  fixtures: ["jiraProject"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const created = resultJson<{ key?: string }>(
      "jira_create_issue",
      await ctx.call(
        "atlassian-mcp__jira_create_issue",
        { project_key: ctx.fixture("jiraProject"), summary: `[smoke] JR5 ${ctx.stamp}` },
        { as: "atlassian" }
      )
    );
    const issue_key = created.key;
    if (!issue_key) throw new Error("jira_create_issue answered without a key, so there is nothing to transition");
    ctx.defer("delete the created issue", async () => {
      /* A CLEANUP THAT FAILED MUST SAY SO. `ctx.call` resolves on a tool
       * error, so an unchecked delete here would leave a live issue on the
       * tenant while the run reported `cleanup: clean`. */
      const gone = await ctx.call("atlassian-mcp__jira_delete_issue", { issue_key }, { as: "atlassian" });
      if (gone.isError) ctx.evidence("RESIDUE: the created issue could not be deleted and is still on the board");
    });

    const statusOf = async () => {
      const issue = resultJson<{ status?: string | null }>(
        "jira_get_issue",
        await ctx.call("atlassian-mcp__jira_get_issue", { issue_key }, { as: "atlassian" })
      );
      return issue.status ?? null;
    };
    const before = await statusOf();

    const offered = (firstArray(
      resultJson(
        "jira_get_transitions",
        await ctx.call("atlassian-mcp__jira_get_transitions", { issue_key }, { as: "atlassian" })
      )
    ) ?? []) as { id?: string; name?: string; to?: { name?: string } }[];
    ctx.evidence(`the board offers ${offered.length} transition(s) from the created status`);

    /* A BOARD PROBLEM, named as one. A workflow with no transition out of
     * its first status is a configuration this case cannot work around, and
     * reporting it as a connector fault would send the reader to the wrong
     * place. */
    const leaving = offered.find((t) => t.id && t.to?.name && t.to.name !== before);
    if (!leaving?.id) {
      throw new Error(
        `the board offers no transition out of this issue's starting status (${offered.length} offered), so a status change cannot be told from no change; this is the workflow, not the connector`
      );
    }

    const moved = await ctx.call(
      "atlassian-mcp__jira_transition_issue",
      { issue_key, transition_id: leaving.id },
      { as: "atlassian" }
    );
    if (moved.isError) throw new Error("jira_transition_issue refused a transition the board had just offered");

    const after = await statusOf();
    if (after === before) {
      throw new Error(
        "the issue's status is unchanged after a transition the board offered, so the transition was reported rather than made"
      );
    }
    ctx.evidence("the status changed to a different one after the offered transition");
  },
};
