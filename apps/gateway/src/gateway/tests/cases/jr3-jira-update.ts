import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * JR3 (Jira scenario): an update changes the stored issue.
 *
 * ON ITS OWN ISSUE, created and deleted here. Nothing in this scenario edits
 * an issue somebody is using.
 *
 * THE ASSERTION RE-READS THROUGH `jira_get_issue`, because
 * `jira_update_issue` answers with the sentence `Issue KEY updated
 * successfully.` and nothing else. Believing that sentence would pass
 * against a handler that returned it without issuing the PUT, which is the
 * whole failure this step exists to catch.
 *
 * SUMMARY, NOT DESCRIPTION. A description goes through `textToAdf` on the
 * way in and comes back as an ADF document, so a round trip would compare a
 * string against a tree and would be asserting the converter rather than the
 * update. The summary is stored and returned as a plain string.
 */
export const jr3JiraUpdate: TestCase = {
  id: "JR3",
  title: "updating an issue's summary changes what a later get returns",
  covers: [
    "atlassian-mcp__jira_create_issue",
    "atlassian-mcp__jira_update_issue",
    "atlassian-mcp__jira_get_issue",
    "atlassian-mcp__jira_delete_issue",
  ],
  accounts: ["atlassian"],
  fixtures: ["jiraProject"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const before = `[smoke] JR3 before ${ctx.stamp}`;
    const after = `[smoke] JR3 after ${ctx.stamp}`;

    const created = resultJson<{ key?: string }>(
      "jira_create_issue",
      await ctx.call(
        "atlassian-mcp__jira_create_issue",
        { project_key: ctx.fixture("jiraProject"), summary: before },
        { as: "atlassian" }
      )
    );
    const issue_key = created.key;
    if (!issue_key) throw new Error("jira_create_issue answered without a key, so there is nothing to update or delete");

    ctx.defer("delete the created issue", async () => {
      /* A CLEANUP THAT FAILED MUST SAY SO. `ctx.call` resolves on a tool
       * error, so an unchecked delete here would leave a live issue on the
       * tenant while the run reported `cleanup: clean`. */
      const gone = await ctx.call("atlassian-mcp__jira_delete_issue", { issue_key }, { as: "atlassian" });
      if (gone.isError) ctx.evidence("RESIDUE: the created issue could not be deleted and is still on the board");
    });

    const updated = await ctx.call(
      "atlassian-mcp__jira_update_issue",
      { issue_key, summary: after },
      { as: "atlassian" }
    );
    /* Checked here so the re-read below reports what it finds rather than
     * blaming a handler that reported success: `ctx.call` resolves on a
     * tool error, so an unchecked write turns into a confusing red later. */
    if (updated.isError) throw new Error("jira_update_issue refused the update, so there is nothing to re-read");

    const reread = resultJson<{ key?: string; summary?: string }>(
      "jira_get_issue",
      await ctx.call("atlassian-mcp__jira_get_issue", { issue_key }, { as: "atlassian" })
    );
    if (reread.key !== issue_key) {
      throw new Error("the re-read answered about a different issue than the one updated");
    }
    if (reread.summary === before) {
      throw new Error("the issue still carries its original summary, so the update did not reach Jira");
    }
    if (reread.summary !== after) {
      throw new Error(
        `the updated issue's summary is neither the one it was created with nor the one it was updated to (${String(reread.summary ?? "").length} characters)`
      );
    }
    ctx.evidence("the summary changed from the created value to the updated one");
  },
};
