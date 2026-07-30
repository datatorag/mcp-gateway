import type { Metadata } from "next";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mcpServers, tools } from "@datatorag-mcp/db";
import { Navbar } from "@/components/navbar";
import { ShaderBackground } from "@/components/shader-background";
import { IntegrationCatalog } from "@/components/integration-catalog";
import { CircleCheckIcon, CircleMinusIcon } from "lucide-react";
import { CasaBadge } from "@/components/casa-badge";
import { StartupBarOffset } from "@/components/startupbar-offset";
import { DemoWindow } from "@/components/demo/demo-section";
import { getSessionUserId } from "@/lib/session";
import Link from "next/link";
import Script from "next/script";

export const dynamic = "force-dynamic";

const HOME_TITLE = "Let Claude edit your Google Sheets - DataToRAG";
const HOME_DESCRIPTION =
  "Claude's built-in connector reads your files but can't change them. DataToRAG appends the rows, sends the email, updates the ticket. 76 tools behind one URL, and every write asks you first.";

/* Canonical is self-referencing and absolute, on the non-www origin: Search
   Console was reporting the four origin variants (http/https x www/non-www)
   as "Duplicate without user-selected canonical" because nothing on the page
   named which one is the real URL. Matches the origin the sitemap uses.
   Title/description are homepage-specific — the root layout default stays
   the fallback for pages without their own. */
export const metadata: Metadata = {
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  alternates: { canonical: "https://datatorag.com" },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    type: "website",
    url: "https://datatorag.com",
  },
  twitter: {
    card: "summary",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
};

