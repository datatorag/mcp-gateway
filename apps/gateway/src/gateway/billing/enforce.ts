import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";
import { planLimits, FREE_MONTHLY_CAP } from "./plans";
import { callsRemaining, capExempt } from "../usage/period";

export type AllowanceCheck =
  | { allowed: true }
  | { allowed: false; message: string };

/**
 * The hard stop on the free tier's call allowance, answered BEFORE dispatch.
 *
 * Counting what a call consumed happens after it ran (`countToolCall`,
 * unguarded, on the response path); whether the NEXT call may run is decided
 * here. Free is a hard cap; Pro has no hard stop — over-allowance on Pro is
 * Stage 2's metered overage, deliberately not built yet, so today a Pro user
 * is never refused. Internal accounts are exempt (see `capExempt` — and the
 * warning there about ever reusing that predicate for authorization).
 *
 * Approximate on purpose: two concurrent calls can both observe one remaining
 * and both run. The counter enforces an allowance, it does not bill — an
 * off-by-one in the user's favour at the boundary is the accepted cost of
 * keeping this off the ledger path.
 */
export async function checkCallAllowance(
  db: Database,
  userId: string
): Promise<AllowanceCheck> {
  const [user] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // No row: the bearer already vouched for the user id, so treat a missing
  // row as a race with deletion and let the dispatch path produce its own
  // error rather than inventing a billing refusal.
  if (!user) return { allowed: true };
  const limits = planLimits(user.plan);
  if (!limits.hardCap) return { allowed: true };
  if (await capExempt(db, userId)) return { allowed: true };
  const remaining = await callsRemaining(db, userId, limits.monthlyIncluded);
  if (remaining !== null && remaining <= 0) {
    return {
      allowed: false,
      message:
        `Monthly free-plan limit reached (${FREE_MONTHLY_CAP} tool calls). ` +
        `Your allowance resets at the start of your next period, or upgrade ` +
        `to Pro from the dashboard for a higher allowance.`,
    };
  }
  return { allowed: true };
}
