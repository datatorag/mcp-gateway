import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type Found = { matches?: { ts?: string; channel?: { id?: string } }[] };

/**
 * SL8 (Slack scenario): SL4's message is found by searching for its stamp in
 * the fixture channel.
 *
 * Slack indexes a new message for search after a delay, so this polls with a
 * stated budget rather than reading once.
 */
export const sl8SlackMessagesSearch: TestCase = {
  id: "SL8",
  title: "a search for the run's message by its stamp finds it in the fixture channel",
  covers: ["slack-mcp__slack_messages_search"],
  accounts: ["slack"],
  fixtures: ["slackChannel"],
  needs: ["SL2", "SL4"],
  timeoutMs: 150_000,
  run: async (ctx) => {
    const channel = ctx.fixture("slackChannel");
    const { channelName } = ctx.from("SL2") as { channelName?: string };
    const { ts, stamp } = ctx.from("SL4") as { ts?: string; stamp?: string };
    if (!channelName || !ts || !stamp) throw new Error("SL2 or SL4 shared nothing to search for");

    await ctx.until(
      "the run's message to be found by search",
      async () => {
        const answer = resultJson<Found>(
          "slack_messages_search",
          await ctx.call(
            "slack-mcp__slack_messages_search",
            { query: `"${stamp}" in:#${channelName}`, sort: "timestamp", count: 20 },
            { as: "slack" }
          )
        );
        return (answer.matches ?? []).find((m) => m.ts === ts && m.channel?.id === channel);
      },
      { everyMs: 10_000, forMs: 120_000 }
    );
    ctx.evidence("the run's message was found by its stamp, in the fixture channel");
  },
};
