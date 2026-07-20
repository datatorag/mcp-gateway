import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";

/**
 * Atomically claim one playground message. Same claim pattern as
 * trackFirstToolCall (track.ts): a guarded UPDATE ... RETURNING, no
 * SELECT-then-UPDATE race. Returns true iff the row was under cap and the
 * increment landed.
 */
export async function claimPlaygroundMessage(
  db: Database,
  userId: string,
  cap: number
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ playgroundMessagesUsed: sql`${users.playgroundMessagesUsed} + 1` })
    .where(and(eq(users.id, userId), lt(users.playgroundMessagesUsed, cap)))
    .returning({ used: users.playgroundMessagesUsed });
  return rows.length > 0;
}

/**
 * Compensating decrement for a claim that turned out not to do real work
 * (engine-level failure, or a pre-flight failure after the claim landed) —
 * an Anthropic outage must not permanently burn one of the user's lifetime
 * playground messages. Guarded so it can never go negative.
 */
export async function refundPlaygroundMessage(
  db: Database,
  userId: string
): Promise<void> {
  await db
    .update(users)
    .set({ playgroundMessagesUsed: sql`${users.playgroundMessagesUsed} - 1` })
    .where(and(eq(users.id, userId), gt(users.playgroundMessagesUsed, 0)));
}
