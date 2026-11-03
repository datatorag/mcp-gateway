import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * PH3 (PostHog scenario): a HogQL query asking for more rows than the cap
 * comes back at the cap or under it, and recent events answer in their shape
 * (SCRUM-471).
 */
export const ph3PostHogHogQL: TestCase = {
  id: "PH3",
  title: "a HogQL query over the row cap comes back capped, and events answer",
  covers: ["posthog-mcp__posthog_hogql_query", "posthog-mcp__posthog_events_list"],
  accounts: ["posthog"],
  run: async (ctx) => {
    const q = resultJson<{ columns?: unknown[]; rows?: unknown[] }>(
      "posthog_hogql_query",
      await ctx.call(
        "posthog-mcp__posthog_hogql_query",
        { query: "SELECT event FROM events WHERE timestamp > now() - INTERVAL 1 DAY LIMIT 5000", limit: 3 },
        { as: "posthog" }
      )
    );
    if (!Array.isArray(q.rows) || q.rows.length > 3) throw new Error("the query's LIMIT was not lowered to the one asked for");
    const events = resultJson<{ events?: Array<Record<string, unknown>> }>(
      "posthog_events_list",
      await ctx.call("posthog-mcp__posthog_events_list", { date_from: "-2d", date_to: "-1h", limit: 3 }, { as: "posthog" })
    );
    if (!Array.isArray(events.events) || events.events.some((e) => typeof e.event !== "string")) throw new Error("events did not answer in their shape");
    ctx.evidence(`${q.rows.length} row(s) under a LIMIT asked as 3; ${events.events.length} event(s)`);
  },
};
