import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * BR2 (Brevo scenario): the fixture list, its members, and the fixture
 * contact read back (SCRUM-468). Contacts endpoints allow far more calls than
 * campaign ones, so the reads that matter most sit here.
 */
export const br2BrevoContactsRead: TestCase = {
  id: "BR2",
  title: "a list, its members and a contact read back",
  covers: ["brevo-mcp__lists_get", "brevo-mcp__contacts_search", "brevo-mcp__contact_get"],
  accounts: ["brevo"],
  fixtures: ["brevoList", "brevoContact"],
  run: async (ctx) => {
    const listId = Number(ctx.fixture("brevoList"));
    const contact = ctx.fixture("brevoContact").toLowerCase();
    const list = resultJson<{ id?: unknown; totalSubscribers?: unknown }>(
      "lists_get",
      await ctx.call("brevo-mcp__lists_get", { list_id: listId }, { as: "brevo" })
    );
    if (Number(list.id) !== listId) throw new Error("lists_get answered for a different list");
    const members = resultJson<{ contacts?: Array<{ email?: string }> }>(
      "contacts_search",
      await ctx.call("brevo-mcp__contacts_search", { list_id: listId, limit: 100 }, { as: "brevo" })
    );
    if (!(members.contacts ?? []).some((c) => String(c.email ?? "").toLowerCase() === contact)) {
      throw new Error("the fixture contact is not among the fixture list's members");
    }
    const one = resultJson<{ email?: string; listIds?: number[]; statistics?: unknown }>(
      "contact_get",
      await ctx.call("brevo-mcp__contact_get", { identifier: ctx.fixture("brevoContact") }, { as: "brevo" })
    );
    if (String(one.email ?? "").toLowerCase() !== contact) throw new Error("contact_get answered for a different contact");
    if ("statistics" in one) throw new Error("contact_get carried statistics it was not asked for");
    // Addresses are never written into evidence: this repository is public.
    ctx.evidence(`the list answered with its subscriber count; the contact is a member and reads back`);
  },
};
