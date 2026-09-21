import type { TestCase } from "../types";

/**
 * F1 (tier 1): the write-approval boundary holds in BOTH directions.
 *
 * Asserting only that writes prompt lets an over-broad classifier pass while
 * it prompts on everything, and whoever that blocks deletes the guard. So a
 * reviewed read must NOT prompt, and that half is the one that keeps the
 * guard usable.
 */
export const f1ApprovalBoundary: TestCase = {
  id: "F1",
  title: "a write prompts for approval and a reviewed read does not",
  tier: 1,
  covers: [],
  accounts: [],
  run: async (ctx) => {
    const res = await ctx.http("/api/admin/tests/classification?tools=gws-mcp__gmail_send,gws-mcp__gmail_search");
    if (res.status !== 200) throw new Error(`the classification endpoint answered ${res.status}`);
    const body = (await res.json()) as { classification: Record<string, boolean> };

    const write = body.classification["gws-mcp__gmail_send"];
    const read = body.classification["gws-mcp__gmail_search"];
    ctx.evidence(`gmail_send requiresApproval=${write}, gmail_search requiresApproval=${read}`);

    if (write !== true) throw new Error("a write-verb tool does not require approval");
    if (read !== false) {
      throw new Error("a reviewed read tool requires approval, so the classifier prompts on everything");
    }
  },
};
