import { sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";

import { isInternalEmail } from "../../lib/brevo";
import { resolveUserEmail } from "../user-email";

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

/**
 * Whether this user's allowance is enforced at all.
 *
 * NOT AN AUTHORIZATION CHECK, AND MUST NEVER BECOME ONE. Read this before
 * reusing it anywhere else.
 *
 * It is safe HERE because of what failure costs: the worst case is that
 * somebody at our own domain goes unmetered and we pay for our own usage. That
 * is the whole risk. The moment the same predicate decides whether a caller may
 * READ OR WRITE SOMEONE ELSE'S DATA — an admin tool that accepts a user id for
 * support, say — the failure mode changes from "we absorb a cost" to "anyone
 * who can get an address at our domain, or onto the exclude list, can act on
 * another user's account". That needs a real role on the user row and a
 * server-side check, not an email-shaped heuristic. If you are here because you
 * want an admin capability, this is not the thing to reuse.
 *
 * No new column for it: there is no role or admin concept in the schema, and
 * one boolean is not the reason to introduce one. This predicate already makes
 * the same class of decision for lifecycle email, already covers the domain,
 * and already takes additions through configuration rather than a deploy.
 */
export async function capExempt(db: Database, userId: string): Promise<boolean> {
  const email = await resolveUserEmail(db, userId);
  return email !== null && isInternalEmail(email);
}

export type ClaimResult =
  | { ok: true; used: number; remaining: number | null }
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
  /** `null` counts the run but never refuses it — see {@link capExempt}. The
   * counter still moves, so the allowance stays readable for someone who is
   * exempt from it. */
  cap: number | null
): Promise<ClaimResult> {
  const guard = cap === null ? sql`true` : sql`u.current_period_agent_runs < ${cap}`;
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
      AND (s.should_roll OR ${guard})
    RETURNING u.current_period_agent_runs AS used
  `);
  const used = rows[0]?.used;
  if (used === undefined) {
    /* c8 ignore next -- unreachable when uncapped: the guard is constant true */
    // No row updated means the guard rejected it, so the counter is at or past
    // the cap. Reported as the cap itself rather than re-reading: the number is
    // only used to render a paywall, and a second round trip on the blocked
    // path buys nothing.
    return { ok: false, used: cap ?? 0 };
  }
  return { ok: true, used, remaining: cap === null ? null : Math.max(0, cap - used) };
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
  /* UNGUARDED, DELIBERATELY. Do not "fix" this by adding a cap check.
   *
   * This runs after the tool call has already executed. Refusing to increment
   * would not prevent the call, it would only lose the record of it, so a user
   * over their allowance would appear to stop consuming exactly when they
   * started consuming most. Whether the NEXT call is permitted is a different
   * question with a different answer site — see `callsRemaining`. */
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
/**
 * Calls left in the period.
 *
 * NO CALLER YET, AND THAT IS THE POINT — do not delete it as dead code.
 * Enforcement of the call allowance is a launch-day switch, held back
 * deliberately: today the counter protects against nothing, because gateway
 * calls run on the user's own upstream quota, while a live cap could interrupt
 * our own use of the product. The moment volume can actually arrive, the
 * decision flips, and the shape of it should not have to be rediscovered then.
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
