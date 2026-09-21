import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * JR1 (Jira scenario): the field catalogue answers, and answers about Jira.
 *
 * `jira_list_fields` takes NO arguments, which is what makes it worth a step
 * of its own: it is the one Atlassian call that cannot be wrong about what
 * it was asked for, so a failure here is the connector or the tenant rather
 * than the request. It runs before anything is created for that reason.
 *
 * THE ASSERTION IS SHAPE, NOT MEMBERSHIP. Naming a field this tenant happens
 * to have would pin somebody's board configuration into a public repo and
 * would go red the day an admin renames it. Every catalogue entry carries an
 * `id` and a `name`, so that is what is checked, on every row rather than
 * on the first: a reader that fills the first row and truncates the rest
 * passes a spot check.
 */
export const jr1JiraFields: TestCase = {
  id: "JR1",
  title: "the jira field catalogue answers with identified fields",
  covers: ["atlassian-mcp__jira_list_fields"],
  accounts: ["atlassian"],
  run: async (ctx) => {
    const fields = (firstArray(
      resultJson("jira_list_fields", await ctx.call("atlassian-mcp__jira_list_fields", {}, { as: "atlassian" }))
    ) ?? []) as { id?: string; name?: string }[];
    ctx.evidence(`the catalogue carries ${fields.length} field(s)`);

    if (fields.length === 0) {
      throw new Error("the jira field catalogue is empty, so the connector answered without reaching the tenant");
    }
    const unidentified = fields.filter((f) => !f.id || !f.name);
    if (unidentified.length > 0) {
      throw new Error(
        `${unidentified.length} of ${fields.length} catalogue entries lack an id or a name, so the catalogue is not usable for choosing a field`
      );
    }
  },
};
