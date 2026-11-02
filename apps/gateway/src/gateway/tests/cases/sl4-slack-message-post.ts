import type { TestCase } from "../types";
import { resultJson, resultText } from "../result-json";
import { messageAt, postedTs, slackLabel, type SlackHistory } from "../slack-shape";

/**
 * SL4 (Slack scenario): a post whose expected channel name is wrong is
 * refused with nothing sent; a labelled post with the right name lands in
 * the fixture channel and reads back from its history.
 *
 * THE MESSAGE THE REST OF THE WRITES ARE ABOUT: SL5 replies to it, SL6 edits
 * and restores it, SL7 reacts to it, SL8 searches for it. The connector has
 * no delete, so it stays in the fixture channel, labelled with the run
 * stamp. The send guard lets later writes reach it only because this post,
 * through the same guarded dispatch, answered with its ts.
 */
export const sl4SlackMessagePost: TestCase = {
  id: "SL4",
  title: "a post with the wrong expected channel sends nothing; the right one lands and reads back",
  covers: ["slack-mcp__slack_message_post", "slack-mcp__slack_channel_history"],
  accounts: ["slack"],
  fixtures: ["slackChannel"],
  needs: ["SL2"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const channel = ctx.fixture("slackChannel");
    const { channelName } = ctx.from("SL2") as { channelName?: string };
    if (typeof channelName !== "string" || channelName === "") throw new Error("SL2 shared no channel name");

    const history = async () =>
      resultJson<SlackHistory>(
        "slack_channel_history",
        await ctx.call("slack-mcp__slack_channel_history", { channel, limit: 20 }, { as: "slack" })
      );

    // The expected-target guard, live: a name that is not the channel's.
    const wrongText = slackLabel(ctx, "SL4 must not land");
    const wrong = await ctx.call(
      "slack-mcp__slack_message_post",
      { channel, text: wrongText, expected_channel_name: `not-${channelName}` },
      { as: "slack" }
    );
    if (!wrong.isError) throw new Error("a post whose expected channel name differs from the channel was not refused");
    if (!/nothing/i.test(resultText(wrong))) throw new Error("the refusal does not say that nothing was sent");

    const text = slackLabel(ctx, "SL4 message");
    const ts = postedTs(
      "slack_message_post",
      resultJson<{ ts?: unknown }>(
        "slack_message_post",
        await ctx.call(
          "slack-mcp__slack_message_post",
          { channel, text, expected_channel_name: `#${channelName.toUpperCase()}` },
          { as: "slack" }
        )
      )
    );
    ctx.share({ ts, text, stamp: ctx.stamp });

    const after = await history();
    const landed = messageAt(after, ts);
    if (!landed) throw new Error("the post is not in the fixture channel's recent history");
    if (landed.text !== text) throw new Error("the post reads back with different text than was sent");
    if ((after.messages ?? []).some((m) => m.text === wrongText)) {
      throw new Error("the refused post is in the fixture channel's history");
    }
    ctx.evidence("a wrong expected name was refused with nothing sent; the labelled post landed and reads back (stays as labelled residue: no delete tool)");
  },
};