async function getToolCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(${tools.id})::int` })
    .from(tools)
    .innerJoin(mcpServers, eq(tools.mcpServerId, mcpServers.id))
    .where(eq(mcpServers.status, "active"));
  return row?.count ?? 0;
}

export default async function HomePage() {
  const [totalTools, userId] = await Promise.all([
    getToolCount(),
    getSessionUserId(),
  ]);
  const signedIn = userId !== null;
  const playgroundHref = signedIn ? "/dashboard" : "/auth/login";
  const demoPromptLabel = signedIn
    ? "Open the playground to run your own prompt"
    : "Sign in to run your own prompt";

  return (
    <>
      {/* StartupBar directory badge widget (landing page only). Public
          startup id — safe to ship. */}
      <Script
        src="https://startupbar.co/widget/loader.js"
        data-startup-id="f6d47644-c058-43e3-b69b-5a460c92ee88"
        strategy="afterInteractive"
      />
      {/* Tracks the injected bar's real height so the navbar and page sit
          below it instead of underneath it — see the component's comment. */}
      <StartupBarOffset />
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        {/* Hero */}
        <ShaderBackground>
          {/* One viewport-height column, centered as a group: extra vertical
              space goes above the hero and below the teaser — never between
              them. The hero→teaser gap is the teaser's fixed pt. */}
          <div className="relative flex min-h-[calc(100vh-4rem)] flex-col justify-center pb-12 pt-24">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-12 px-6 lg:flex-row lg:gap-16">
            {/* Copy */}
            <div className="flex-1 text-center lg:text-left">
              <div className="animate-fade-in-up inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 backdrop-blur-sm">
                <span className="text-xs font-medium text-white/90">
                  MCP gateway for Google Workspace and Jira
                </span>
              </div>
              <h1
                className="animate-fade-in-up mt-6 font-display text-4xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl"
                style={{ animationDelay: "0.06s" }}
              >
                Claude reads{" "}
                <span className="whitespace-nowrap">your spreadsheet.</span>{" "}
                <span className="text-blue-200">
                  <span className="whitespace-nowrap">We let it</span>{" "}
                  <span className="whitespace-nowrap">edit one.</span>
                </span>
              </h1>
              <p
                className="animate-fade-in-up mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg lg:mx-0"
                style={{ animationDelay: "0.12s" }}
              >
                Append the rows, send the email, update the ticket. Claude does
                the work in your real files instead of handing you something to
                paste. {totalTools > 0 ? totalTools : 76} tools across Google
                Workspace, Jira and Confluence behind one URL - and every write
                asks you first.
              </p>
              <div
                className="animate-fade-in-up mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start"
                style={{ animationDelay: "0.18s" }}
              >
                <Link
                  href="/auth/login"
                  className="rounded-full bg-white px-7 py-3 text-sm font-medium text-[#1a3a8f] transition-all hover:bg-white/90"
                >
                  Get Started
                </Link>
                <Link
                  href="/contact"
                  className="rounded-full border border-white/30 px-7 py-3 text-sm font-medium text-white transition-all hover:border-white/50 hover:bg-white/10"
                >
                  Talk to Us
                </Link>
              </div>

              {/* Accuracy constraint: rows must stay create-vs-change (the
                  built-in connector can create new files) — never a general
                  "no write access" claim. */}
              <div
                className="animate-fade-in-up mx-auto mt-8 w-full max-w-md lg:mx-0"
                style={{ animationDelay: "0.2s" }}
              >
                <table className="w-full overflow-hidden rounded-xl border border-white/15 bg-white/5 text-sm backdrop-blur-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/50">
                      <th scope="col" className="px-4 py-2.5"></th>
                      <th
                        scope="col"
                        className="px-2 py-2.5 text-center font-medium"
                      >
                        Built-in connector
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-2.5 text-center font-medium text-blue-200"
                      >
                        DataToRAG
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-white/80">
                    {[
                      { capability: "Read a file", builtIn: true },
                      { capability: "Edit an existing sheet", builtIn: false },
                      { capability: "Send an email", builtIn: false },
                    ].map(({ capability, builtIn }) => (
                      <tr
                        key={capability}
                        className="border-b border-white/10 last:border-b-0"
                      >
                        <th
                          scope="row"
                          className="px-4 py-2.5 text-left font-normal"
                        >
                          {capability}
                        </th>
                        {[builtIn, true].map((yes, i) => (
                          <td key={i} className="px-2 py-2.5 text-center">
                            {yes ? (
                              <>
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                  className="inline-block text-white/90"
                                >
                                  <path d="M3 8.5l3.5 3.5L13 5" />
                                </svg>
                                <span className="sr-only">Yes</span>
                              </>
                            ) : (
                              <span className="text-white/30" aria-hidden="true">
                                &mdash;
                              </span>
                            )}
                            {!yes && <span className="sr-only">No</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Badge lockup, not fine print. */}
              <div
                className="animate-fade-in-up mt-6"
                style={{ animationDelay: "0.22s" }}
              >
                <CasaBadge
                  className="justify-center lg:justify-start"
                  tone="dark"
                />
              </div>
            </div>

            {/* Demo video — vertical, to the right on desktop */}
            <div
              className="animate-fade-in-up flex w-full flex-shrink-0 justify-center lg:w-auto"
              style={{ animationDelay: "0.28s" }}
            >
              <div
                id="demo-video"
                className="aspect-[9/16] w-full max-w-[340px] overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur-sm lg:w-[340px]"
              >
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

          </div>
        </ShaderBackground>

        {/* Scripted demo — its own band: the product working, not more hero.
            Three windows replay authored sessions through the real playground
            presentation components; entirely client-side (no MCP calls, no
            API routes, no LLM). Bento hierarchy is deliberate: Sheets carries
            the full approval-gate arc and gets the space; Gmail and Jira
            prove breadth with short scripts. The problem/solution pairs are
            deliberately unparallel — only sourced limitations are named. */}
        <section id="playground" className="scroll-mt-28 bg-background">
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
            <div className="animate-fade-in-up text-center">
              <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
                Watch it do the work.
              </h2>
              <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                A scripted replay with sample data. This is the real
                playground UI, approval gate included.
              </p>
            </div>

            <div
              className="animate-fade-in-up mt-10 grid gap-4 lg:grid-cols-2"
              style={{ animationDelay: "0.1s" }}
            >
              {/* The text is the argument, the window is the evidence: the
                  solution line is the largest type in each cell, the problem
                  line stays visibly quieter. Neither outranks the section
                  heading. */}
              <div className="min-w-0 rounded-2xl border border-border bg-secondary/50 p-5 sm:p-6 lg:col-span-2 lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
                <div className="min-w-0 lg:col-span-5 lg:pt-2">
                  {/* Same visual grammar as the hero comparison table:
                      muted minus for the gap, primary check for the fix. */}
                  <p className="flex items-start gap-2.5 text-base leading-relaxed text-muted-foreground sm:text-lg">
                    <CircleMinusIcon
                      aria-hidden="true"
                      className="mt-1 size-5 shrink-0 text-muted-foreground/60"
                    />
                    <span>
                      Claude reads the sheet you already keep, then hands you
                      rows to paste in yourself.
                    </span>
                  </p>
                  <p className="mt-3 flex items-start gap-2.5 font-display text-xl font-semibold leading-snug text-foreground sm:text-2xl">
                    <CircleCheckIcon
                      aria-hidden="true"
                      className="mt-1 size-5 shrink-0 text-primary"
                    />
                    <span>
                      DataToRAG appends them to that same file, after asking
                      you first.
                    </span>
                  </p>
                </div>
                <div className="min-w-0 lg:col-span-7 lg:mt-0 mt-5">
                  <DemoWindow
                    id="sheets"
                    promptHref={playgroundHref}
                    promptLabel={demoPromptLabel}
                  />
                </div>
              </div>

              {[
                {
                  id: "gmail",
                  problem: "Claude writes the email and stops at the draft.",
                  solution:
                    "DataToRAG sends it from your account, once you approve.",
                },
                {
                  id: "jira",
                  problem:
                    "The ticket gets described in chat, then typed into Jira by hand.",
                  solution:
                    "DataToRAG creates it in your project with the fields already set.",
                },
              ].map((cell) => (
                <div
                  className="flex min-w-0 flex-col rounded-2xl border border-border bg-secondary/50 p-5 sm:p-6"
                  key={cell.id}
                >
                  <p className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
                    <CircleMinusIcon
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground/60"
                    />
                    <span>{cell.problem}</span>
                  </p>
                  <p className="mt-2 flex items-start gap-2 text-base font-semibold leading-snug text-foreground">
                    <CircleCheckIcon
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-primary"
                    />
                    <span>{cell.solution}</span>
                  </p>
                  {/* Bottom-anchor the window: the two small cells' text pairs
                      wrap differently, so anchoring keeps both chat windows on
                      the same baseline across the row. */}
                  <div className="mt-4 flex grow flex-col justify-end">
                    <DemoWindow
                      id={cell.id}
                      promptHref={playgroundHref}
                      promptLabel={demoPromptLabel}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 text-center">
              <Link
                href={playgroundHref}
                className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
              >
                {signedIn
                  ? "Run it for real: open your dashboard"
                  : "Run it for real: sign in and try the playground"}
              </Link>
            </div>
          </div>
        </section>

        {/* Platform — three pillars */}
        <section
          id="platform"
          className="scroll-mt-28 border-y border-border bg-secondary/50"
        >
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="animate-fade-in-up text-center">
              <p className="text-sm font-semibold uppercase tracking-widest text-primary">
                The platform
              </p>
              <h2 className="mt-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
                Four ways to connect your data
              </h2>
              <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
                Whether you want to plug in yourself, use a pre-built connector,
                need a custom integration, or run your own models, DataToRAG has
                you covered.
              </p>
            </div>

            <div
              className="animate-fade-in-up mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4"
              style={{ animationDelay: "0.1s" }}
            >
              {[
                {
                  title: "Self-Serve Gateway",
                  desc: "Sign up, connect your data sources, and start querying through Claude or any MCP client. No engineering required.",
                  icon: (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <path d="M8 21h8M12 17v4" />
                    </svg>
                  ),
                },
                {
                  title: "Pre-Built Connectors",
                  desc: "One-click integrations for Google Workspace, Salesforce, Databricks, Slack, and more. We handle the auth and schema mapping.",
                  icon: (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                  ),
                },
                {
                  title: "Custom MCP Servers",
                  desc: "Our engineering team builds custom MCP servers for your proprietary databases, internal APIs, and legacy systems.",
                  icon: (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
                    </svg>
                  ),
                },
                {
                  title: "Custom Hosted LLMs",
                  desc: "We deploy and host cost-saving custom models on our secure infrastructure without sacrificing quality. Wire directly into the gateway — your data and inference never go to Claude or OpenAI.",
                  icon: (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="12" rx="2" />
                      <path d="M7 20h10M9 16v4M15 16v4M7 8h.01M11 8h.01" />
                    </svg>
                  ),
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-border bg-background p-6"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                    {item.icon}
                  </div>
                  <h3 className="mt-4 font-display text-base font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Available integrations */}
        <section
          id="integrations"
          className="mx-auto max-w-6xl scroll-mt-28 px-6 py-20"
        >
          <div className="animate-fade-in-up">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              Integrations
            </p>
            <h2 className="mt-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
              Pre-built MCP connectors
            </h2>
            <p className="mt-3 max-w-lg text-sm text-muted-foreground">
              {totalTools > 0
                ? `${totalTools} tools, ready to use through the Model Context Protocol. `
                : "Ready-to-use integrations through the Model Context Protocol. "}
              Every integration works from one endpoint — connect once, use
              them all. More added every week.
            </p>
          </div>

          <div className="mt-10">
            <IntegrationCatalog />
          </div>

          {/* Differentiators */}
          <div
            className="animate-fade-in-up mt-10 grid gap-5 sm:grid-cols-2"
            style={{ animationDelay: "0.15s" }}
          >
            <div className="rounded-2xl border border-border bg-background p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="9" cy="8" r="3" />
                  <circle cx="17" cy="10" r="2.5" />
                  <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
                  <path d="M14.5 20c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5" />
                </svg>
              </div>
              <h3 className="mt-4 font-display text-base font-semibold text-foreground">
                Multi-account support
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Connect personal, shared, and team Google accounts under one MCP
                endpoint. Claude can search across all of them in a single
                prompt — or target a specific account when you need to.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
                </svg>
              </div>
              <h3 className="mt-4 font-display text-base font-semibold text-foreground">
                Optimized tools
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Naive API wrappers dump everything into your context. DataToRAG
                tools are tuned for token efficiency — the same Gmail thread
                read costs a fraction of the tokens, which means longer
                conversations and smarter agents.
              </p>
            </div>
          </div>

          {/* Coming soon connectors */}
          <div className="animate-fade-in-up mt-10" style={{ animationDelay: "0.2s" }}>
            <p className="text-sm font-medium text-muted-foreground">
              Coming soon
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                "Salesforce",
                "Databricks",
                "Slack",
                "HubSpot",
                "PostgreSQL",
                "Snowflake",
                "Notion",
                "GitHub",
              ].map((name) => (
                <span
                  key={name}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Custom Hosted LLMs */}
        <section
          id="custom-hosted-llms"
          className="scroll-mt-28 border-y border-border bg-secondary/50"
        >
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="animate-fade-in-up">
              <p className="text-sm font-semibold uppercase tracking-widest text-primary">
                Custom deployment
              </p>
              <h2 className="mt-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
                Custom Hosted LLMs
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Cut token usage costs while keeping the same efficiency? Try our custom
                hosted LLMs. We can assist in finding the right cost effective model for your workload.
              </p>
            </div>

            <div
              className="animate-fade-in-up mt-10 grid gap-5 sm:grid-cols-3"
              style={{ animationDelay: "0.1s" }}
            >
              <div className="rounded-2xl border border-border bg-background p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L3 7v6c0 5 4 8 9 9 5-1 9-4 9-9V7l-9-5z" />
                  </svg>
                </div>
                <h3 className="mt-4 font-display text-base font-semibold text-foreground">
                  Secure LLMs For Your Most Sensitive Data
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Inference runs on our secure infrastructure — nothing is
                  sent to a third-party model API. A perfect fit for regulated
                  industries and sensitive internal data.
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-background p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="12" rx="2" />
                    <path d="M7 20h10M9 16v4M15 16v4M7 8h.01M11 8h.01" />
                  </svg>
                </div>
                <h3 className="mt-4 font-display text-base font-semibold text-foreground">
                  Managed Infrastructure
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  We handle deployment and ops for the model of your choice —
                  GLM, Gemma, DeepSeek, Qwen, and other families. Connect it to
                  your MCP gateway or access it with API Keys.
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-background p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                  </svg>
                </div>
                <h3 className="mt-4 font-display text-base font-semibold text-foreground">
                  Cost Savings
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Custom hosted models cut per-token costs versus commercial
                  APIs. Scale usage and experience real cost
                  savings without compromising on quality.
                </p>
              </div>
            </div>

            <div
              className="animate-fade-in-up mt-10"
              style={{ animationDelay: "0.2s" }}
            >
              <Link
                href="/contact"
                className="inline-block rounded-[var(--radius)] bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90"
              >
                Talk to Us
              </Link>
            </div>
          </div>
        </section>

        {/* Built for — personas */}
        <section id="personas" className="border-y border-border bg-secondary/50">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="animate-fade-in-up text-center">
              <p className="text-sm font-semibold uppercase tracking-widest text-primary">
                Who it&apos;s for
              </p>
              <h2 className="mt-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
                Built for the way you work
              </h2>
            </div>

            <div
              className="animate-fade-in-up mt-12 grid gap-6 sm:grid-cols-3"
              style={{ animationDelay: "0.1s" }}
            >
              {[
                {
                  title: "Executives & managers",
                  desc: "Unified inbox triage across multiple Gmail accounts, calendar coordination, and drafting docs or slides via AI. Cross-account search finds the thread you need without context-switching.",
                },
                {
                  title: "Customer-facing teams",
                  desc: "Sales, CS, and support pull email and call context straight into AI prompts. Connect personal, shared, and team inboxes under one endpoint — triage threads fast without leaving the assistant.",
                },
                {
                  title: "Developers & AI builders",
                  desc: "One HTTP endpoint for Claude, custom agents, or internal tooling. OAuth per user, optimized tool responses, no infrastructure to run. Ship AI features without building an MCP server from scratch.",
                },
              ].map((persona) => (
                <div
                  key={persona.title}
                  className="rounded-2xl border border-border bg-background p-6"
                >
                  <h3 className="font-display text-base font-semibold text-foreground">
                    {persona.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {persona.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Custom Integration Services */}
        <section
          id="services"
          className="scroll-mt-28 mx-auto max-w-6xl px-6 py-20"
        >
          <div className="grid gap-12 sm:grid-cols-2 sm:items-center">
            <div className="animate-fade-in-up">
              <p className="text-sm font-semibold uppercase tracking-widest text-primary">
                Integration Services
              </p>
              <h2 className="mt-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
                We build the bridge
                <br />
                to your data.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Not every data source has a pre-built connector. Our engineering
                team works directly with your infrastructure to build custom MCP
                servers that give your AI assistants access to proprietary
                systems: databases, internal APIs, ERP platforms, data
                warehouses, and more.
              </p>
              <Link
                href="/contact"
                className="mt-6 inline-block rounded-[var(--radius)] bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90"
              >
                Contact Us
              </Link>
            </div>

            <div
              className="animate-fade-in-up space-y-4"
              style={{ animationDelay: "0.1s" }}
            >
              {[
                {
                  label: "Discovery",
                  desc: "We audit your data landscape and identify which systems to connect.",
                },
                {
                  label: "Build",
                  desc: "Custom MCP server development, tested against your schemas and APIs.",
                },
                {
                  label: "Deploy",
                  desc: "Managed infrastructure or on-prem, hosted alongside your data.",
                },
                {
                  label: "Support",
                  desc: "Ongoing maintenance, monitoring, and schema evolution as your systems change.",
                },
              ].map((step, i) => (
                <div
                  key={step.label}
                  className="flex gap-4 rounded-2xl border border-border p-5"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {i + 1}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {step.label}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {step.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Developer quick-start */}
        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-12 sm:grid-cols-2 sm:items-center">
            <div className="animate-fade-in-up">
              <p className="text-sm font-semibold uppercase tracking-widest text-primary">
                For developers
              </p>
              <h2 className="mt-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
                One line to connect.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Add the DataToRAG gateway to any MCP-compatible client: Claude
                Desktop, Cursor, Windsurf, or your own application. OAuth
                sign-in handles the rest.
              </p>
            </div>
            <div
              className="animate-fade-in-up"
              style={{ animationDelay: "0.1s" }}
            >
              <pre className="overflow-x-auto rounded-2xl border border-border bg-[#1C1917] p-6 font-mono text-sm leading-relaxed text-[#E7E5E4]">
{`{
  "mcpServers": {
    "datatorag": {
      "url": "https://datatorag.com/mcp"
    }
  }
}`}
              </pre>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-border bg-[#1C1917]">
          <div className="mx-auto max-w-6xl px-6 py-20 text-center">
            <h2 className="animate-fade-in-up font-display text-2xl font-bold text-white sm:text-3xl">
              Ready to make your data AI-ready?
            </h2>
            <p
              className="animate-fade-in-up mx-auto mt-4 max-w-md text-sm leading-relaxed text-[#A8A29E]"
              style={{ animationDelay: "0.08s" }}
            >
              Start with the self-serve gateway or talk to our team about a
              custom integration for your company.
            </p>
            <div
              className="animate-fade-in-up mt-8 flex flex-wrap justify-center gap-3"
              style={{ animationDelay: "0.16s" }}
            >
              <Link
                href="/auth/login"
                className="rounded-[var(--radius)] bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90"
              >
                Start Free
              </Link>
              <Link
                href="/contact"
                className="rounded-[var(--radius)] border border-white/20 px-6 py-3 text-sm font-medium text-white transition-all hover:border-white/40 hover:bg-white/5"
              >
                Contact Sales
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <p>DataToRAG &middot; MCP Gateway &amp; Integration Services</p>
        <p className="mt-2">
          <Link
            href="/blog/casa-tier-2-verified"
            className="underline hover:text-foreground"
          >
            Security: Google-verified (CASA Tier 2)
          </Link>
          {" "}&middot;{" "}
          <a href="/pricing" className="underline hover:text-foreground">Pricing</a>
          {" "}&middot;{" "}
          <a href="/privacy" className="underline hover:text-foreground">Privacy Policy</a>
          {" "}&middot;{" "}
          <a href="/terms" className="underline hover:text-foreground">Terms of Service</a>
          {" "}&middot;{" "}
          <a href="/changelog" className="underline hover:text-foreground">Changelog</a>
          {" "}&middot;{" "}
          <a
            href="https://github.com/datatorag/mcp-gateway"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            GitHub
          </a>
        </p>
      </footer>
    </>
  );
}
