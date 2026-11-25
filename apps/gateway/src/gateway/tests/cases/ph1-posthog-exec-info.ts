import type { TestCase } from "../types";
import { firstTextBlock } from "../result-json";
import { POSTHOG_EXEC_CONTEXT } from "../posthog-exec";

/**
 * PH1 (PostHog scenario): PostHog's own server answers through the gateway
 * (SCRUM-511). `info` describes one of PostHog's tools and runs none.
 *
 * First because it reads nothing of the project: when it is red the stored
 * token, the listing or the pass-through is the problem, and every later
 * step would be red for the same reason.
 */
export const ph1PostHogExecInfo: TestCase = {
  id: "PH1",
  title: "PostHog's own server describes one of its tools through the gateway",
  covers: ["posthog__exec"],
  accounts: ["posthog"],
  run: async (ctx) => {
    const answer = firstTextBlock(
      "posthog__exec info",
      await ctx.call("posthog__exec", { command: "info project-get", context: POSTHOG_EXEC_CONTEXT }, { as: "posthog" })
    );
    if (!answer.startsWith("name: project-get")) throw new Error("info did not answer with the description of the tool it was asked about");
    ctx.evidence("info answered with the description of project-get");
  },
};
