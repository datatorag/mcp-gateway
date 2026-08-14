import type { Metadata } from "next";
import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mcpServers, tools } from "@datatorag-mcp/db";
import { Navbar } from "@/components/navbar";
import {
  FREE_MONTHLY_CAP,
  PRO_MONTHLY_INCLUDED,
} from "@/gateway/billing/plans";
import {
  FreeCta,
  PricingConversionListener,
  ProCheckout,
} from "./pricing-ctas";

export const dynamic = "force-dynamic";

// Call allowances render from the same constants enforcement reads
// (billing/plans.ts), so the page cannot say one number while the gateway
// enforces another. The dollar amounts live in pricing-ctas.tsx next to the
// checkout that charges them.
const FREE_CALLS = FREE_MONTHLY_CAP.toLocaleString("en-US");
const PRO_CALLS = PRO_MONTHLY_INCLUDED.toLocaleString("en-US");

const description = `Free tier with ${FREE_CALLS} tool calls a month, no card required. Pro is $20 a month or $200 a year with ${PRO_CALLS} calls included. Every tier gets all connectors, multi-account, and the approval gate on writes.`;

export const metadata: Metadata = {
  title: "Pricing | DataToRAG",
  description,
  alternates: { canonical: "https://datatorag.com/pricing" },
  openGraph: {
    title: "Pricing | DataToRAG",
    description,
    type: "website",
    url: "https://datatorag.com/pricing",
  },
};

// All quote-path CTAs land on the contact form tagged as pricing-originated
// (?from=pricing → utm_source "pricing_page" on the lead + analytics event),
// so these conversations stay separable from ad-driven form fills.
const CONTACT_HREF = "/contact?from=pricing";

const ctaClass =
  "mt-8 block rounded-[var(--radius)] px-6 py-2.5 text-center text-sm font-medium transition-all";
const ctaPrimary = `${ctaClass} bg-primary text-primary-foreground hover:bg-primary/90`;
const ctaSecondary = `${ctaClass} border border-border text-foreground hover:border-primary/40 hover:bg-secondary/50`;

async function getToolCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(${tools.id})::int` })
    .from(tools)
    .innerJoin(mcpServers, eq(tools.mcpServerId, mcpServers.id))
    .where(eq(mcpServers.status, "active"));
  return row?.count ?? 0;
}

interface Tier {
  name: string;
  blurb: string;
  features: string[];
  /** Static price line; Pro renders its own inside the checkout component. */
  price?: { amount: string; per?: string };
  cta: "free" | "checkout" | "contact";
  highlighted?: boolean;
}

const tiers: Tier[] = [
  {
    name: "Free",
    blurb: "For individuals proving out an AI workflow. No card required.",
    features: [
      "Every connector and every tool",
      "Multi-account: work and personal side by side",
      "Approval gate on every write",
      `${FREE_CALLS} tool calls a month, then a hard stop, never a surprise bill`,
    ],
    price: { amount: "$0" },
    cta: "free",
  },
  {
    name: "Pro",
    blurb: "For people who run real work through their agent every day.",
    features: [
      "Everything in Free",
      `${PRO_CALLS} tool calls a month included`,
      "No feature gates, just a bigger allowance",
    ],
    cta: "checkout",
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
    cta: "contact",
  },
];

export default async function PricingPage() {
  const totalTools = await getToolCount();

  return (
    <>
      <Navbar />
      <PricingConversionListener />
      <main>
        <div className="mx-auto max-w-6xl px-6 pb-16 pt-32 sm:pt-36">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              Pricing
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Every tier gets the full gateway
            </h1>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              Free to start, no card required. One flat price when you outgrow
              the free allowance, and a straight quote for committed volume.
            </p>
          </div>

          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`relative flex flex-col rounded-2xl border p-6 ${
                  tier.highlighted
                    ? "border-primary/40 bg-secondary/30"
                    : "border-border bg-background"
                }`}
              >
                <h2 className="font-display text-xl font-semibold text-foreground">
                  {tier.name}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {tier.blurb}
                </p>
                <ul className="mt-6 flex-1 space-y-3 text-sm text-muted-foreground">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-3">
                      <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>
                {tier.price && (
                  <div className="mt-6">
                    <span className="font-display text-3xl font-bold text-foreground">
                      {tier.price.amount}
                    </span>
                    {tier.price.per && (
                      <span className="ml-1 text-sm text-muted-foreground">
                        {tier.price.per}
                      </span>
                    )}
                  </div>
                )}
                {tier.cta === "checkout" ? (
                  <ProCheckout className={ctaPrimary} />
                ) : tier.cta === "free" ? (
                  <FreeCta className={ctaSecondary} />
                ) : (
                  <Link href={CONTACT_HREF} className={ctaSecondary}>
                    Talk to us
                  </Link>
                )}
              </div>
            ))}
          </div>

          <div className="mx-auto mt-14 max-w-3xl rounded-2xl border border-border bg-secondary/30 p-8 text-center">
            <h2 className="font-display text-xl font-semibold text-foreground">
              Included in every tier
            </h2>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {[
                `${totalTools > 0 ? totalTools : "70+"} tools across Google Workspace + Jira/Confluence`,
                "All connectors, no per-connector upsell",
                "Multi-account",
                "Approval gate on writes",
                "Google-verified · CASA Tier 2",
                "Open source",
              ].map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="mx-auto mt-14 max-w-2xl text-center">
            <h2 className="font-display text-2xl font-bold text-foreground">
              Not sure where you fit?
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Tell us what you&apos;re running and you&apos;ll get a straight
              answer for your usage, not a sales funnel.
            </p>
            <Link
              href={CONTACT_HREF}
              className="mt-8 inline-block rounded-[var(--radius)] bg-primary px-8 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90"
            >
              Talk to us
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
