import Link from "next/link";
import { PRO_RUNS_BULLET, freeAllowanceBullet, proAllowanceBullet } from "@/app/pricing/allowances";
import { FreeCta, PRICE_LABEL, ProCheckout } from "@/app/pricing/pricing-ctas";
import { PortalAction } from "@/components/portal-action";
import { CANCEL_SENTENCE, NOT_BILLED_THROUGH_STRIPE } from "@/app/dashboard/billing/billing-copy";

/**
 * The Free, Pro and Enterprise cards, shared by /pricing and the dashboard's
 * Billing page (SCRUM-352), so the two cannot describe a plan differently.
 * The allowance lines come from allowances.ts, which reads the plan table
 * enforcement reads.
 *
 * Two modes, chosen by whether `current` is passed:
 *
 *   pricing   no current plan: Pro is highlighted, and each card carries its
 *             sign-up action, exactly as /pricing has always rendered.
 *   billing   the signed-in user's plan: that card is highlighted and badged
 *             "Current plan", and the actions become what that user can do
 *             from where they are.
 *
 * In billing mode every downgrade, cancel and manage action opens the Stripe
 * portal, and only for an account with a Stripe customer (SCRUM-81: the
 * precondition is the billing relationship, not the plan).
 */

type TierName = "Free" | "Pro" | "Enterprise";

interface Tier {
  name: TierName;
  blurb: string;
  features: string[];
  /** Static price line; Pro renders its own inside the checkout component. */
  price?: { amount: string; per?: string };
  highlighted?: boolean;
}

export const TIERS: Tier[] = [
  {
    name: "Free",
    blurb: "For individuals proving out an AI workflow. No card required.",
    features: [
      "Every connector and every tool",
      "Multi-account: work and personal side by side",
      "Approval gate on every write",
      freeAllowanceBullet(),
    ],
    price: { amount: "$0" },
  },
  {
    name: "Pro",
    blurb: "For people who run real work through their agent every day.",
    features: [
      "Everything in Free",
      proAllowanceBullet(),
      PRO_RUNS_BULLET,
      "No feature gates, just a bigger allowance",
    ],
    highlighted: true,
  },
  {
    name: "Enterprise",
    blurb: "For teams committing to volume. Quoted directly, by a person.",
    features: [
      "Everything in Pro",
      "Committed volume at a negotiated rate",
      "Hosted by us, or self-host the open-source gateway",
    ],
    price: { amount: "Custom" },
  },
];

// All quote-path CTAs land on the contact form tagged as pricing-originated
// (?from=pricing turns into utm_source "pricing_page" on the lead and the
// analytics event), so these conversations stay separable from ad-driven
// form fills.
const CONTACT_HREF = "/contact?from=pricing";

const ctaClass =
  "mt-8 block rounded-[var(--radius)] px-6 py-2.5 text-center text-sm font-medium transition-all";
const ctaPrimary = `${ctaClass} bg-primary text-primary-foreground hover:bg-primary/90`;
const ctaSecondary = `${ctaClass} border border-border text-foreground hover:border-primary/40 hover:bg-secondary/50`;

/** The plan a billing page is showing, and what the account can manage. */
export interface CurrentPlan {
  /** users.plan; anything but "pro" is shown as Free, as enforcement treats it. */
  plan: string;
  /** A Stripe customer exists, so the portal can open (SCRUM-81). */
  hasBillingAccount: boolean;
}

function tierOf(plan: string): TierName {
  return plan === "pro" ? "Pro" : "Free";
}

function Price({ amount, per }: { amount: string; per?: string }) {
  return (
    <div className="mt-6">
      <span className="font-display text-3xl font-bold text-foreground">{amount}</span>
      {per && <span className="ml-1 text-sm text-muted-foreground">{per}</span>}
    </div>
  );
}

function PricingAction({ tier, promo }: { tier: Tier; promo: string | null }) {
  if (tier.name === "Pro") return <ProCheckout className={ctaPrimary} promo={promo} />;
  if (tier.name === "Free") return <FreeCta className={ctaSecondary} />;
  return (
    <Link href={CONTACT_HREF} className={ctaSecondary}>
      Talk to us
    </Link>
  );
}

/** What a signed-in user can do from each card, given the plan they are on. */
function BillingAction({ tier, current }: { tier: Tier; current: CurrentPlan }) {
  const mine = tierOf(current.plan);
  if (tier.name === "Enterprise") {
    return (
      <Link href={CONTACT_HREF} className={ctaSecondary}>
        Talk to us
      </Link>
    );
  }
  if (tier.name === "Pro" && mine === "Free") {
    return <ProCheckout className={ctaPrimary} />;
  }
  if (tier.name === "Pro" && mine === "Pro") {
    if (!current.hasBillingAccount) {
      return <p className="mt-8 text-sm text-muted-foreground">{NOT_BILLED_THROUGH_STRIPE}</p>;
    }
    return (
      <div className="mt-8">
        <PortalAction
          label="Manage or cancel"
          source="billing_plan_manage"
          className={`${ctaSecondary.replace("mt-8 ", "")} w-full`}
        />
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{CANCEL_SENTENCE}</p>
      </div>
    );
  }
  if (tier.name === "Free" && mine === "Pro" && current.hasBillingAccount) {
    return (
      <PortalAction label="Downgrade" source="billing_plan_downgrade" className={`${ctaSecondary} w-full`} />
    );
  }
  // Your own Free card, or Free while on a Pro plan that has nothing to manage.
  return null;
}

export function PlanCards({
  current,
  promo = null,
  className = "grid gap-6 lg:grid-cols-3",
}: {
  current?: CurrentPlan;
  promo?: string | null;
  className?: string;
}) {
  const mine = current ? tierOf(current.plan) : null;
  return (
    <div className={className}>
      {TIERS.map((tier) => {
        const isCurrent = tier.name === mine;
        // One highlighted card: Pro on /pricing, the user's own on Billing.
        const highlighted = current ? isCurrent : tier.highlighted;
        const showStaticPrice = tier.price || (current && tier.name === "Pro" && mine === "Pro");
        return (
          <div
            key={tier.name}
            data-tier={current ? tier.name : undefined}
            data-current={isCurrent ? "true" : undefined}
            className={`relative flex flex-col rounded-2xl border p-6 ${
              highlighted ? "border-primary/40 bg-secondary/30" : "border-border bg-background"
            }`}
          >
            <h2 className="font-display text-xl font-semibold text-foreground">{tier.name}</h2>
            {isCurrent && (
              <span className="absolute right-6 top-6 rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
                Current plan
              </span>
            )}
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{tier.blurb}</p>
            <ul className="mt-6 flex-1 space-y-3 text-sm text-muted-foreground">
              {tier.features.map((feature) => (
                <li key={feature} className="flex gap-3">
                  <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {feature}
                </li>
              ))}
            </ul>
            {showStaticPrice && (
              <Price {...(tier.price ?? { amount: PRICE_LABEL.monthly.amount, per: PRICE_LABEL.monthly.per })} />
            )}
            {current ? <BillingAction tier={tier} current={current} /> : <PricingAction tier={tier} promo={promo} />}
          </div>
        );
      })}
    </div>
  );
}
