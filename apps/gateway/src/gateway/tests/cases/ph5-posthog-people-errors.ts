import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * PH5 (PostHog scenario): people search and error issues answer in their
 * shape (SCRUM-471). One person at most, and only a count reaches the
 * evidence: people's properties are not the run's to keep.
 */
export const ph5PostHogPeopleErrors: TestCase = {
  id: "PH5",
  title: "people search and error issues answer in their shape",
  covers: ["posthog-mcp__posthog_persons_search", "posthog-mcp__posthog_error_issues_list"],
  accounts: ["posthog"],
  run: async (ctx) => {
    const persons = resultJson<{ persons?: Array<{ distinct_ids?: unknown }> }>(
      "posthog_persons_search",
      await ctx.call("posthog-mcp__posthog_persons_search", { search: "@", limit: 1 }, { as: "posthog" })
    );
    if (!Array.isArray(persons.persons) || persons.persons.some((p) => !Array.isArray(p.distinct_ids))) {
      throw new Error("people search did not answer in its shape");
    }
    const issues = resultJson<{ issues?: Array<Record<string, unknown>> }>(
      "posthog_error_issues_list",
      await ctx.call("posthog-mcp__posthog_error_issues_list", { date_from: "-30d", date_to: "-1h", limit: 3 }, { as: "posthog" })
    );
    if (!Array.isArray(issues.issues)) throw new Error("error issues did not answer a list");
    ctx.evidence(`${persons.persons.length} person(s); ${issues.issues.length} issue(s)`);
  },
};
