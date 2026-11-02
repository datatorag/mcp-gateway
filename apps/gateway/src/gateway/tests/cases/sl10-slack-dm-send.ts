import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { messageAt, postedTs, slackLabel, type SlackHistory } from "../slack-shape";

/**
 * SL10 (Slack scenario): a labelled direct message to the test user's own
 * address lands in their own DM and reads back from it.
 *
 * The only DM a run may send: the guard refuses one to anyone else, by
 * address or by id. It notifies nobody but the account running the suite.
 * The connector has no delete, so it stays in that DM, labelled.
 */
export const sl10SlackDmSend: TestCase = {
  id: "SL10",
  title: "a direct message to the test user's own address lands in their DM and reads back",
  covers: ["slack-mcp__slack_dm_send", "slack-mcp__slack_channel_history"],
  accounts: ["slack"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const self = ctx.address("slack");
    const text = slackLabel(ctx, "SL10 direct message");
    const sent = resultJson<{ user?: { email?: string | null }; channel?: string; ts?: unknown }>(
      "slack_dm_send",
      await ctx.call("slack-mcp__slack_dm_send", { user: self, text, expected_user_email: self }, { as: "slack" })
    );
    const ts = postedTs("slack_dm_send", sent);
    if ((sent.user?.email ?? "").toLowerCase() !== self) throw new Error("the DM went to a person with a different email");
    if (typeof sent.channel !== "string" || sent.channel === "") throw new Error("the DM answered without its conversation id");

    const history = resultJson<SlackHistory>(
      "slack_channel_history",
      await ctx.call("slack-mcp__slack_channel_history", { channel: sent.channel, limit: 10 }, { as: "slack" })
    );
    const landed = messageAt(history, ts);
    if (!landed) throw new Error("the DM is not in the test user's own DM history");
    if (landed.text !== text) throw new Error("the DM reads back with different text than was sent");
    ctx.evidence("the DM landed in the test user's own DM and reads back (stays there labelled: no delete tool)");
  },
};
