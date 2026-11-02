import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * SL7 (Slack scenario): a reaction is added to SL4's message, and a second
 * add of the same emoji is reported as already there rather than failed.
 *
 * The connector has no reaction remove, so the reaction stays on the run's
 * own labelled message. The guard allows a reaction only on a message this
 * run posted.
 */
export const sl7SlackReactionsAdd: TestCase = {
  id: "SL7",
  title: "a reaction lands on the run's message, and adding it again says it is already there",
  covers: ["slack-mcp__slack_reactions_add"],
  accounts: ["slack"],
  fixtures: ["slackChannel"],
  needs: ["SL4"],
  run: async (ctx) => {
    const channel = ctx.fixture("slackChannel");
    const { ts } = ctx.from("SL4") as { ts?: string };
    if (!ts) throw new Error("SL4 shared no message to react to");

    type Reacted = { channel?: { id?: string }; ts?: string; added?: boolean; already_reacted?: boolean };
    const first = resultJson<Reacted>(
      "slack_reactions_add",
      await ctx.call("slack-mcp__slack_reactions_add", { channel, ts, name: "eyes" }, { as: "slack" })
    );
    if (first.channel?.id !== channel || first.ts !== ts) throw new Error("the reaction answer names a different message");
    if (first.added !== true) throw new Error("the first reaction on a new message did not answer added true");

    const again = resultJson<Reacted>(
      "slack_reactions_add",
      await ctx.call("slack-mcp__slack_reactions_add", { channel, ts, name: ":eyes:" }, { as: "slack" })
    );
    if (again.added !== false || again.already_reacted !== true) {
      throw new Error("the same reaction again was not reported as already there");
    }
    ctx.evidence("the reaction was added, and a repeat reported already_reacted (stays on the run's message: no remove tool)");
  },
};
