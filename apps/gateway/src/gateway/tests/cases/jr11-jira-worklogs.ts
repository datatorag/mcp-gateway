import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type Worklogs = {
  total?: number;
  total_time_spent_seconds?: number;
  worklogs?: { id?: string; time_spent_seconds?: number; comment?: string | null }[];
};

/**
 * JR11 (Jira scenario, SCRUM-428): time logged with `jira_add_worklog` is what
 * `jira_list_worklogs` then reports, on an issue this case creates and deletes.
 *
 * Two worklogs of different lengths, so the total proves both were stored and
 * neither was counted twice: 15m and 1h are 4500 seconds together, and no
 * single worklog or doubled one comes to that. Every count is read back; the
 * add's own answer is only used for the id.
 */
export const jr11JiraWorklogs: TestCase = {
  id: "JR11",
  title: "time logged on an issue is what a later read of its worklogs reports",
  covers: [
    "atlassian-mcp__jira_create_issue",
    "atlassian-mcp__jira_add_worklog",
    "atlassian-mcp__jira_list_worklogs",
    "atlassian-mcp__jira_delete_issue",
  ],
  accounts: ["atlassian"],
  fixtures: ["jiraProject"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const issue_key = resultJson<{ key?: string }>(
      "jira_create_issue",
      await ctx.call(
        "atlassian-mcp__jira_create_issue",
        { project_key: ctx.fixture("jiraProject"), summary: `[smoke] JR11 ${ctx.stamp}` },
        { as: "atlassian" }
      )
    ).key;
    if (!issue_key) throw new Error("jira_create_issue answered without a key, so there is nothing to log time on");
    ctx.defer("delete the created issue", async () => {
      const gone = await ctx.call("atlassian-mcp__jira_delete_issue", { issue_key }, { as: "atlassian" });
      if (gone.isError) ctx.evidence("RESIDUE: the created issue could not be deleted and is still on the board");
    });

    const read = async () =>
      resultJson<Worklogs>("jira_list_worklogs", await ctx.call("atlassian-mcp__jira_list_worklogs", { issue_key }, { as: "atlassian" }));

    const before = await read();
    if (!Array.isArray(before.worklogs)) throw new Error("jira_list_worklogs answered without a worklogs array");
    if (before.worklogs.length !== 0) throw new Error(`a new issue already carries ${before.worklogs.length} worklog(s)`);

    const marker = `JR11 ${ctx.stamp}`;
    const first = resultJson<{ worklog?: { id?: string } }>(
      "jira_add_worklog",
      await ctx.call("atlassian-mcp__jira_add_worklog", { issue_key, time_spent: "15m", comment: marker }, { as: "atlassian" })
    );
    if (!first.worklog?.id) throw new Error("jira_add_worklog answered without a worklog id");
    await ctx.call(
      "atlassian-mcp__jira_add_worklog",
      { issue_key, time_spent: "1h", started: "2028-11-20T17:00:00Z" },
      { as: "atlassian" }
    );

    const after = await read();
    ctx.evidence(`after two worklogs: ${after.worklogs?.length} listed, ${after.total_time_spent_seconds} seconds in total`);
    if (after.worklogs?.length !== 2) throw new Error(`two worklogs were added and ${after.worklogs?.length} are listed`);
    if (after.total_time_spent_seconds !== 4500) throw new Error(`15m and 1h should total 4500 seconds, and the issue reports ${after.total_time_spent_seconds}`);
    const ours = after.worklogs.find((w) => w.id === first.worklog?.id);
    if (!ours) throw new Error("the first worklog's id is not among those listed");
    if (ours.time_spent_seconds !== 900) throw new Error(`the 15m worklog is stored as ${ours.time_spent_seconds} seconds`);
    if (!(ours.comment ?? "").includes(marker)) throw new Error("the first worklog's comment is not the text it was logged with");
  },
};
