import type { TestCase } from "../types";
import { firstBlockJson } from "../result-json";
import { POSTHOG_EXEC_CONTEXT } from "../posthog-exec";

/**
 * PH3 (PostHog scenario): a query runs through `exec` and its rows come back
 * (SCRUM-511). The query reads no table, so the answer is the same on any
 * project and nothing of the project's data is in the evidence.
 */
export const ph3PostHogExecSql: TestCase = {
  id: "PH3",
  title: "a query through PostHog's own server answers with its rows",
  covers: ["posthog__exec"],
  accounts: ["posthog"],
  run: async (ctx) => {
    const answer = firstBlockJson<{ results?: unknown }>(
      "posthog__exec call execute-sql",
      await ctx.call(
        "posthog__exec",
        { command: 'call --json execute-sql {"query": "SELECT 1 AS one"}', context: POSTHOG_EXEC_CONTEXT },
        { as: "posthog" }
      )
    );
    if (answer.results !== "one\n1") throw new Error("the query did not answer with its one column and one row");
    ctx.evidence("SELECT 1 AS one answered one column and one row");
  },
};
