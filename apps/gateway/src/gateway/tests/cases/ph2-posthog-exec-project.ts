import type { TestCase } from "../types";
import { firstBlockJson } from "../result-json";
import { POSTHOG_EXEC_CONTEXT } from "../posthog-exec";

/**
 * PH2 (PostHog scenario): a call through `exec` runs as the connection's
 * one project (SCRUM-511). The project that answers must be the one the
 * `posthog` role maps to, so a call can never have run on another project.
 *
 * Only the first text block is the project: PostHog follows it with a notice
 * and a conversation id, which are not part of the answer.
 */
export const ph2PostHogExecProject: TestCase = {
  id: "PH2",
  title: "the connected PostHog project answers as the connection's project",
  covers: ["posthog__exec"],
  accounts: ["posthog"],
  run: async (ctx) => {
    const project = firstBlockJson<Record<string, unknown>>(
      "posthog__exec call project-get",
      await ctx.call("posthog__exec", { command: "call --json project-get {}", context: POSTHOG_EXEC_CONTEXT }, { as: "posthog" })
    );
    if (String(project.id) !== ctx.address("posthog")) throw new Error("the project that answered is not the connection's project");
    ctx.evidence("the project that answered is the connection's project");
  },
};
