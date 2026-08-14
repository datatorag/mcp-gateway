"use client";

import { useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { Card } from "@/components/ui/card";
import { EVENTS } from "@/lib/analytics";
import { openBillingPortal } from "./portal-client";

/**
 * The billing page body. Both facts arrive from the server component so the
 * page is right on first paint: `plan` (users.plan, maintained only by the
 * subscription webhooks) and `hasBillingAccount` (stripe_customer_id
 * present).
 *
 * THE MANAGE CONTROL'S PRECONDITION IS THE BILLING RELATIONSHIP, NOT THE
 * PLAN (SCRUM-81). A manually-promoted Pro account (internal, comped, or a
 * hand-run trial) has plan=pro and no Stripe customer, and the portal route
 * correctly 400s for it — so gating on plan renders a control that is dead
 * on arrival for exactly the accounts we were doing a favour for. Plan
 * decides which plan is DESCRIBED; the customer id decides whether there is
 * anything to MANAGE.
 *
 * SAYS NOTHING ABOUT CANCELLATION STATE, same rule as everywhere: a portal
 * cancellation keeps plan=pro until the period ends (and arrives with
 * cancel_at set while cancel_at_period_end stays false), so "Pro" is the
 * truth and any "cancelling…" badge would be a guess.
 */
export function BillingClient({
  plan,
  hasBillingAccount,
  freeCallsLabel,
  proCallsLabel,
  navigate = (url) => window.location.assign(url),
}: {
  plan: string;
  hasBillingAccount: boolean;
  /** Formatted allowance numbers, rendered by the server from billing/plans.ts
   * constants so this page cannot say a number enforcement does not read. */
  freeCallsLabel: string;
  proCallsLabel: string;
  /** Injection point for tests; production uses a full-page navigation. */
  navigate?: (url: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPro = plan === "pro";

  async function manage() {
    if (pending) return;
    setPending(true);
    setError(null);
    posthog.capture(EVENTS.BILLING_PORTAL_CLICKED, { source: "billing_page" });
    const outcome = await openBillingPortal();
    if (outcome.kind === "redirect") {
      navigate(outcome.url);
      return; // stay disabled while the browser leaves the page
    }
    setError(outcome.message);
    setPending(false);
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-foreground">
        Billing
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your plan, payment method, and invoices.
      </p>

      <Card className="mt-6 p-5">
        <h2 className="font-display text-base font-bold text-foreground">
          Plan
        </h2>
        <p className="mt-2 text-sm text-foreground">
          {isPro ? "Pro" : "Free"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isPro
            ? `${proCallsLabel} tool calls a month included.`
            : `${freeCallsLabel} tool calls a month included, then a hard stop, never a surprise bill.`}
        </p>
        {!isPro && (
          <Link
            href="/pricing"
            className="mt-4 inline-block self-start rounded-[var(--radius)] bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90"
          >
            See plans
          </Link>
        )}
      </Card>

      {isPro && (
        <Card className="mt-6 p-5">
          <h2 className="font-display text-base font-bold text-foreground">
            Manage
          </h2>
          {hasBillingAccount ? (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                Your payment method, invoices and subscription live in the
                Stripe billing portal. If you cancel, Pro stays active until
                the end of the period you&apos;ve paid for.
              </p>
              <button
                type="button"
                onClick={manage}
                disabled={pending}
                className="mt-4 self-start rounded-[var(--radius)] bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-60"
              >
                {pending ? "Opening portal…" : "Manage billing"}
              </button>
              {error && (
                <p role="alert" className="mt-3 text-xs text-muted-foreground">
                  {error}
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              This account&apos;s Pro plan isn&apos;t billed through Stripe, so
              there&apos;s nothing to manage here.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
