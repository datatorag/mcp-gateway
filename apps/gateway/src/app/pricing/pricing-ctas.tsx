"use client";

import { useState } from "react";
import posthog from "posthog-js";
import { EVENTS } from "@/lib/analytics";
import { useSignupConversion } from "../dashboard/use-signup-conversion";
import {
  startProCheckout,
  type CheckoutInterval,
} from "./checkout-client";

/**
 * Mounted once by the pricing page. The Pro CTA sends signed-out visitors
 * through /auth/login?next=/pricing, and a NEW user comes back here carrying
 * ?signup=1, the sole gate on the Google Ads signup conversion. The hook
 * reads the PARAM, not the page, so mounting it here is all the wiring the
 * conversion needs; without a reader on this page the param would arrive and
 * silently expire.
 */
export function PricingConversionListener() {
  useSignupConversion();
  return null;
}

export function FreeCta({ className }: { className: string }) {
  return (
    <a
      href="/auth/login"
      className={className}
      onClick={() =>
        posthog.capture(EVENTS.PRICING_CTA_CLICKED, { cta: "free" })
      }
    >
      Start free
    </a>
  );
}

/* Dollar amounts are display copy for the live Stripe prices the checkout
 * route resolves from env. Verified against the live price objects
 * (unit_amount 2000 monthly / 20000 yearly, USD) on 2026-08-14; the copy
 * test pins these strings so they cannot drift apart silently. */
const PRICE_LABEL: Record<CheckoutInterval, { amount: string; per: string }> = {
  monthly: { amount: "$20", per: "/ month" },
  yearly: { amount: "$200", per: "/ year" },
};

export function ProCheckout({ className }: { className: string }) {
  const [interval, setInterval] = useState<CheckoutInterval>("monthly");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = PRICE_LABEL[interval];

  async function upgrade() {
    if (pending) return;
    setPending(true);
    setError(null);
    posthog.capture(EVENTS.PRICING_CTA_CLICKED, { cta: "pro", interval });
    const outcome = await startProCheckout(interval);
    if (outcome.kind === "redirect") {
      window.location.assign(outcome.url);
      return; // keep the button disabled while the browser navigates
    }
    setError(outcome.message);
    setPending(false);
  }

  return (
    <div className="mt-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <span className="font-display text-3xl font-bold text-foreground">
            {price.amount}
          </span>
          <span className="ml-1 text-sm text-muted-foreground">{price.per}</span>
          <p className="mt-1 text-xs text-muted-foreground">
            {interval === "yearly"
              ? "Two months free vs monthly"
              : "Or $200 a year, two months free"}
          </p>
        </div>
        <div
          role="group"
          aria-label="Billing interval"
          className="flex shrink-0 rounded-full border border-border p-0.5 text-xs"
        >
          {(["monthly", "yearly"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={interval === option}
              onClick={() => setInterval(option)}
              className={`rounded-full px-2.5 py-1 capitalize transition-colors ${
                interval === option
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={upgrade}
        disabled={pending}
        className={`${className} w-full disabled:opacity-60`}
      >
        {pending ? "Opening checkout…" : "Upgrade to Pro"}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-xs text-muted-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
