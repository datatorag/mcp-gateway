import type { Metadata } from "next";
import { db } from "@/lib/db";
import { publicToolCount } from "@/lib/public-tools";
import { Navbar } from "@/components/navbar";
import { ShaderBackground } from "@/components/shader-background";
import { IntegrationCatalog } from "@/components/integration-catalog";
import { CircleCheckIcon, CircleMinusIcon } from "lucide-react";
import { CasaBadge } from "@/components/casa-badge";
import { ConnectorComparison, heroGroups } from "@/components/connector-comparison";
import { StartupBarOffset } from "@/components/startupbar-offset";
import { DemoBento } from "@/components/demo/demo-bento";
import { DEMO_HEADING, DEMO_STANDFIRST } from "@/components/demo/demo-copy";
import { ComparisonHero } from "@/components/comparison-hero";
import { SLIDES_VERIFIED_ON, VERIFIED_ON } from "@/lib/connector-verification";
import { SkillCard } from "@/components/skill-card";
import { getAllSkills } from "@/lib/skills";
import { getAllPersonas } from "@/lib/personas";
import { getSessionUserId } from "@/lib/session";
import Link from "next/link";
import Script from "next/script";
import { FaqSection } from "@/components/faq-section";
import { JsonLd } from "@/components/json-ld";
import { faqPageNode } from "@/lib/site-schema";
import { siteFaqGroups, siteFaqs } from "@/lib/site-faq";
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "@/lib/social-card";
import { signInHref } from "@/lib/sign-in";

/** Read once at module scope: the answers are static, the page is not. */
const homeFaqs = siteFaqs("/");

export const dynamic = "force-dynamic";

/* LEADS WITH THE SEARCH TERM ON PURPOSE, changed 2026-08-24. The previous
   title, "Let Claude edit your Google Sheets - DataToRAG", is a better
   sentence and it cost us the category: asked to list hosted Google Workspace
   MCP servers, an assistant returned Google's official servers and four
   self-hosted GitHub projects and did not reach us until we were named. Not an
   ad-placement problem and not a ranking problem — nothing on the front door
   matched the phrase at all. "MCP", "hosted" and "Google Workspace MCP" appear
   in no title on the site outside one blog post.

   THE H1 IS DELIBERATELY UNCHANGED. A title is read by a search engine and by
   a model; an h1 is read by a person who already arrived. They do not have to
   be the same string, and trading a line that converts for a line that gets
   found would be the wrong half of the trade. 57 characters, inside the ~60
   search results truncate at. */
const HOME_TITLE =
  "Hosted Google Workspace MCP with write access - DataToRAG";
/* Makes no quantity claim at all, which is why it cannot go stale. This string
   is static metadata, so unlike the body below it cannot read the live number,
   and every exact count we hard-coded drifted as the registry moved.
   `lib/tool-count-claims.test.ts` fails if a bare count comes back here.

   It is also the one piece of copy with a hard length budget: search results
   truncate around 160 characters, and this is 148. An earlier version listed
   services to avoid naming a number, which was the right instinct in the wrong
   string — the list ran to 226 and cut off "every write asks you first", the
   differentiator the rest of the sentence exists to set up. Keep additions
   inside the budget, and check what falls off the end rather than what reads
   well in the file. */
const HOME_DESCRIPTION =
  "Claude's Drive connector reads your files. DataToRAG edits them in place, appends rows, sends email and updates tickets. Every write asks you first.";

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
    ...SOCIAL_OPEN_GRAPH,
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    type: "website",
    url: "https://datatorag.com",
  },
  twitter: {
    ...SOCIAL_TWITTER,
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
};

