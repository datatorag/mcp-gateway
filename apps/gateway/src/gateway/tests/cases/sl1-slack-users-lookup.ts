import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * SL1 (Slack scenario): the stored Slack token authenticates, and looking up
 * the test user's own address answers that person.
 *
 * First because it needs no fixture: when it is red the token or the
 * workspace is the problem, and every later step would be red for the same
 * reason. The address is the one the `slack` role maps to, never one a case
 * names.
 */
export const sl1SlackUsersLookup: TestCase = {
  id: "SL1",
  title: "looking up the test user by email answers that person, with an id",
  covers: ["slack-mcp__slack_users_lookup"],
  accounts: ["slack"],
  run: async (ctx) => {
    const email = ctx.address("slack");
    const person = resultJson<{ id?: string; email?: string | null; name?: string }>(
      "slack_users_lookup",
      await ctx.call("slack-mcp__slack_users_lookup", { email }, { as: "slack" })
    );
    if (typeof person.id !== "string" || person.id === "") throw new Error("the person came back with no id");
    if ((person.email ?? "").toLowerCase() !== email) {
      throw new Error("the person came back with a different email than the one looked up");
    }
    ctx.evidence("the test user's address resolves to a Slack user with an id");
  },
};
