import type { Metadata } from "next";
import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mcpServers, tools } from "@datatorag-mcp/db";
import { Navbar } from "@/components/navbar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing | DataToRAG",
  description:
    "Every tier gets the full gateway: all connectors, multi-account, and the approval gate on writes. We're setting prices with our early customers — talk to us and we'll figure out where you fit.",
  alternates: { canonical: "https://datatorag.com/pricing" },
  openGraph: {
    title: "Pricing | DataToRAG",
    description:
      "Every tier gets the full gateway: all connectors, multi-account, and the approval gate on writes. We're setting prices with our early customers — talk to us and we'll figure out where you fit.",
    type: "website",
    url: "https://datatorag.com/pricing",
  },
};

// All pricing CTAs land on the contact form tagged as pricing-originated
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
  note?: string;
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
      "Monthly usage allowance",
    ],
  },
  {
    name: "Pro",
    blurb: "For people who run real work through their agent every day.",
    features: [
      "Everything in Free",
      "Higher usage ceiling",
      "Starts with a full-featured, time-boxed trial",
    ],
    note: "Free trial included",
    highlighted: true,
  },
  {
    name: "Scale",
    blurb: "For teams and heavy automation, priced by what you actually use.",
    features: [
      "Everything in Pro",
      "Usage-based beyond included volume",
      "Hosted by us, or self-host the open-source gateway",
    ],
  },
];

export default async function PricingPage() {
  const totalTools = await getToolCount();

  return (
    <>
      <Navbar />
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
              We&apos;re setting prices with our early customers instead of
              guessing at a number and walking it back later. The tiers below
              are the shape of what you&apos;d pay for. Tell us what
              you&apos;re running and we&apos;ll tell you where you fit.
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
                {tier.note && (
                  <span className="absolute -top-3 left-6 rounded-full border border-primary/40 bg-background px-3 py-1 text-xs font-medium text-primary">
                    {tier.note}
                  </span>
                )}
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
                <Link
                  href={CONTACT_HREF}
                  className={tier.highlighted ? ctaPrimary : ctaSecondary}
                >
                  Talk to us
                </Link>
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
              Why no numbers yet?
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Because we&apos;d rather quote you a price we can stand behind
              than publish one we&apos;d have to change. Early conversations
              are literally how these tiers get their numbers. Ask us, and
              you&apos;ll get a straight answer for your usage, not a sales
              funnel.
            </p>
            <Link
              href={CONTACT_HREF}
              className="mt-8 inline-block rounded-[var(--radius)] bg-primary px-8 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90"
            >
              Ask about pricing
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
