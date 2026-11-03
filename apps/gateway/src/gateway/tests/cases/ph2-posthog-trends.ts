import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * PH2 (PostHog scenario): a trend over a closed range answers one series,
 * and the web analytics overview answers its metrics (SCRUM-471). Both end
 * on an explicit date, so the numbers are the same on a rerun.
 */
export const ph2PostHogTrends: TestCase = {
  id: "PH2",
  title: "a trend over a closed range answers one series, and web analytics answers",
  covers: ["posthog-mcp__posthog_trends_query", "posthog-mcp__posthog_web_overview"],
  accounts: ["posthog"],
  run: async (ctx) => {
    const range = { date_from: "-8d", date_to: "-1d" };
    const trend = resultJson<{ series?: Array<{ data?: unknown }> }>(
      "posthog_trends_query",
      await ctx.call("posthog-mcp__posthog_trends_query", { series: [{ event: "$pageview" }], ...range, interval: "day" }, { as: "posthog" })
    );
    if (trend.series?.length !== 1 || !Array.isArray(trend.series[0].data)) throw new Error("the trend did not answer one series of data points");
    const web = resultJson<{ metrics?: Array<{ key?: unknown }> }>(
      "posthog_web_overview",
      await ctx.call("posthog-mcp__posthog_web_overview", range, { as: "posthog" })
    );
    if (!Array.isArray(web.metrics) || web.metrics.length === 0) throw new Error("web analytics answered no metrics");
    ctx.evidence(`one series of ${(trend.series[0].data as unknown[]).length} points; ${web.metrics.length} web metrics`);
  },
};
