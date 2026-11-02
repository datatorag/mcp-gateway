import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * BR4 (Brevo scenario): the fixture contact added to the fixture second list,
 * seen there, and taken off again (SCRUM-468).
 */
export const br4BrevoListMembers: TestCase = {
  id: "BR4",
  title: "a contact added to a list and taken off it",
  covers: ["brevo-mcp__list_members_update"],
  cleanupCalls: ["brevo-mcp__contacts_search"],
  accounts: ["brevo"],
  fixtures: ["brevoSecondList", "brevoContact"],
  run: async (ctx) => {
    const listId = Number(ctx.fixture("brevoSecondList"));
    const email = ctx.fixture("brevoContact");
    const isMember = async () => {
      const members = resultJson<{ contacts?: Array<{ email?: string }> }>(
        "contacts_search",
        await ctx.call("brevo-mcp__contacts_search", { list_id: listId, limit: 100 }, { as: "brevo" })
      );
      return (members.contacts ?? []).some((c) => String(c.email ?? "").toLowerCase() === email.toLowerCase());
    };
    if (await isMember()) throw new Error("the fixture contact is already on the second list, so adding it proves nothing");
    resultJson("list_members_update", await ctx.call("brevo-mcp__list_members_update", { list_id: listId, add: [email] }, { as: "brevo" }));
    try {
      if (!(await isMember())) throw new Error("the contact added to the list is not among its members");
    } finally {
      resultJson("list_members_update", await ctx.call("brevo-mcp__list_members_update", { list_id: listId, remove: [email] }, { as: "brevo" }));
    }
    if (await isMember()) throw new Error("the contact taken off the list is still a member");
    ctx.evidence("added, seen as a member, taken off, gone");
  },
};
