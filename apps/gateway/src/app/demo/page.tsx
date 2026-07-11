import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { ContactForm } from "./contact-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Get in touch | DataToRAG",
  description:
    "Tell us what you're trying to build with AI. We'll figure out whether DataToRAG fits, and if it does, the shortest path to a working setup against your data.",
};

type SearchParams = Promise<{
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}>;

export default async function DemoPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const utm = {
    source: params.utm_source,
    medium: params.utm_medium,
    campaign: params.utm_campaign,
    term: params.utm_term,
    content: params.utm_content,
  };

  return (
    <>
      <Navbar />
      <main>
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              Google Workspace for Claude
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Stop pasting Claude&apos;s drafts
              <br />
              into your Google Docs.
            </h1>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              DataToRAG gives Claude write access to your Docs, Sheets, and
              Slides, plus Gmail, Calendar, Drive, Contacts, and Tasks. Tell us
              what you&apos;re trying to build and we&apos;ll show you the
              shortest path to a working setup against your data.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {[
                "48 tools · 8 Google services",
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
                No pitch deck. We want to hear what your team does day-to-day and
                where AI is or isn&apos;t helping.
              </li>
              <li className="flex gap-3">
                <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                Straight answers. If DataToRAG isn&apos;t the right fit, we&apos;ll
                say so.
              </li>
              <li className="flex gap-3">
                <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                If it is a fit, we work out the shortest path to a working setup
                against your data.
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

        {/* See it in action — explainer video */}
        <section className="border-t border-border bg-secondary/30">
          <div className="mx-auto max-w-3xl px-6 py-16 text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              See it in action
            </p>
            <h2 className="mt-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
              Watch Claude work inside Google Workspace
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
              A short walkthrough of Claude reading and writing real Docs,
              Sheets, and Gmail through DataToRAG.
            </p>
            <div className="mt-10 flex justify-center">
              <div className="aspect-[9/16] w-full max-w-[320px] overflow-hidden rounded-3xl border border-border bg-secondary/30 shadow-xl">
                <video
                  src="/explainer-2026-05.mp4"
                  poster="/explainer-2026-05-poster.jpg"
                  autoPlay
                  muted
                  loop
                  playsInline
                  controls
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
