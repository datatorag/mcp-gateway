import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type Listed = { channels?: { id?: string; name?: string; type?: string }[]; next_cursor?: string | null };

/**
 * SL2 (Slack scenario): the fixture channel is among the channels the test
 * user can see, and the list names it.
 *
 * The NAME is read here and shared, because every write takes the channel's
 * name as its expectation and the configuration holds only the id. Read
 * from Slack, never configured twice, so the two cannot disagree. The name
 * is never evidence: whoever administers the workspace sets it.
 */
export const sl2SlackChannelsList: TestCase = {
  id: "SL2",
  title: "the fixture channel is listed, with a name",
  covers: ["slack-mcp__slack_channels_list"],
  accounts: ["slack"],
  fixtures: ["slackChannel"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const id = ctx.fixture("slackChannel");
    let cursor: string | null = null;
    for (let page = 0; page < 25; page++) {
      const args: Record<string, unknown> = { types: ["public", "private"], limit: 200 };
      if (cursor) args.cursor = cursor;
      const answer = resultJson<Listed>(
        "slack_channels_list",
        await ctx.call("slack-mcp__slack_channels_list", args, { as: "slack" })
      );
      if (!Array.isArray(answer.channels)) throw new Error("slack_channels_list answered without a channels list");
      const found = answer.channels.find((c) => c.id === id);
      if (found) {
        if (typeof found.name !== "string" || found.name === "") throw new Error("the fixture channel is listed with no name");
        ctx.share({ channelName: found.name });
        ctx.evidence(`the fixture channel is listed on page ${page + 1}, as a ${String(found.type)} channel with a name`);
        return;
      }
      if (!answer.next_cursor) break;
      cursor = answer.next_cursor;
    }
    throw new Error("the fixture channel is not among the channels the test user can see");
  },
};
