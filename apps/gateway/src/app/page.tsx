import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mcpServers, tools } from "@datatorag-mcp/db";
import { Navbar } from "@/components/navbar";
import { ShaderBackground } from "@/components/shader-background";
import { IntegrationCatalog } from "@/components/integration-catalog";
import { getSessionUserId } from "@/lib/session";
import Link from "next/link";

export const dynamic = "force-dynamic";

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
  const playgroundCta = signedIn ? "Open your dashboard" : "Sign in to try it";

  return (
    <>
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
                  Google Workspace for Claude · Read and Write
                </span>
              </div>
              <h1
                className="animate-fade-in-up mt-6 font-display text-4xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl"
                style={{ animationDelay: "0.06s" }}
              >
                Stop pasting Claude&apos;s drafts into your{" "}
                <span className="text-blue-200">Google Docs.</span>
              </h1>
              <p
                className="animate-fade-in-up mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg lg:mx-0"
                style={{ animationDelay: "0.12s" }}
              >
                DataToRAG gives Claude write access to your Docs, Sheets, and
                Slides. Plus Gmail, Calendar, Drive, Contacts, and Tasks. The
                draft it just generated actually lands in the doc. No more
                copy, switch tab, paste, format.
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
                  href="/demo"
                  className="rounded-full border border-white/30 px-7 py-3 text-sm font-medium text-white transition-all hover:border-white/50 hover:bg-white/10"
                >
                  Talk to Us
                </Link>
              </div>
              <p
                className="animate-fade-in-up mx-auto mt-6 max-w-xl text-xs text-white/50 lg:mx-0"
                style={{ animationDelay: "0.22s" }}
              >
                Google-verified app. Passed the CASA Tier 2 security assessment (June 2026).{" "}
                <Link
                  href="/blog/casa-tier-2-verified"
                  className="underline transition-colors hover:text-white/80"
                >
                  Read more
                </Link>
              </p>
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

          {/* Playground teaser — still on the hero gradient, right under the
              hero content. The whole card links to sign-in (or the dashboard
              when a session exists). */}
          <div
            id="playground"
            className="animate-fade-in-up relative mx-auto w-full max-w-6xl scroll-mt-28 px-6 pt-16"
            style={{ animationDelay: "0.34s" }}
          >
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-xl font-bold text-white sm:text-2xl">
                Or try it right now in the playground.
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
                {signedIn
                  ? "You're signed in — open your dashboard to connect your Google account and run prompts live."
                  : "Sign in, connect your Google account, and run prompts from your dashboard. No MCP client setup required."}
              </p>
            </div>

            <Link
              href={playgroundHref}
              aria-label={playgroundCta}
              className="group mx-auto mt-6 block max-w-2xl"
            >
              <div className="rounded-2xl border border-white/15 bg-white/10 shadow-2xl backdrop-blur-sm transition-colors hover:border-white/35">
                <div className="space-y-3 p-4">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl bg-white/90 px-3 py-2 text-xs text-[#1a3a8f]">
                      Find the Q3 planning doc and add a summary of
                      yesterday&apos;s kickoff notes.
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="max-w-[85%] space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {["drive_search", "docs_get", "docs_write"].map(
                          (tool) => (
                            <span
                              key={tool}
                              className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-white/70"
                            >
                              {tool}
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 16 16"
                                fill="none"
                                stroke="#4ade80"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M3 8.5l3.5 3.5L13 5" />
                              </svg>
                            </span>
                          )
                        )}
                      </div>
                      <div className="rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/90">
                        Done — I found &ldquo;Q3 Planning&rdquo; in your Drive
                        and added a five-bullet summary of the kickoff under
                        Notes. Want me to email the team a link?
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 border-t border-white/10 p-3">
                  <span className="flex-1 rounded-full border border-white/20 px-3 py-2 text-xs text-white/50">
                    Ask about your inbox, calendar, or docs&hellip;
                  </span>
                  <span className="shrink-0 rounded-[var(--radius)] bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors group-hover:bg-primary/90">
                    Send
                  </span>
                </div>
              </div>
            </Link>
          </div>
          </div>
        </ShaderBackground>

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
                Three ways to connect your data
              </h2>
              <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
                Whether you want to plug in yourself, use a pre-built connector,
                or need a custom integration, DataToRAG has you covered.
              </p>
            </div>

            <div
              className="animate-fade-in-up mt-12 grid gap-6 sm:grid-cols-3"
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
                href="/demo"
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
                href="/demo"
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
