import type { Plan } from "@datatorag-mcp/db";

/** Free tool calls per period.
 *
 * This module went a long time with nothing importing it outside its own test,
 * so the value here was never enforced and nobody had reason to check it. It is
 * enforced now, which is what makes keeping it correct matter. */
export const FREE_MONTHLY_CAP = 250;

export const PRO_MONTHLY_INCLUDED = 2000;

/** Free agent runs per period.
 *
 * A SEPARATE ALLOWANCE FROM THE CALL CAP, and not double-charging: a run is
 * bounded because it spends our model budget, while calls are bounded because
 * volume is what the paid tier sells. One run normally makes several tool
 * calls, so the run cap is expected to bind first. */
export const FREE_MONTHLY_AGENT_RUNS = 25;

/** Hard ceiling on tokens a single agent run may consume, ALL PLANS.
 *
 * The run allowance alone does not bound cost: the measured per-run token
 * distribution is heavily skewed from median to its tail, so a month of
 * unbounded runs can cost more than the subscription that pays for them.
 * Allowance x ceiling is what bounds the worst case. The value sits
 * just above the measured p95, so it clips only the top few percent of runs
 * and leaves the normal case untouched (SCRUM-84, ruled 2026-08-14).
 *
 * Plan-independent on purpose: this is runaway protection, not a tier
 * feature, and a plan that bought more RUNS did not buy bigger ones.
 * Counted the same way the distribution was measured: input + cache-read +
 * cache-write + output tokens per model call, summed over the run (the
 * provider counts cache tokens exclusively of input, so this is not double
 * counting). Enforcement refuses the NEXT model call at a step boundary —
 * see `mastra/run-token-budget.ts`. */
export const RUN_TOKEN_CEILING = 150_000;

export interface PlanLimits {
  monthlyIncluded: number;
  /** true → over-cap returns a hard-stop error; false → over-cap meters overage */
  hardCap: boolean;
  /** true → connecting more than one account per connector is allowed */
  multiAccount: boolean;
  /** Agent runs per period. Enforced by `claimAgentRun` via the playground
   * chat route; a run burns OUR model budget, which is why the paid tier's
   * number is set from measured cost per run, not generosity. */
  agentRuns: number;
}

export function planLimits(plan: Plan): PlanLimits {
  switch (plan) {
    case "free":
      // multiAccount is true on Free BY DECISION (2026-08-07): the pricing
      // page advertises multi-account in every tier, twice. Flipping this to
      // false makes the published claim a lie — see the test pinning it.
      return {
        monthlyIncluded: FREE_MONTHLY_CAP,
        hardCap: true,
        multiAccount: true,
        agentRuns: FREE_MONTHLY_AGENT_RUNS,
      };
    case "pro":
      // 100 agent runs BY DECISION (SCRUM-84, ruled 2026-08-14), replacing
      // the earlier plan-independent cap whose stated precondition — "until a
      // token ceiling is measured" — is now met. Grounded in the measured
      // cost per run over the trailing month: at this allowance, expected
      // model spend stays a small fraction of the subscription price, with
      // RUN_TOKEN_CEILING bounding the tail. The number lives HERE, in
      // the plan table, not as a second free-floating constant: a parallel
      // const next to the free one is the exact shape that let Pro ship
      // capped at the free allowance without anyone noticing.
      return {
        monthlyIncluded: PRO_MONTHLY_INCLUDED,
        hardCap: false,
        multiAccount: true,
        agentRuns: 100,
      };
    case "payg":
      // Stage 2 territory; until it exists, least privilege: the free
      // allowance, same as the unknown-plan branch below.
      return {
        monthlyIncluded: 0,
        hardCap: false,
        multiAccount: true,
        agentRuns: FREE_MONTHLY_AGENT_RUNS,
      };
    default:
      // The column is TEXT, so rows can carry plan values this build no longer
      // knows (a retired plan, or a value from a newer build during a deploy
      // window). Least privilege: unknown means free limits, never a crash on
      // the call path and never accidental Pro.
      return {
        monthlyIncluded: FREE_MONTHLY_CAP,
        hardCap: true,
        multiAccount: true,
        agentRuns: FREE_MONTHLY_AGENT_RUNS,
      };
  }
}

export function isOverage(plan: Plan, callsUsed: number): boolean {
  const { monthlyIncluded } = planLimits(plan);
  return callsUsed > monthlyIncluded;
}
