import type { TestCase } from "../types";

/**
 * F1 (tier 1): the write-approval boundary holds in BOTH directions.
 *
 * Asserting only that writes prompt lets an over-broad classifier pass while
 * it prompts on everything, and whoever that blocks deletes the guard. So a
 * reviewed read must NOT prompt, and that half is the one that keeps the
 * guard usable.
 *
 * It asks the same classifier the playground asks, and says so rather than
 * claiming independence it does not have. What is proven here is the shape
 * of the boundary, not that two implementations agree.
 */
export const f1ApprovalBoundary: TestCase = {
  id: "F1",
  title: "a write prompts for approval and a reviewed read does not",
  tier: 1,
  covers: [],
  accounts: [],
  run: async (ctx) => {
    const classification = ctx.gateway.classify(["gws-mcp__gmail_send", "gws-mcp__gmail_search"]);

    const write = classification["gws-mcp__gmail_send"];
    const read = classification["gws-mcp__gmail_search"];
    ctx.evidence(`gmail_send requiresApproval=${write}, gmail_search requiresApproval=${read}`);

    if (write !== true) throw new Error("a write-verb tool does not require approval");
    if (read !== false) {
      throw new Error("a reviewed read tool requires approval, so the classifier prompts on everything");
    }
  },
};
