import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * BR1 (Brevo scenario): the stored Brevo token authenticates, and the account
 * and its campaigns answer (SCRUM-468).
 *
 * First because it needs no fixture: when it is red the token is the problem,
 * and every later step would be red for the same reason. Two calls of the
 * kind Brevo allows 100 an hour, so the scenario stays far under the limit.
 */
export const br1BrevoAccount: TestCase = {
  id: "BR1",
  title: "the Brevo account and its campaigns answer",
  covers: ["brevo-mcp__account_get", "brevo-mcp__campaigns_list"],
  accounts: ["brevo"],
  run: async (ctx) => {
    const account = resultJson<{ email?: unknown; plan?: unknown }>("account_get", await ctx.call("brevo-mcp__account_get", {}, { as: "brevo" }));
    if (!Array.isArray(account.plan)) throw new Error("the account answered with no plan, which Brevo documents");
    const list = resultJson<{ campaigns?: Array<Record<string, unknown>> }>(
      "campaigns_list",
      await ctx.call("brevo-mcp__campaigns_list", { limit: 5 }, { as: "brevo" })
    );
    const campaigns = list.campaigns ?? [];
    if (campaigns.some((c) => "htmlContent" in c)) throw new Error("a campaign in the list carried its HTML, which the tool leaves out");
    ctx.evidence(`account answered with ${account.plan.length} plan line(s); ${campaigns.length} campaign(s) listed`);
  },
};
