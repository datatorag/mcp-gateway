import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";

/** Largest tool result, in characters, that may enter the conversation.
 *
 * A context bound, and therefore a cost bound: tool output is fed back to the
 * model and then re-sent on every subsequent step of the turn, so one
 * unbounded result (a full mailbox page, a long document) is paid for
 * repeatedly, not once. A search that returns half a megabyte would also
 * simply overflow the window and fail the turn outright.
 *
 * The value is carried over unchanged from the loop this agent replaces. */
export const TOOL_OUTPUT_CAP = 20_000;

/** Bounds one tool result to {@link TOOL_OUTPUT_CAP}.
 *
 * Shape is preserved whenever it fits, which is nearly always: results come
 * back from MCP either as a structured object or as the raw result envelope,
 * and truncating a structure would be worse than useless. Only when the
 * serialized form genuinely exceeds the cap does it collapse to truncated
 * text — the same degradation the previous loop applied, and the same reason:
 * the model reads it as text either way, and a bounded prompt is worth more
 * than a well-formed one it cannot fit.
 *
 * Total by construction: every branch returns, so there is no input for which
 * the cap silently does not apply. */
export function capToolOutput(output: unknown): unknown {
  if (typeof output === "string") {
    return output.length <= TOOL_OUTPUT_CAP ? output : output.slice(0, TOOL_OUTPUT_CAP);
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(output);
  } catch {
    // Circular or otherwise unserializable: nothing safe to measure or slice.
    // Left alone rather than dropped — a tool returning this is a bug to fix
    // at the tool, not a reason to lose the user's result.
    return output;
  }
  if (serialized === undefined || serialized.length <= TOOL_OUTPUT_CAP) return output;
  return serialized.slice(0, TOOL_OUTPUT_CAP);
}

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
