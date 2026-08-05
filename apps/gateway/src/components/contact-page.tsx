import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { ContactForm, type Utm } from "@/components/contact-form";
import { DemoBento } from "@/components/demo/demo-bento";

// Rendered by both /contact (canonical) and /demo (kept for ad destinations
// and historical analytics continuity) — one source of truth for the form.
export function ContactPage({ utm }: { utm: Utm }) {
  return (
    <>
      <Navbar />
      <main>
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              Contact Us
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Let&apos;s Connect!
            </h1>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              DataToRAG offers a secure and seamless unified AI Platform to transform your business.
              Integrate Claude directly with your Google Workspace or
              discover how our hosted LLMs can reduce your token costs without compromising quality.
              Tell us
              what you&apos;re trying to achieve and we&apos;ll show you the
              shortest path to a working solution.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {[
                "70+ tools · Google Workspace + Atlassian",
                "Multi-account",
                "Google-verified · CASA Tier 2",
              ].map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground"
                >
                  {badge}
                </span>
              ))}
            </div>

            <ul className="mt-8 space-y-4 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                No pitch deck. We want to solution with you and remove roadblocks.
              </li>
              <li className="flex gap-3">
                <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                Straight answers. Your time is valuable. Find out if DataToRAG is right for you and your company.
              </li>
            </ul>

            <p className="mt-10 text-xs text-muted-foreground">
              Already a user? Reach the team at{" "}
              <a
                href="mailto:support@datatorag.com"
                className="underline hover:text-foreground"
              >
                support@datatorag.com
              </a>
              .
            </p>
          </div>

          <div>
            <ContactForm utm={utm} />

            <div className="mt-5 text-center">
              <p className="text-sm text-muted-foreground">
                Not ready to talk? Start using DataToRAG now, no call required.
              </p>
              <Link
                href="/auth/login"
                className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-secondary/50"
              >
                Start free
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
              </Link>
            </div>
          </div>
        </div>

        {/* See it in action — the same scripted windows the home page runs,
            replacing a talking-head explainer. The windows show the product
            doing the work; the video described it.

            No composer link and no playground CTA, unlike the home page: this
            page exists to collect the form above, and a second route out of
            it competes with the one conversion it has. */}
        <section className="border-t border-border bg-secondary/30">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <DemoBento heading="Watch Claude work inside Google Workspace" />
          </div>
        </section>
      </main>
    </>
  );
}