export default async function HomePage() {
  const [totalTools, userId] = await Promise.all([
    publicToolCount(db),
    getSessionUserId(),
  ]);
  const signedIn = userId !== null;
  const playgroundHref = signedIn ? "/dashboard" : signInHref();
  // Authored order, first three. Adding a skill file does not silently change
  // the home page beyond that, and /skills stays the complete list.
  const featuredSkills = (await getAllSkills()).slice(0, 3);
  // Same set as /skills/for/*, three of them for the grid. A subset, never
  // a card that exists only here.
  const homePersonas = getAllPersonas().slice(0, 3);
  const demoPromptLabel = signedIn
    ? "Open the Agent to run your own prompt"
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
        {/* First structured data on this page. An array, so SCRUM-205's
            Organization and WebSite nodes append here rather than adding a
            second script element. */}
        <JsonLd nodes={homeFaqs.length > 0 ? [faqPageNode(homeFaqs)] : []} />

        {/* Hero */}
        <ShaderBackground>
          {/* One viewport-height column, centered as a group: extra vertical
              space goes above the hero and below the teaser — never between
              them. The hero→teaser gap is the teaser's fixed pt. */}
          <div className="relative flex min-h-[calc(100vh-4rem)] flex-col justify-center pb-12 pt-24">
          {/* One grid, so the reading order can differ by width without a
              second copy of anything (SCRUM-426). The DOM order is the phone
              order: headline, the comparison table, the sentence, the
              buttons, the trust lines. A phone shows the table near the top
              instead of under five lines of copy.

              From `lg` the table moves to a 520px right column spanning every
              row, and the text sits in the middle three of five rows
              (`1fr auto auto auto 1fr`), so the extra height of the taller
              table goes above and below the text as a group, never between
              the headline and its sentence. The column widths are the ones
              the headline was measured against below: the page padding (48),
              the gap (64) and 520.

              `pt-12` is the room the pill above the headline used to take:
              without it, the headline's first line sat under the fixed navbar
              on a phone and the table touched it on a desktop. */}
          <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center px-6 pt-12 text-center lg:grid-cols-[minmax(0,1fr)_520px] lg:grid-rows-[1fr_auto_auto_auto_1fr] lg:gap-x-16 lg:text-left">
              {/* "Claude moves the work" is kept on one line only where the
                  column has room for it, and allowed to wrap everywhere else.
                  Measured in Chrome (SCRUM-425, SCRUM-426): the phrase is
                  434px wide at 36px, 579 at 48px and 724 at 60px.

                  - Below `sm` the column is the viewport less 48px, 342 at 390.
                    Kept whole, the phrase clipped the headline at both edges
                    on every phone, because <main> is `overflow-x-hidden`.
                  - From `sm` to `lg` the page is one column (592 at 640, 720
                    at 768), so the 48px phrase fits.
                  - From `lg` the column is the viewport less the page padding
                    (48), the gap (64) and the hero table (520): 392 at 1024,
                    and never more than 648, because the container stops at
                    1280. The 60px phrase needs 724, so it wraps at every
                    desktop width. Kept whole, it pushed the column wide and
                    the table off the right edge.

                  Re-measure if the headline, the face, the gap or the hero
                  table's width changes. */}
              <h1
                className="animate-fade-in-up font-display text-3xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl lg:col-start-1 lg:row-start-2 lg:max-[1119px]:text-4xl xl:text-6xl"
                style={{ animationDelay: "0.06s" }}
              >
                One connection to{" "}
                {/* "Google Workspace" stays together from 360px up, so
                    "Google" is never alone on a line. Measured, the pair is
                    about 300px at 30px, 347 at 36, 463 at 48 and 579 at 60,
                    and each size is chosen so it fits its column: 30 on a
                    phone, 48 from `sm`, 36 from `lg` to 1119 (a 392 to 487px
                    column), 48 from 1120 and 60 from `xl` (a 648px column).
                    Below 360 the column is under 300, so it may break there
                    rather than run off the edge. */}
                <span className="min-[360px]:whitespace-nowrap">Google Workspace</span>{" "}
                and more.{" "}
                {/* From `sm` the second sentence starts its own line; on a
                    phone it flows on from the first, which keeps the
                    headline a line shorter and the table higher. */}
                <span className="text-blue-200 sm:block">
                  <span className="sm:max-lg:whitespace-nowrap">Claude moves the work</span>{" "}
                  <span className="sm:max-lg:whitespace-nowrap">between them.</span>
                </span>
              </h1>

            {/* The comparison is the hero shot (SCRUM-425): all nine gaps at
                once (SCRUM-426), `max-w-md` stacked, 520px from `lg` up. The
                headline's wrapping above is measured against this width. Its
                rows come from the full table at #comparison and nowhere else;
                see heroGroups(). */}
            <div
              className="animate-fade-in-up mx-auto mt-6 w-full max-w-md lg:col-start-2 lg:row-span-5 lg:row-start-1 lg:mt-0 lg:w-[520px] lg:max-w-[520px]"
              style={{ animationDelay: "0.1s" }}
            >
              <ComparisonHero
                groups={heroGroups()}
                verifiedOn={VERIFIED_ON}
                slidesVerifiedOn={SLIDES_VERIFIED_ON}
              />
            </div>

            <p
              className="animate-fade-in-up mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg lg:col-start-1 lg:row-start-3 lg:mx-0"
              style={{ animationDelay: "0.12s" }}
            >
              {/* Fallback is rounded, not an exact number: it only renders
                  when the count query failed, and stating a precise figure we
                  did not just read is how a wrong one ships. Matches the
                  pricing page and the lead page. */}
              {totalTools > 0 ? totalTools : "70+"} tools across Google
              Workspace, Atlassian and Notion behind one URL, in Claude, Claude
              Code, Cursor or your own app.
            </p>

            <div
              className="animate-fade-in-up mt-6 lg:col-start-1 lg:row-start-4"
              style={{ animationDelay: "0.18s" }}
            >
              <div className="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                <a
                  href={signInHref()}
                  className="rounded-full bg-white px-7 py-3 text-sm font-medium text-[#1a3a8f] transition-all hover:bg-white/90"
                >
                  Get Started
                </a>
                <Link
                  href="/contact"
                  className="rounded-full border border-white/30 px-7 py-3 text-sm font-medium text-white transition-all hover:border-white/50 hover:bg-white/10"
                >
                  Talk to Us
                </Link>
              </div>

              {/* THE TRUST SIGNAL BELONGS NEXT TO THE ASK, added 2026-08-24.
                  It already existed on this page, ~760 lines further down, in
                  a footer link nobody scrolls to. The obvious objection to a
                  hosted gateway is "I am giving a third party access to my
                  Gmail", and the answer to it was filed below the fold while
                  the question was being asked at the button. Same fact, moved
                  to where it is load-bearing. Deliberately plain text plus one
                  link rather than a badge graphic: a self-drawn badge reads as
                  decoration, the sentence reads as a claim we will be held to. */}
              <p className="mt-4 text-[11px] text-white/50">
                Google-verified since June 2026 ·{" "}
                <Link
                  href="/blog/casa-tier-2-verified"
                  className="underline decoration-white/30 underline-offset-2 hover:text-white/80"
                >
                  CASA Tier 2 assessed
                </Link>{" "}
                · Open source, self-host it if you prefer
              </p>
              {/* No sign-in agreement line here (SCRUM-426, Manuel). Get
                  Started goes straight to Google, and the agreement is shown
                  on the first screen after sign-in, where a new account
                  lands; see playground.tsx. */}

              {/* Badge lockup, not fine print. Compact here, so it does not
                  compete with the table beside it. */}
              <CasaBadge
                className="mt-4 justify-center lg:justify-start"
                compact
                tone="dark"
              />
            </div>
          </div>

          </div>
        </ShaderBackground>

        {/* Scripted demo — its own band: the product working, not more hero.
            The grid, its copy and the sample-data disclosure live in
            DemoBento, shared with the lead page. What stays here is the CTA
            policy: the home page wants every route into the Agent it can get,
            which is the opposite of what a lead page wants.

            THE ANCHOR ID STAYS `playground` DELIBERATELY. Renaming it would
            break every inbound /#playground link with no way to fix them: a
            fragment never reaches the server, so there is nothing to redirect
            and the failure is silent, just a page that stops scrolling where
            it used to. Retiring the term is about the words a user READS; an
            id is plumbing. If it ever matters, the move is a new id plus an
            empty legacy anchor, not a rename. */}
        <section id="playground" className="scroll-mt-28 bg-background">
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
            {/* One closing call to action, not two: this replaced a plain
                "run it for real" link, and the rows already carry their own
                composer-shaped affordance, so the section closes once. The
                CTA itself lives in DemoBento so the lead page renders the
                identical thing. */}
            <DemoBento
              ctaHref={playgroundHref}
              heading={DEMO_HEADING}
              promptHref={playgroundHref}
              promptLabel={demoPromptLabel}
              standfirst={DEMO_STANDFIRST}
            />
          </div>
        </section>

        {/* Skills — the demo above shows the work being done; this is where a
            reader who now wants to do it themselves picks something up. Led by
            each skill's own `situation` line, so the section is browsable by
            problem rather than by feature. Sliced to three: the index carries
            the rest, and a fourth card would leave the grid ragged. */}
        {featuredSkills.length > 0 && (
          <section
            id="skills"
            className="scroll-mt-28 border-t border-border bg-background"
          >
            <div className="mx-auto max-w-6xl px-6 py-20">
              <div className="animate-fade-in-up max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-widest text-primary">
                  Skills
                </p>
                <h2 className="mt-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
                  Start with a skill, not a blank prompt.
                </h2>
                <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                  Each one is a file you paste into Claude. It runs against your
                  own accounts through the gateway.
                </p>
              </div>

              <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {featuredSkills.map((skill) => (
                  <SkillCard key={skill.slug} skill={skill} />
                ))}
              </div>

              <div className="mt-10">
                <Link
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  href="/skills"
                >
                  See all skills
                  <span aria-hidden="true">&rarr;</span>
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* Full comparison. Sits here on purpose: the hero makes a short claim
            with five rows, the playground above shows it working, and this is
            where someone who wants to check the claim goes. Rows and their
            constraints live in the component. */}
        <section id="comparison" className="scroll-mt-28 bg-background">
          <ConnectorComparison />
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
                  desc: "One connection for Google Workspace, Jira and Confluence. We handle the auth and schema mapping.",
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
                  desc: "We deploy and host cost-saving custom models on our secure infrastructure without sacrificing quality. Wire directly into the gateway, so your data and inference never go to Claude or OpenAI.",
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
              Every integration works from one endpoint. Connect once, use
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
                prompt, or target a specific account when you need to.
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
                tools are tuned for token efficiency, so the same Gmail thread
                read costs a fraction of the tokens, which means longer
                conversations and smarter agents.
              </p>
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
                  Inference runs on our secure infrastructure. Nothing is
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
                  We handle deployment and ops for the model of your choice:
                  GLM, Gemma, DeepSeek, Qwen, and other families. Connect it to
                  your MCP gateway.
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

            {/* Read from the personas collection, not a second hardcoded
                copy — the /skills/for/* pages are the same set, so the site
                sorts every reader by one taxonomy. Three here, all of them
                there; a card that exists only on this page would put the two
                taxonomies back. */}
            <div
              className="animate-fade-in-up mt-12 grid gap-6 sm:grid-cols-3"
              style={{ animationDelay: "0.1s" }}
            >
              {homePersonas.map((persona) => (
                <Link
                  key={persona.slug}
                  href={`/skills/for/${persona.slug}`}
                  className="group flex flex-col rounded-2xl border border-border bg-background p-6 transition-colors hover:border-foreground/20"
                >
                  <h3 className="font-display text-base font-semibold text-foreground">
                    {persona.title}
                  </h3>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                    &ldquo;{persona.situation}&rdquo;
                  </p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                    See the skills
                    <span
                      aria-hidden="true"
                      className="transition-transform group-hover:translate-x-0.5"
                    >
                      &rarr;
                    </span>
                  </span>
                </Link>
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

        {/* FAQ. Last thing before the ask, because these are the questions
            that stand between reading the page and clicking the button, and
            the answers are the page's own claims rather than new ones. The
            block, its anchors and its JSON-LD are the shared ones every other
            surface uses; the answers live in lib/site-faq.ts keyed by route,
            where one guard can walk them. */}
        <section className="mx-auto max-w-6xl px-6 pb-20">
          <div className="animate-fade-in-up mx-auto max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              FAQ
            </p>
            {siteFaqGroups("/").map((group) => (
              <FaqSection
                key={group.title}
                title={group.title}
                faqs={group.faqs}
                variant="section"
                className="mt-3"
              />
            ))}
            <p className="mt-8 text-sm text-muted-foreground">
              More of them on the{" "}
              <Link href="/faq" className="underline hover:text-foreground">
                FAQ page
              </Link>
              .
            </p>
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
              <a
                href={signInHref()}
                className="rounded-[var(--radius)] bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90"
              >
                Start Free
              </a>
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
          <a href="/skills" className="underline hover:text-foreground">Skills</a>
          {" "}&middot;{" "}
          <a href="/faq" className="underline hover:text-foreground">FAQ</a>
          {" "}&middot;{" "}
          <a href="/privacy" className="underline hover:text-foreground">Privacy Policy</a>
          {" "}&middot;{" "}
          <a href="/terms" className="underline hover:text-foreground">Terms of Service</a>
          {" "}&middot;{" "}
          <a href="/changelog" className="underline hover:text-foreground">Changelog</a>
          {" "}&middot;{" "}
          <a href="/status" className="underline hover:text-foreground">Status</a>
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
