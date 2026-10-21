import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { notionList } from "../notion-shape";

/**
 * NT1 (Notion scenario): the stored Notion token authenticates, and `me` is
 * the connection's own bot.
 *
 * First because it needs no fixture: when it is red the token or the
 * workspace is the problem, and every later step would be red for the same
 * reason. It is also the cheapest proof of WHICH workspace a call reached,
 * since the bot carries its workspace's name, and NT7 leans on that.
 */
export const nt1NotionUsersMe: TestCase = {
  id: "NT1",
  title: "list_users with me returns the connection's own bot",
  covers: ["notion-mcp__notion_list_users"],
  accounts: ["notion"],
  run: async (ctx) => {
    const answer = notionList(
      "notion_list_users",
      resultJson("notion_list_users", await ctx.call("notion-mcp__notion_list_users", { user_id: "me" }, { as: "notion" }))
    );
    if (answer.results.length !== 1) {
      throw new Error(`me answered ${answer.results.length} users, and the tool documents one`);
    }
    if (answer.has_more || answer.next_cursor !== null) {
      throw new Error("a single user came back with more to fetch, which the tool documents it never does");
    }
    const bot = answer.results[0] as Record<string, unknown>;
    if (typeof bot.id !== "string" || bot.id === "") throw new Error("the bot has no id");
    if (bot.type !== "bot") throw new Error(`me is a ${String(bot.type)}, not the connection's bot`);
    if (typeof bot.workspace_name !== "string" || bot.workspace_name === "") {
      throw new Error("the bot names no workspace, so nothing can say which workspace a call reached");
    }
    // The workspace name is set by whoever administers it: not evidence.
    ctx.evidence("me is a bot with an id and a workspace name");
  },
};
