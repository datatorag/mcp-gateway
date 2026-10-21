import type { TestCase, ToolResult } from "../types";
import { resultJson, resultText } from "../result-json";
import { isNotionNotFound } from "../notion-shape";

/**
 * NT7 (Notion scenario): two workspaces under one user see only their own
 * pages, and naming a workspace routes to it.
 *
 * Several Notion workspaces under one email are the reason the account
 * argument matches a workspace at all (SCRUM-366). The failure worth
 * catching is a collapse to one workspace: every call would succeed and
 * read the wrong workspace's pages. So each fixture page must be readable
 * through its own workspace and answer the plugin's worded not-found
 * through the other, in both directions.
 *
 * Then the same through the workspace NAME, the way a user types it: the
 * name-routed calls must keep the pages apart exactly as the id-routed ones
 * did, and the bot behind each name must be the bot behind each id.
 *
 * Two different workspaces or nothing: with one workspace behind both roles
 * every comparison here is of a workspace with itself, so the case skips.
 *
 * Every call names its role as a literal, which is what lets the source
 * check hold each one to a role the case declared.
 */
type Role = "notion" | "notionSecond";

export const nt7NotionTwoWorkspaces: TestCase = {
  id: "NT7",
  title: "each workspace sees only its own page, and a workspace name routes to it",
  covers: ["notion-mcp__notion_get_page", "notion-mcp__notion_list_users"],
  accounts: ["notion", "notionSecond"],
  distinctAccounts: true,
  fixtures: ["notionPage", "notionSecondPage"],
  run: async (ctx) => {
    const pageOf: Record<Role, string> = {
      notion: ctx.fixture("notionPage"),
      notionSecond: ctx.fixture("notionSecondPage"),
    };
    const other: Record<Role, Role> = { notion: "notionSecond", notionSecond: "notion" };

    const readPage = (role: Role, page: string, byName: boolean): Promise<ToolResult> => {
      if (role === "notion") {
        return byName
          ? ctx.call("notion-mcp__notion_get_page", { page_id: page, include_markdown: false }, { as: "notion", route: "workspace-name" })
          : ctx.call("notion-mcp__notion_get_page", { page_id: page, include_markdown: false }, { as: "notion" });
      }
      return byName
        ? ctx.call("notion-mcp__notion_get_page", { page_id: page, include_markdown: false }, { as: "notionSecond", route: "workspace-name" })
        : ctx.call("notion-mcp__notion_get_page", { page_id: page, include_markdown: false }, { as: "notionSecond" });
    };

    const me = async (role: Role, byName: boolean): Promise<unknown> => {
      let result: ToolResult;
      if (role === "notion") {
        result = byName
          ? await ctx.call("notion-mcp__notion_list_users", { user_id: "me" }, { as: "notion", route: "workspace-name" })
          : await ctx.call("notion-mcp__notion_list_users", { user_id: "me" }, { as: "notion" });
      } else {
        result = byName
          ? await ctx.call("notion-mcp__notion_list_users", { user_id: "me" }, { as: "notionSecond", route: "workspace-name" })
          : await ctx.call("notion-mcp__notion_list_users", { user_id: "me" }, { as: "notionSecond" });
      }
      return resultJson<{ results?: { id?: unknown }[] }>("notion_list_users", result).results?.[0]?.id;
    };

    const roles: Role[] = ["notion", "notionSecond"];
    for (const byName of [false, true]) {
      const how = byName ? "by workspace name" : "by workspace id";
      for (const owner of roles) {
        const own = await readPage(owner, pageOf[owner], byName);
        if (own.isError) {
          throw new Error(`${how}: ${owner}'s page is not readable through ${owner}: ${resultText(own).slice(0, 300)}`);
        }
        const foreign = await readPage(other[owner], pageOf[owner], byName);
        if (!foreign.isError) {
          throw new Error(`${how}: ${owner}'s page is readable through ${other[owner]}, so the two workspaces are not kept apart`);
        }
        if (!isNotionNotFound(resultText(foreign))) {
          throw new Error(
            `${how}: ${owner}'s page through ${other[owner]} failed, but not with the worded not-found: ${resultText(foreign).slice(0, 300)}`
          );
        }
      }
      ctx.evidence(`${how}: each page reads through its own workspace and is not found through the other`);
    }

    const byId: Record<Role, unknown> = { notion: await me("notion", false), notionSecond: await me("notionSecond", false) };
    if (typeof byId.notion !== "string" || typeof byId.notionSecond !== "string") {
      throw new Error("me answered no bot id for one of the workspaces");
    }
    if (byId.notion === byId.notionSecond) throw new Error("both workspaces answered the same bot");
    for (const role of roles) {
      if ((await me(role, true)) !== byId[role]) {
        throw new Error(`the workspace name mapped for ${role} reached a different bot than its workspace id`);
      }
    }
    ctx.evidence("each workspace name reaches the same bot as its workspace id, and the two bots differ");
  },
};
