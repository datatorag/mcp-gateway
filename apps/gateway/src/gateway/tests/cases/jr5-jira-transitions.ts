import type { TestCase } from "../types";
import { resultJson } from "../result-json";

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
      /* STRICT, by the same rule as the transitions read above: the
       * serialiser always emits `status` (as a name or null), so an absent
       * key is an unreadable body rather than a statusless issue. Not a
       * live masking path, since an unreadable read nulls both sides and
       * the comparison reds anyway, but it should follow the same rule as
       * the read above it. An earlier version of this comment called it
       * "the last `??` of this family left in these cases", which was
       * wrong: SK2 and E13 had the same shape and were found afterwards. */
      if (typeof issue !== "object" || issue === null || Array.isArray(issue)) {
        throw new Error("jira_get_issue answered with something that is not an issue object, so the status cannot be read");
      }
      if (!("status" in issue)) {
        throw new Error("jira_get_issue answered without a status field, so the transition cannot be checked");
      }
      return issue.status ?? null;
    };
    const before = await statusOf();

    /* THE NAMED FIELD, NOT ANY ARRAY. An unreadable response became "0
     * offered" and the throw below then blamed the WORKFLOW, sending
     * somebody to fix a Jira board when the READ is what failed.
     *
     * `firstArray` DID NOT FIX THAT, and the first version of this fix used
     * it. It returns the first array under ANY key, and a Jira error
     * envelope carries `errorMessages`, which is an array: an empty one
     * reproduced the workflow-blaming red exactly, and a populated one was
     * counted as transitions, so the evidence line said "1 transition(s)"
     * about an error string. Atlassian answers `{expand, transitions}`, so
     * the field is read by name, as JR4 reads `comments`. */
    const envelope = resultJson<{ transitions?: unknown }>(
      "jira_get_transitions",
      await ctx.call("atlassian-mcp__jira_get_transitions", { issue_key }, { as: "atlassian" })
    );
    if (!Array.isArray(envelope.transitions)) {
      throw new Error("jira_get_transitions answered without a transitions list, so the board's offer cannot be read");
    }
    const offered = envelope.transitions as { id?: string; name?: string; to?: { name?: string } }[];
    ctx.evidence(`the board offers ${offered.length} transition(s) from the created status`);

    /* A BOARD PROBLEM, named as one. A workflow with no transition out of
     * its first status is a configuration this case cannot work around, and
     * reporting it as a connector fault would send the reader to the wrong
     * place. */
    /* A ROW THIS CASE CANNOT READ IS NOT A BOARD WITH NOTHING TO OFFER.
     * The envelope guard above stops an unreadable RESPONSE reaching the
     * workflow-blaming red; the same mistake lives one level down, because
     * a restructured row (no `to`, or a bare string) makes the find below
     * come back empty and blames the board for it. Rows that carry what a
     * transition needs are counted first, and a listing that has rows but
     * none of them usable says so. */
    const usable = offered.filter((t) => t && typeof t === "object" && t.id && t.to?.name);
    if (offered.length > 0 && usable.length === 0) {
      throw new Error(
        `the board returned ${offered.length} transition(s) and none carries an id and a destination name, so this is the shape of the answer rather than the workflow`
      );
    }

    const leaving = usable.find((t) => t.to?.name !== before);
    if (!leaving?.id) {
      throw new Error(
        `the board offers no transition out of this issue's starting status (${usable.length} usable of ${offered.length} offered), so a status change cannot be told from no change; this is the workflow, not the connector`
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
