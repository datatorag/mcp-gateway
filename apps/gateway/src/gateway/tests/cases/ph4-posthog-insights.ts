import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * PH4 (PostHog scenario): the fixture insight is found by its short id, and
 * the saved insights and dashboards lists answer (SCRUM-471). Read only:
 * the cached result is read, nothing is recomputed.
 */
export const ph4PostHogInsights: TestCase = {
  id: "PH4",
  title: "the fixture insight reads back, and insights and dashboards list",
  covers: ["posthog-mcp__posthog_insight_get", "posthog-mcp__posthog_insights_list", "posthog-mcp__posthog_dashboards_list"],
  accounts: ["posthog"],
  run: async (ctx) => {
    const shortId = ctx.fixture("posthogInsight");
    const insight = resultJson<{ short_id?: unknown; name?: unknown }>(
      "posthog_insight_get",
      await ctx.call("posthog-mcp__posthog_insight_get", { short_id: shortId }, { as: "posthog" })
    );
    if (insight.short_id !== shortId) throw new Error("the insight that answered is not the fixture insight");
    const list = resultJson<{ insights?: unknown[] }>(
      "posthog_insights_list",
      await ctx.call("posthog-mcp__posthog_insights_list", { limit: 5 }, { as: "posthog" })
    );
    if (!Array.isArray(list.insights) || list.insights.length === 0) throw new Error("saved insights listed none, though the fixture is one");
    const dashboards = resultJson<{ dashboards?: unknown[] }>(
      "posthog_dashboards_list",
      await ctx.call("posthog-mcp__posthog_dashboards_list", { limit: 5 }, { as: "posthog" })
    );
    if (!Array.isArray(dashboards.dashboards)) throw new Error("dashboards did not answer a list");
    ctx.evidence(`the fixture insight read back; ${list.insights.length} insight(s), ${dashboards.dashboards.length} dashboard(s) listed`);
  },
};
