/* Every sentence the Billing page says (SCRUM-352), in one module so the copy
 * test can hold all of it: no em dashes, and nothing here claims a state the
 * page cannot see. In particular nothing says "cancelling": a portal
 * cancellation keeps plan=pro until the period ends, so Pro is the truth
 * until the webhook says otherwise. */

export const BILLING_SUBTITLE = "Your plan, what you've used this period, and how you pay.";

/** Next to the cancel action, where it answers the question at the moment it is asked. */
export const CANCEL_SENTENCE =
  "If you cancel, Pro stays active until the end of the period you've paid for.";

export const NOT_BILLED_THROUGH_STRIPE =
  "This account's Pro plan isn't billed through Stripe, so there's nothing to manage here.";

export const USAGE_TITLE = "This period";
export const CALLS_LABEL = "Tool calls";
export const RUNS_LABEL = "Agent and skill runs";
export const NOT_CAPPED = "not capped";

export function resetLine(resetsAt: Date | null): string {
  if (!resetsAt) return "Your allowance resets on your next call.";
  const day = resetsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `Resets ${day}.`;
}

/** Free at the cap: the same stop enforcement applies, said plainly. */
export const FREE_AT_CAP =
  "You've hit the free allowance, so tool calls are paused until it resets. Upgrade to Pro for a bigger one.";

/** Pro has no hard stop; over the allowance it says so without implying a bill. */
export const PRO_OVER_ALLOWANCE = "You're past the included allowance this period. Nothing is paused.";

export const PAYMENT_TITLE = "Payment method";
export const UPDATE_LABEL = "Update";
export function cardLine(brand: string, last4: string): string {
  return `${brand.charAt(0).toUpperCase()}${brand.slice(1)} ending in ${last4}`;
}
export function expiryLine(month: number, year: number): string {
  return `Expires ${String(month).padStart(2, "0")}/${year}`;
}

export const INVOICES_TITLE = "Invoices";
export const ALL_INVOICES_LABEL = "All invoices";
export const NO_INVOICES = "No invoices yet.";
export const INVOICES_UNAVAILABLE =
  "Couldn't load your invoices right now. They're all in the billing portal.";
export const PAYMENT_UNAVAILABLE =
  "Couldn't load your payment method right now. You can see and change it in the billing portal.";
