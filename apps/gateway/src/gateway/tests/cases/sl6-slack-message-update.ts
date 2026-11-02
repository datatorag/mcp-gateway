import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { messageAt, slackLabel, type SlackHistory } from "../slack-shape";

/**
 * SL6 (Slack scenario): SL4's message is edited, read back, and restored to
 * its original text, read back again.
 *
 * A restoring pair, so the residue SL4 leaves is the message as posted.
 */
export const sl6SlackMessageUpdate: TestCase = {
  id: "SL6",
  title: "an edit to the run's message reads back, and so does restoring it",
  covers: ["slack-mcp__slack_message_update", "slack-mcp__slack_thread_read"],
  accounts: ["slack"],
  fixtures: ["slackChannel"],
  needs: ["SL2", "SL4"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const channel = ctx.fixture("slackChannel");
    const { channelName } = ctx.from("SL2") as { channelName?: string };
    const { ts, text: original } = ctx.from("SL4") as { ts?: string; text?: string };
    if (!channelName || !ts || !original) throw new Error("SL2 or SL4 shared nothing to edit");

    const readText = async () =>
      messageAt(
        resultJson<SlackHistory>(
          "slack_thread_read",
          await ctx.call("slack-mcp__slack_thread_read", { channel, ts, limit: 1 }, { as: "slack" })
        ),
        ts
      )?.text;

    const edited = slackLabel(ctx, "SL6 edited");
    let restored = false;
    ctx.defer("restore the message's text", async () => {
      if (restored) return;
      const back = await ctx.call(
        "slack-mcp__slack_message_update",
        { channel, ts, text: original, expected_channel_name: channelName },
        { as: "slack" }
      );
      if (back.isError) ctx.evidence("RESIDUE: the message could not be restored; it is labelled with the run stamp");
    });

    resultJson(
      "slack_message_update",
      await ctx.call("slack-mcp__slack_message_update", { channel, ts, text: edited, expected_channel_name: channelName }, { as: "slack" })
    );
    if ((await readText()) !== edited) throw new Error("the edited text does not read back");

    resultJson(
      "slack_message_update",
      await ctx.call("slack-mcp__slack_message_update", { channel, ts, text: original, expected_channel_name: channelName }, { as: "slack" })
    );
    restored = true;
    if ((await readText()) !== original) throw new Error("the restored text does not read back");
    ctx.evidence("the message was edited and restored, each read back");
  },
};
