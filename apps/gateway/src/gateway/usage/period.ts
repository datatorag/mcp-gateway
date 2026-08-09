import { sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";

/**
 * The per-period allowance counters, and the lazy roll that bounds them.
 *
 * A COUNTER, NOT A LEDGER. Increment in place, approximate is fine, a little
 * lag is harmless. Billing needs dedup, replay and an audit trail because a
 * double-bill is a refund and a support conversation; enforcing an allowance
 * needs none of that. These two things have been treated as one build before
 * and they are not.
 *
 * WHY THE ROLL IS LAZY. Nothing schedules anything today, and `current_period_start`
 * was never written by any code — it took its default at row creation and sat
 * there, which is why the call counter was decorative rather than merely
 * unenforced. A lazy roll needs no scheduler, cannot drift when a worker misses
 * a tick, and self-heals for a user who was inactive for six periods: their
 * next increment simply starts a fresh one. The cost is that a lapsed period
 * stays lapsed on the row until the user comes back, which no reader cares
 * about because every reader goes through here.
 *
 * BOTH COUNTERS ROLL TOGETHER, ALWAYS. They share one `current_period_start`,
 * so resetting either alone would leave the pair describing different windows
 * while still looking like a matched set. Every statement below resets both.
 */

/** Period length. One statement's worth of SQL rather than a date library,
 * because the roll has to be atomic with the increment it guards. */
const PERIOD = sql`interval '1 month'`;

export type ClaimResult =
  | { ok: true; used: number; remaining: number }
  /** At the allowance. Nothing was incremented, so this is safe to retry. */
  | { ok: false; used: number };

/**
 * Claim one agent run against the period allowance.
 *
 * ONE STATEMENT, deliberately. Read-then-write would let two concurrent turns
 * both observe `used = cap - 1` and both claim, which is the bug the existing
 * playground claim was written to avoid and the reason its shape is copied
 * here. The guard is in the WHERE clause, so a claim at the cap updates no row
 * and returns nothing.
 *
 * Returns `ok:false` at the allowance rather than throwing: the caller turns
 * it into a paywall, and a hard stop is a product state, not an error.
 */
export async function claimAgentRun(
  db: Database,
  userId: string,
  cap: number
): Promise<ClaimResult> {
  const rows = await db.execute<{ used: number }>(sql`
    WITH state AS (
      SELECT id, (current_period_start <= now() - ${PERIOD}) AS should_roll
      FROM users WHERE id = ${userId}
    )
    UPDATE users u SET
      current_period_start     = CASE WHEN s.should_roll THEN now() ELSE u.current_period_start END,
      current_period_agent_runs = CASE WHEN s.should_roll THEN 1 ELSE u.current_period_agent_runs + 1 END,
      current_period_calls      = CASE WHEN s.should_roll THEN 0 ELSE u.current_period_calls END
    FROM state s
    WHERE u.id = s.id
      AND (s.should_roll OR u.current_period_agent_runs < ${cap})
    RETURNING u.current_period_agent_runs AS used
  `);
  const used = rows[0]?.used;
  if (used === undefined) {
    // No row updated means the guard rejected it, so the counter is at or past
    // the cap. Reported as the cap itself rather than re-reading: the number is
    // only used to render a paywall, and a second round trip on the blocked
    // path buys nothing.
    return { ok: false, used: cap };
  }
  return { ok: true, used, remaining: Math.max(0, cap - used) };
}

/** Give a claimed run back, for a turn that consumed nothing.
 *
 * Guarded so it can never go negative, and it does NOT un-roll a period: a
 * refund that crossed a boundary would credit the new period for a run spent
 * in the old one. Off by one in our favour, once, at a boundary, on a turn that
 * already failed. */
export async function refundAgentRun(db: Database, userId: string): Promise<void> {
  await db.execute(sql`
    UPDATE users
    SET current_period_agent_runs = current_period_agent_runs - 1
    WHERE id = ${userId} AND current_period_agent_runs > 0
  `);
}

/**
 * Count one metered tool call against the period allowance.
 *
 * UNGUARDED ON PURPOSE, unlike the run claim. This runs off the tool-response
 * path after the call has already happened, so refusing to count it would not
 * un-ring the bell — it would only lose the count. Whether the NEXT call is
 * allowed is a separate question, answered by {@link callsRemaining} before
 * dispatch.
 */
export async function countToolCall(db: Database, userId: string): Promise<void> {
  await db.execute(sql`
    WITH state AS (
      SELECT id, (current_period_start <= now() - ${PERIOD}) AS should_roll
      FROM users WHERE id = ${userId}
    )
    UPDATE users u SET
      current_period_start      = CASE WHEN s.should_roll THEN now() ELSE u.current_period_start END,
      current_period_calls      = CASE WHEN s.should_roll THEN 1 ELSE u.current_period_calls + 1 END,
      current_period_agent_runs = CASE WHEN s.should_roll THEN 0 ELSE u.current_period_agent_runs END
    FROM state s
    WHERE u.id = s.id
  `);
}

/**
 * Calls left in the period, rolling first if it has lapsed.
 *
 * Rolls rather than merely reading, so a user returning after a gap is not
 * refused on a stale count. `null` means the plan has no hard cap, which the
 * caller must treat as "allow" rather than as zero.
 */
export async function callsRemaining(
  db: Database,
  userId: string,
  cap: number | null
): Promise<number | null> {
  if (cap === null) return null;
  const rows = await db.execute<{ used: number }>(sql`
    WITH state AS (
      SELECT id, (current_period_start <= now() - ${PERIOD}) AS should_roll
      FROM users WHERE id = ${userId}
    )
    UPDATE users u SET
      current_period_start      = CASE WHEN s.should_roll THEN now() ELSE u.current_period_start END,
      current_period_calls      = CASE WHEN s.should_roll THEN 0 ELSE u.current_period_calls END,
      current_period_agent_runs = CASE WHEN s.should_roll THEN 0 ELSE u.current_period_agent_runs END
    FROM state s
    WHERE u.id = s.id
    RETURNING u.current_period_calls AS used
  `);
  const used = rows[0]?.used ?? 0;
  return Math.max(0, cap - used);
}
