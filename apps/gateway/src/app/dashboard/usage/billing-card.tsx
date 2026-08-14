"use client";

import { useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { Card } from "@/components/ui/card";
import { EVENTS } from "@/lib/analytics";
import { openBillingPortal } from "./portal-client";

/**
 * The billing section of the usage page — the one place a paying user can
 * reach the Stripe portal (cancel, plan change, card, invoices) without a
 * support conversation.
 *
 * GATED ON plan === "pro", the value the subscription webhooks maintain:
 * everyone else gets a live link to /pricing rather than a portal button that
 * would 400 for them (the portal needs a Stripe customer, which non-payers
 * don't have). That includes unknown plan values, matching planLimits()'s
 * least-privilege default.
 *
 * DELIBERATELY SAYS NOTHING ABOUT CANCELLATION STATE. A user who cancels in
 * the portal keeps plan=pro until the period ends (cancel_at_period_end),
 * so this card keeps showing Pro — which is TRUE. Claiming "downgraded"
 * here would be false, invite a support message, and prompt a second
 * cancellation attempt. The one line of copy about it states the real rule.
 */
export function BillingCard({
  plan,
  navigate = (url) => window.location.assign(url),
}: {
  plan: string;
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
    posthog.capture(EVENTS.BILLING_PORTAL_CLICKED, {});
    const outcome = await openBillingPortal();
    if (outcome.kind === "redirect") {
      navigate(outcome.url);
      return; // stay disabled while the browser leaves the page
    }
    setError(outcome.message);
    setPending(false);
  }

  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-bold text-foreground">
            Billing
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isPro
              ? "You're on the Pro plan."
              : "You're on the Free plan."}
          </p>
        </div>
        {isPro ? (
          <button
            type="button"
            onClick={manage}
            disabled={pending}
            className="rounded-[var(--radius)] bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-60"
          >
            {pending ? "Opening portal…" : "Manage billing"}
          </button>
        ) : (
          <Link
            href="/pricing"
            className="rounded-[var(--radius)] border border-border px-5 py-2 text-sm font-medium text-foreground transition-all hover:border-primary/40 hover:bg-secondary/50"
          >
            See plans
          </Link>
        )}
      </div>
      {isPro && (
        <p className="mt-3 text-xs text-muted-foreground">
          Manage your payment method, invoices and subscription in the Stripe
          billing portal. If you cancel, Pro stays active until the end of the
          period you've paid for.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-muted-foreground">
          {error}
        </p>
      )}
    </Card>
  );
}
