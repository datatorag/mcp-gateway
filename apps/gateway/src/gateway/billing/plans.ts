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

export interface PlanLimits {
  monthlyIncluded: number;
  /** true → over-cap returns a hard-stop error; false → over-cap meters overage */
  hardCap: boolean;
  /** true → connecting more than one account per connector is allowed */
  multiAccount: boolean;
}

export function planLimits(plan: Plan): PlanLimits {
  switch (plan) {
    case "free":
      // multiAccount is true on Free BY DECISION (2026-08-07): the pricing
      // page advertises multi-account in every tier, twice. Flipping this to
      // false makes the published claim a lie — see the test pinning it.
      return { monthlyIncluded: FREE_MONTHLY_CAP, hardCap: true, multiAccount: true };
    case "pro":
      return { monthlyIncluded: PRO_MONTHLY_INCLUDED, hardCap: false, multiAccount: true };
    case "payg":
      return { monthlyIncluded: 0, hardCap: false, multiAccount: true };
    default:
      // The column is TEXT, so rows can carry plan values this build no longer
      // knows (a retired plan, or a value from a newer build during a deploy
      // window). Least privilege: unknown means free limits, never a crash on
      // the call path and never accidental Pro.
      return { monthlyIncluded: FREE_MONTHLY_CAP, hardCap: true, multiAccount: true };
  }
}

export function isOverage(plan: Plan, callsUsed: number): boolean {
  const { monthlyIncluded } = planLimits(plan);
  return callsUsed > monthlyIncluded;
}
