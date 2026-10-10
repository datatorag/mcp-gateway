import type { CheckoutInterval } from "./checkout-client";

/**
 * What Pro costs, as the page says it.
 *
 * A PLAIN MODULE ON PURPOSE, WITH NO "use client". It used to live in
 * pricing-ctas.tsx, which is a client module. A server component that
 * imports a VALUE from a client module does not get the value: it gets a
 * reference to hand to the browser, and reading a property off it on the
 * server is undefined. The Billing page's plan cards did exactly that, on
 * the one branch only a Pro account reaches, so the page failed for every
 * Pro user and for nobody else. Components may cross that boundary; data
 * may not, so the data lives here and both sides import it.
 *
 * Dollar amounts are display copy for the live Stripe prices the checkout
 * route resolves from env. Verified against the live price objects
 * (unit_amount 2000 monthly / 20000 yearly, USD) on 2026-08-14; the copy
 * test pins these strings so they cannot drift apart silently.
 */
export const PRICE_LABEL: Record<CheckoutInterval, { amount: string; per: string }> = {
  monthly: { amount: "$20", per: "/ month" },
  yearly: { amount: "$200", per: "/ year" },
};
