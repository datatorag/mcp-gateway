import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * PH1 (PostHog scenario): the stored PostHog token authenticates, and the
 * connection's one project answers as the fixture project (SCRUM-471).
 *
 * First because it needs no fixture beyond the account: when it is red the
 * token or the project header is the problem, and every later step would be
 * red for the same reason. It also checks the project's API token is never
 * handed back.
 */
export const ph1PostHogProject: TestCase = {
  id: "PH1",
  title: "the connected PostHog project answers, without its API token",
  covers: ["posthog-mcp__posthog_project_get"],
  accounts: ["posthog"],
  run: async (ctx) => {
    const project = resultJson<Record<string, unknown>>(
      "posthog_project_get",
      await ctx.call("posthog-mcp__posthog_project_get", {}, { as: "posthog" })
    );
    if (String(project.id) !== ctx.address("posthog")) throw new Error("the project that answered is not the connection's project");
    if ("api_token" in project || "test_account_filters" in project) throw new Error("the project answered with a field the tool leaves out");
    ctx.evidence(`the project answered, with timezone ${String(project.timezone)}`);
  },
};
