import type { Plan } from "@datatorag-mcp/db";

export const TRIAL_DAYS = 30;

/** Free tool calls per period. Set by HQ decision, see SCRUM-57.
 *
 * This was 50 in here and a different number in the pricing decision, and the
 * two drifted apart without anyone noticing for one reason: nothing imported
 * this module outside its own test, so neither value was ever enforced. It is
 * enforced now, which is what makes the disagreement matter. */
export const FREE_MONTHLY_CAP = 250;

export const PRO_MONTHLY_INCLUDED = 2000;

/** Free agent runs per period, on our inference. Set by HQ decision, see
 * SCRUM-57.
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
      return { monthlyIncluded: FREE_MONTHLY_CAP, hardCap: true, multiAccount: false };
    case "pro_trial":
    case "pro":
      return { monthlyIncluded: PRO_MONTHLY_INCLUDED, hardCap: false, multiAccount: true };
    case "payg":
      return { monthlyIncluded: 0, hardCap: false, multiAccount: true };
  }
}

export function isOverage(plan: Plan, callsUsed: number): boolean {
  const { monthlyIncluded } = planLimits(plan);
  return callsUsed > monthlyIncluded;
}
