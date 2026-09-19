import { planLimits } from "@/gateway/billing/plans";

/* The allowance bullets on the pricing cards (SCRUM-290).
 *
 * Built from `planLimits`, the same function enforcement reads, so the page
 * cannot promise a number the product does not grant. Pro's agent-run
 * allowance has no constant of its own on purpose (see plans.ts), which is why
 * this reads the plan table rather than importing a number.
 *
 * They live here, not in page.tsx, because a Next page module may only export
 * its reserved names, and the test needs to import what the page renders. */

const count = (n: number) => n.toLocaleString("en-US");

export function freeAllowanceBullet(): string {
  const free = planLimits("free");
  return `${count(free.monthlyIncluded)} tool calls and ${count(free.agentRuns)} agent runs a month, then a hard stop, never a surprise bill`;
}

export function proAllowanceBullet(): string {
  const pro = planLimits("pro");
  return `${count(pro.monthlyIncluded)} tool calls and ${count(pro.agentRuns)} agent runs a month included`;
}

/** Follows the allowance bullet on the Pro card: "that" is the line above. */
export const PRO_RUNS_BULLET = "Skill and agent runs come out of that, no separate bill for the model";
