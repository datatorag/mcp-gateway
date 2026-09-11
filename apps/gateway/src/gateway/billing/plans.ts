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
 * Charged per model call and summed over the run as: uncached input +
 * cache writes + output in full, plus cache reads at RUN_CACHE_READ_WEIGHT
 * (SCRUM-236). Enforcement refuses the NEXT model call at a step boundary,
 * see `mastra/run-token-budget.ts`. */
export const RUN_TOKEN_CEILING = 150_000;

/** What a cached input token weighs against RUN_TOKEN_CEILING. The ceiling
 * is a cost and abuse guard, and a cache read is priced at about a tenth of
 * an input token, so it counts at a tenth. Before SCRUM-236 a cache read was
 * charged in full and, because the SDK's input total already includes it,
 * charged twice: a two-step skill run whose only weight was the 35k-token
 * tool-schema prefix read 152k against this ceiling and was refused its
 * third call after 81k real tokens. */
export const RUN_CACHE_READ_WEIGHT = 0.1;

/** How much a SKILL RUN asks the model to think per step (SCRUM-248).
 *
 * Thinking is the dominant cost of every step after the first on a
 * multi-account run, and the direct cause of a run overshooting
 * RUN_TOKEN_CEILING one step after the check. The model in use takes no
 * token budget for thinking (the API rejects one); the control it takes is
 * an effort level with adaptive thinking, where the API default is `high`.
 * `medium` is the reversible first step down from that default, judged on
 * the next real run against a five-thousand-token-per-step equivalent.
 *
 * Applied to skill-seeded turns only; ordinary chat keeps the default. A
 * skill may override it in frontmatter (`effort: low|medium|high`), see
 * `mastra/run-effort.ts`. */
export const SKILL_RUN_EFFORT: SkillRunEffort = "medium";

export type SkillRunEffort = "low" | "medium" | "high";

/** Where a run is told to close (SCRUM-251): the share of RUN_TOKEN_CEILING
 * after which the next step of a skill run carries a closing instruction,
 * so the run ends with its report instead of one step past the ceiling.
 * The hard ceiling is checked AFTER a step, and a closing step at today's
 * thinking sizes weighs tens of thousands of tokens, so the line sits at
 * 85 percent, not 95: the remaining 15 percent is the room the closing step
 * runs in. See `mastra/soft-ceiling.ts`. */
export const RUN_SOFT_CEILING_RATIO = 0.85;
export const RUN_SOFT_CEILING = Math.round(RUN_TOKEN_CEILING * RUN_SOFT_CEILING_RATIO);

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
