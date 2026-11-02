import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * BR6 (Brevo scenario): the transactional templates, statistics and log, and
 * the recipients export of the fixture sent campaign, followed to its process
 * (SCRUM-468). Reads only.
 */
export const br6BrevoReports: TestCase = {
  id: "BR6",
  title: "templates, statistics, the event log and a recipients export answer",
  covers: [
    "brevo-mcp__templates_get",
    "brevo-mcp__email_stats",
    "brevo-mcp__email_log",
    "brevo-mcp__campaign_export_recipients",
    "brevo-mcp__process_get",
  ],
  accounts: ["brevo"],
  fixtures: ["brevoSentCampaign"],
  run: async (ctx) => {
    const templates = resultJson<{ templates?: Array<Record<string, unknown>> }>(
      "templates_get",
      await ctx.call("brevo-mcp__templates_get", { limit: 5 }, { as: "brevo" })
    );
    if ((templates.templates ?? []).some((t) => "htmlContent" in t)) throw new Error("a template in the list carried its HTML");
    resultJson("email_stats", await ctx.call("brevo-mcp__email_stats", { days: 7 }, { as: "brevo" }));
    const log = resultJson<{ events?: unknown[] }>("email_log", await ctx.call("brevo-mcp__email_log", { days: 7, limit: 5 }, { as: "brevo" }));
    if ((log.events ?? []).length > 5) throw new Error("the log answered more events than the page asked for");
    const started = resultJson<{ process_id?: unknown }>(
      "campaign_export_recipients",
      await ctx.call(
        "brevo-mcp__campaign_export_recipients",
        { campaign_id: Number(ctx.fixture("brevoSentCampaign")), recipients_type: "all" },
        { as: "brevo" }
      )
    );
    if (typeof started.process_id !== "number") throw new Error("the export answered with no process id");
    const process = resultJson<{ status?: unknown }>("process_get", await ctx.call("brevo-mcp__process_get", { process_id: started.process_id }, { as: "brevo" }));
    if (typeof process.status !== "string") throw new Error("the process answered with no status");
    ctx.evidence(`templates listed without HTML; stats and log answered; export process is ${process.status}`);
  },
};
