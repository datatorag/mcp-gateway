"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";

/**
 * Billing SUMMARY on the usage page. Billing has its own route now
 * (/dashboard/billing, SCRUM-82) and Manuel explicitly wants this section to
 * stay — as a summary that links there, not a duplicate of it. The portal
 * button and the plan-vs-billing-relationship gating live on the billing
 * page; this renders the plan (server-read, right on first paint) and the
 * way in.
 *
 * Still no cancellation-state claims: plan=pro is the truth until the
 * webhook ends the period, whatever the user did in the portal.
 */
export function BillingCard({ plan }: { plan: string }) {
  const isPro = plan === "pro";

  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-bold text-foreground">
            Billing
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isPro ? "You're on the Pro plan." : "You're on the Free plan."}
          </p>
        </div>
        <Link
          href="/dashboard/billing"
          className="rounded-[var(--radius)] border border-border px-5 py-2 text-sm font-medium text-foreground transition-all hover:border-primary/40 hover:bg-secondary/50"
        >
          Billing details
        </Link>
      </div>
    </Card>
  );
}
