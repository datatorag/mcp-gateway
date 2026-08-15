import { sql, type SQL } from "drizzle-orm";
import type { Database, Plan } from "@datatorag-mcp/db";

import { isInternalEmail } from "../../lib/brevo";
import { resolveUserEmail } from "../user-email";
import { planLimits } from "../billing/plans";

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
 * while still looking like a matched set. Every statement below goes through
 * {@link rollAndBump}, which writes both counters on every path — that is the
 * mechanism holding this up, not a rule each caller has to remember.
 */

/** Period length. One statement's worth of SQL rather than a date library,
 * because the roll has to be atomic with the increment it guards. */
const PERIOD = sql`interval '1 month'`;

/** Which counter a statement is moving, if any. */
type Counter = "runs" | "calls";

/**
 * The lazy roll and the increment, as one statement, written once.
 *
 * THIS IS WHERE "BOTH COUNTERS ROLL TOGETHER" IS ENFORCED. Every column is
 * assigned on every path, so a caller cannot express a statement that rolls
 * one counter and leaves the other describing the previous period. The three
 * callers below differ only in which counter they bump and whether they guard,
 * which is why they are three arguments rather than three copies of the SQL:
 * an earlier version restated the whole CTE at each call site, and the
 * invariant the header promises was then upheld only by whoever edited it last
 * copying nine lines correctly.
 *
 * Rolling resets both counters and sets the bumped one to 1, because the call
 * that triggered the roll belongs to the period it opens. Not rolling
 * increments the bumped one and leaves the other alone. Bumping nothing
 * (`null`) makes this a roll-if-lapsed read.
 */
function rollAndBump(userId: string, bump: Counter | null, guard?: SQL) {
  const runsOnRoll = bump === "runs" ? sql`1` : sql`0`;
  const callsOnRoll = bump === "calls" ? sql`1` : sql`0`;
  const runsElse =
    bump === "runs" ? sql`u.current_period_agent_runs + 1` : sql`u.current_period_agent_runs`;
  const callsElse =
    bump === "calls" ? sql`u.current_period_calls + 1` : sql`u.current_period_calls`;
  return sql`
    WITH state AS (
      SELECT id, (current_period_start <= now() - ${PERIOD}) AS should_roll
      FROM users WHERE id = ${userId}
    )
    UPDATE users u SET
      current_period_start      = CASE WHEN s.should_roll THEN now() ELSE u.current_period_start END,
      current_period_agent_runs = CASE WHEN s.should_roll THEN ${runsOnRoll} ELSE ${runsElse} END,
      current_period_calls      = CASE WHEN s.should_roll THEN ${callsOnRoll} ELSE ${callsElse} END
    FROM state s
    WHERE u.id = s.id${guard === undefined ? sql`` : sql` AND (s.should_roll OR ${guard})`}
  `;
}

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

/**
 * The one place the effective agent-run cap is decided: `null` for exempt
 * internal accounts (counted, never refused), otherwise the plan's allowance
 * from planLimits.
 *
 * EVERY READER OF THE CAP GOES THROUGH HERE OR THROUGH planLimits DIRECTLY —
 * the enforcing claim in the chat route, the agent's introspection answer,
 * and the chat panel's meter. SCRUM-84 existed because a second copy of this
 * number drifted, and SCRUM-94 added the meter as a third, PERSISTENT reader;
 * a helper is what makes "the panel and the agent cannot disagree" a property
 * of the code rather than a discipline.
 */
export async function agentRunCap(
  db: Database,
  userId: string
): Promise<number | null> {
  if (await capExempt(db, userId)) return null;
  const rows = await db.execute<{ plan: Plan }>(sql`
    SELECT plan FROM users WHERE id = ${userId}
  `);
  return planLimits(rows[0]?.plan ?? "free").agentRuns;
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
    ${rollAndBump(userId, "runs", guard)}
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
  await db.execute(rollAndBump(userId, "calls"));
}

/**
 * Calls left in the period, rolling first if it has lapsed.
 *
 * Rolls rather than merely reading, so a user returning after a gap is not
 * refused on a stale count. `null` means the plan has no hard cap, which the
 * caller must treat as "allow" rather than as zero.
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
    ${rollAndBump(userId, null)}
    RETURNING u.current_period_calls AS used
  `);
  const used = rows[0]?.used ?? 0;
  return Math.max(0, cap - used);
}

/**
 * Where the user stands, without changing it.
 *
 * READ ONLY, AND THAT IS THE ENTIRE POINT. Every other function in this file
 * moves a counter; this one is for telling a user how many runs they have left
 * when they ask. Answering that question must never spend one, which it would
 * if it went through the claim, and must never roll the period, which would
 * silently reset the very numbers being reported.
 *
 * A lapsed period is reported as-is rather than rolled, so a returning user is
 * told what the row says. The next metered call rolls it, as it always did.
 */
export async function periodStatus(
  db: Database,
  userId: string
): Promise<{ agentRuns: number; calls: number; periodStart: Date } | null> {
  const rows = await db.execute<{
    agent_runs: number;
    calls: number;
    period_start: Date;
  }>(sql`
    SELECT current_period_agent_runs AS agent_runs,
           current_period_calls      AS calls,
           current_period_start      AS period_start
    FROM users WHERE id = ${userId}
  `);
  const row = rows[0];
  return row
    ? { agentRuns: row.agent_runs, calls: row.calls, periodStart: row.period_start }
    : null;
}
