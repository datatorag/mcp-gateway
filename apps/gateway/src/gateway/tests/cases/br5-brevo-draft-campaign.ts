import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * BR5 (Brevo scenario): the fixture draft campaign read, renamed with a stamp
 * and renamed back, set to draft (a status that sends nothing), and sent as a
 * test to the reader mailbox only (SCRUM-468). It is never sent for real: the
 * send guard refuses campaign_send for any test run.
 */
export const br5BrevoDraftCampaign: TestCase = {
  id: "BR5",
  title: "a draft campaign read, renamed and restored, and sent as a test to the reader",
  covers: ["brevo-mcp__campaign_get", "brevo-mcp__campaign_update", "brevo-mcp__campaign_set_status", "brevo-mcp__campaign_send_test"],
  accounts: ["brevo", "reader"],
  fixtures: ["brevoDraftCampaign"],
  run: async (ctx) => {
    const campaignId = Number(ctx.fixture("brevoDraftCampaign"));
    const read = async () =>
      resultJson<{ name?: string; status?: string; htmlContent?: unknown }>(
        "campaign_get",
        await ctx.call("brevo-mcp__campaign_get", { campaign_id: campaignId }, { as: "brevo" })
      );
    const before = await read();
    if (before.status !== "draft") throw new Error(`the fixture campaign is ${String(before.status)}, not a draft`);
    if ("htmlContent" in before) throw new Error("campaign_get carried HTML it was not asked for");
    const name = String(before.name ?? "");
    resultJson("campaign_update", await ctx.call("brevo-mcp__campaign_update", { campaign_id: campaignId, name: `[smoke] ${ctx.stamp}` }, { as: "brevo" }));
    try {
      if ((await read()).name !== `[smoke] ${ctx.stamp}`) throw new Error("the new name did not read back");
    } finally {
      resultJson("campaign_update", await ctx.call("brevo-mcp__campaign_update", { campaign_id: campaignId, name }, { as: "brevo" }));
    }
    resultJson("campaign_set_status", await ctx.call("brevo-mcp__campaign_set_status", { campaign_id: campaignId, status: "draft" }, { as: "brevo" }));
    resultJson(
      "campaign_send_test",
      await ctx.call("brevo-mcp__campaign_send_test", { campaign_id: campaignId, emails: [ctx.address("reader")] }, { as: "brevo" })
    );
    ctx.evidence("read as a draft, renamed and restored, status set to draft, a test sent to the reader");
  },
};
