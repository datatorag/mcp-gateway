import type { Plan } from "@datatorag-mcp/db";

export const TRIAL_DAYS = 30;
export const FREE_MONTHLY_CAP = 50;
export const PRO_MONTHLY_INCLUDED = 2000;

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
