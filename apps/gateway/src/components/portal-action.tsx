"use client";

import { useState } from "react";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";
import { openBillingPortal } from "@/app/dashboard/billing/portal-client";

/**
 * One control that opens the Stripe billing portal (SCRUM-352). Manage,
 * cancel, downgrade, update a card and see every invoice all happen in the
 * portal, so every one of those buttons is this component with its own label.
 *
 * Render it only for an account with a Stripe customer: the portal route 400s
 * without one, and that precondition is the billing relationship, not the
 * plan (SCRUM-81).
 */
export function PortalAction({
  label,
  source,
  className,
  navigate = (url) => window.location.assign(url),
}: {
  label: string;
  /** Which control was clicked, for the analytics event. */
  source: string;
  className: string;
  /** Injection point for tests; production uses a full-page navigation. */
  navigate?: (url: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (pending) return;
    setPending(true);
    setError(null);
    posthog.capture(EVENTS.BILLING_PORTAL_CLICKED, { source });
    const outcome = await openBillingPortal();
    if (outcome.kind === "redirect") {
      navigate(outcome.url);
      return; // stay disabled while the browser leaves the page
    }
    setError(outcome.message);
    setPending(false);
  }

  return (
    <>
      <button type="button" onClick={open} disabled={pending} className={`${className} disabled:opacity-60`}>
        {pending ? "Opening portal…" : label}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-xs text-muted-foreground">
          {error}
        </p>
      )}
    </>
  );
}
