import type { TestCase } from "../types";

/**
 * F2 (tier 1): no tool requiring an unapproved scope is served.
 *
 * Requesting a scope the consent screen does not carry triggers the
 * unverified-app screen and a hundred-user cap across every Workspace
 * connection we have. The filter tools are the standing example: reading
 * filters is within our grant, creating and deleting them is not.
 *
 * The PRESENT half is not decoration. Without it the first false positive
 * gets the whole guard deleted, because a case that only ever asserts
 * absence cannot tell "correctly absent" from "the tool list is empty".
 */
export const f2UnapprovedScopes: TestCase = {
  id: "F2",
  title: "tools needing an unapproved scope are absent, and the allowed one is present",
  tier: 1,
  covers: [],
  accounts: [],
  run: async (ctx) => {
    const { tools } = (await ctx.rpc("tools/list")) as { tools: { name: string }[] };
    const names = new Set(tools.map((t) => t.name));

    const forbidden = ["gws-mcp__gmail_create_filter", "gws-mcp__gmail_delete_filter"];
    const present = "gws-mcp__gmail_list_filters";

    const served = forbidden.filter((n) => names.has(n));
    ctx.evidence(`forbidden served: ${served.length ? served.join(", ") : "none"}`);
    if (served.length > 0) {
      throw new Error(`a tool needing an unapproved scope is served: ${served.join(", ")}`);
    }

    if (!names.has(present)) {
      throw new Error(
        `${present} is absent, so the two absences above may just be an empty list rather than a guard`
      );
    }
    ctx.evidence(`${present} is served, so the absences above are meaningful`);
  },
};
