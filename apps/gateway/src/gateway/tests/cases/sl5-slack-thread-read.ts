import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { messageAt, postedTs, slackLabel, type SlackHistory } from "../slack-shape";

/**
 * SL5 (Slack scenario): a reply posted in SL4's thread is read back with the
 * thread, the parent first.
 *
 * The guard allows a reply only in a thread this run started, which SL4's
 * is.
 */
export const sl5SlackThreadRead: TestCase = {
  id: "SL5",
  title: "a reply in the run's own thread reads back with the thread, the parent first",
  covers: ["slack-mcp__slack_message_post", "slack-mcp__slack_thread_read"],
  accounts: ["slack"],
  fixtures: ["slackChannel"],
  needs: ["SL2", "SL4"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const channel = ctx.fixture("slackChannel");
    const { channelName } = ctx.from("SL2") as { channelName?: string };
    const { ts: parent } = ctx.from("SL4") as { ts?: string };
    if (!channelName || !parent) throw new Error("SL2 or SL4 shared nothing to reply to");

    const text = slackLabel(ctx, "SL5 reply");
    const reply = postedTs(
      "slack_message_post",
      resultJson<{ ts?: unknown }>(
        "slack_message_post",
        await ctx.call(
          "slack-mcp__slack_message_post",
          { channel, text, thread_ts: parent, expected_channel_name: channelName },
          { as: "slack" }
        )
      )
    );

    const thread = resultJson<SlackHistory>(
      "slack_thread_read",
      await ctx.call("slack-mcp__slack_thread_read", { channel, ts: parent }, { as: "slack" })
    );
    if (thread.messages?.[0]?.ts !== parent) throw new Error("the thread does not lead with its parent message");
    const found = messageAt(thread, reply);
    if (!found) throw new Error("the reply is not in the thread");
    if (found.text !== text) throw new Error("the reply reads back with different text than was sent");
    ctx.evidence("the reply reads back in the thread, after its parent");
  },
};
