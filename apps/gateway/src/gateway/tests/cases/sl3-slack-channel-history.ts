import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import type { SlackHistory } from "../slack-shape";

/**
 * SL3 (Slack scenario): the fixture channel's history answers by id, naming
 * the channel and listing messages in the documented shape.
 *
 * Read before any write in the scenario, so a red here is the read path
 * rather than something this run posted.
 */
export const sl3SlackChannelHistory: TestCase = {
  id: "SL3",
  title: "the fixture channel's history answers by id, in the message shape",
  covers: ["slack-mcp__slack_channel_history"],
  accounts: ["slack"],
  fixtures: ["slackChannel"],
  run: async (ctx) => {
    const id = ctx.fixture("slackChannel");
    const answer = resultJson<SlackHistory>(
      "slack_channel_history",
      await ctx.call("slack-mcp__slack_channel_history", { channel: id, limit: 5 }, { as: "slack" })
    );
    if (answer.channel?.id !== id) throw new Error("the history names a different channel than the one asked for");
    if (!Array.isArray(answer.messages)) throw new Error("slack_channel_history answered without a messages list");
    if (answer.messages.length > 5) throw new Error(`a limit of 5 answered ${answer.messages.length} messages`);
    for (const m of answer.messages) {
      if (typeof m.ts !== "string" || m.ts === "") throw new Error("a message came back with no ts");
    }
    ctx.evidence(`${answer.messages.length} message(s) read from the fixture channel, each with a ts`);
  },
};
