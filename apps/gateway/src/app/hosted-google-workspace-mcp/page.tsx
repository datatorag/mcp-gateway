import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { FaqSection } from "@/components/faq-section";
import { JsonLd } from "@/components/json-ld";
import { faqPageNode } from "@/lib/site-schema";
import {
  BUILT_IN_CHECKED_ON,
  BUILT_IN_DIFFERENCE,
  BUILT_IN_HELP_URL,
  FILE_MOVES,
  SELF_HOSTING,
  siteFaqGroups,
  siteFaqs,
} from "@/lib/site-faq";
import { GithubMark, REPOSITORY_URL } from "@/components/github-mark";
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "@/lib/social-card";
import { signInHref } from "@/lib/sign-in";
import { AddToAgent } from "@/components/add-to-agent";

/** Answers live in lib/site-faq.ts keyed by route, under the same guard as
 * every other FAQ surface. They restate THIS page's claims and carry this
 * page's date: the accuracy constraints in the comment above apply to them
 * unchanged, and an answer is the copy most likely to be read without the
 * table beside it. */
const faqs = siteFaqs("/hosted-google-workspace-mcp");

/* THE PHRASE-OWNING PAGE, added 2026-08-24.
   Asked to list hosted Google Workspace MCP servers, an assistant returned
   Google's official servers and four self-hosted GitHub projects and did not
   reach us until we were named. Nothing on the site matched the phrase outside
   one blog post, so there was nothing to find. Title, slug and h1 all carry it.

   2026-11-25: THE H1 AND THE FIRST H2 NO LONGER SAY "WRITE ACCESS". The table
   under that h2 now shows the built-in connectors writing to Docs, Sheets, and
   Slides, so writing sets nothing apart here. The h1 says two things about
   DataToRAG alone (several accounts, any MCP client), the description says the
   same, and the section gained a block on moving files (FILE_MOVES in
   lib/site-faq.ts). The files clause is in the SECOND paragraph on purpose:
   the first is the answer to "what is the difference from the built-in
   connectors", and moving a file is not offered here as a difference.

   IT ALSO ABSORBS THE "WRITE ACCESS" PAGE rather than shipping that separately.
   Two thin pages competing for adjacent queries is worse than one that answers
   both, and write access IS the differentiator, so it belongs in the middle of
   this page rather than off to the side. Split it out later only if the queries
   prove genuinely distinct.

   ACCURACY CONSTRAINTS, all verified 2026-08-24 against live tool surfaces and
   Google's published MCP reference. Re-check before editing any of them:
   - Google's official MCP servers WRITE, and deeply. Never claim otherwise.
   - Google's own Gmail MCP has no send, reply or forward.
   - There is no official Tasks MCP.
   (Two bullets about Claude's native connectors stood here until 2026-11-25.
   One said its Drive connector never changes a file's content, which
   Anthropic's help page no longer supports. What this page may say about the
   native connectors is the next paragraph, not a list kept in a comment.)

   2026-11-25: THE NATIVE COLUMN AND THE NATIVE ROUTE WERE REWRITTEN from
   Anthropic's own help page (BUILT_IN_HELP_URL in lib/site-faq.ts), which that
   day listed separate Docs, Sheets, and Slides connectors that create and edit
   files. "No Sheets connector", "the whole Google surface", and the two Docs
   and Slides "no" cells were false against it and are gone. A native cell now
   says only what that page says. It does not say how many Google accounts can
   be connected and does not mention Contacts or Tasks, so this page no longer
   states a native limit on either. The "use something else when" item and two
   FAQ answers followed the same day: "cover both better than we do, and they
   are free" and "in beta" were ours, not the page's. The page and the date
   are lib/connector-verification.ts. Google's own servers were NOT re-checked
   that day; their row still rests on the 2026-08-24 check.
   No tool counts on this page on purpose: lib/tool-count-claims.test.ts fails
   a bare count, and every exact figure we have published has drifted. */

const TITLE = "Hosted Google Workspace MCP - no Cloud project, no OAuth setup";
const DESCRIPTION =
  "A hosted MCP endpoint for Gmail, Drive, Sheets, Docs, Slides, Calendar, Contacts, and Tasks, on several Google accounts, from any MCP client. One sign-in.";
const URL = "https://datatorag.com/hosted-google-workspace-mcp";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL },
  twitter: SOCIAL_TWITTER,
  openGraph: {
    ...SOCIAL_OPEN_GRAPH,
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    url: URL,
  },
};

const ROUTES = [
  {
    name: "Claude's native connectors",
    setup: "None",
    covers: `Gmail, Calendar, and Drive, plus separate Docs, Sheets, and Slides connectors that create and edit files (Anthropic's help page, ${BUILT_IN_CHECKED_ON}).`,
    gap: "Available on Claude and Claude Desktop. The limits its help page lists include no charts in Slides.",
  },
  {
    name: "Google's official MCP servers",
    setup: "A Cloud project, sixteen service enablements, your own OAuth client",
    covers:
      "Eight products, and they write deeply. Sheets, Docs and Slides all take batch updates.",
    gap: "Developer Preview. Eight separate endpoints to configure. Their own Gmail server cannot send, reply or forward.",
  },
  {
    name: "This gateway",
    setup: "One URL, one Google sign-in",
    covers:
      "Gmail, Drive, Sheets, Docs, Slides, Calendar, Contacts, Tasks, plus Jira, Confluence and Notion on the same endpoint.",
    gap: "We are a third party in the path. No Google Chat tools. The code is MIT-licensed if you would rather run it yourself, and the README's self-hosting section lists the steps.",
  },
];

const WRITES = [
  ["Read a spreadsheet", "Native: yes", "Us: yes"],
  ["Change a cell in it", "Native: yes, with the Sheets connector", "Us: yes"],
  ["Create a Google Doc", "Native: yes", "Us: yes"],
  ["Write content into it", "Native: yes, with the Docs connector", "Us: yes"],
  ["Create a presentation", "Native: yes", "Us: yes"],
  ["Put content on the slides", "Native: yes, with the Slides connector", "Us: yes"],
  ["Send an email", "Native: yes", "Us: yes"],
  ["Work across two Google accounts", "Native: not covered on the help page", "Us: yes"],
];

export default function HostedGoogleWorkspaceMcpPage() {
  return (
    <>
      <Navbar />
      <main className="flex-1 bg-background">
        <JsonLd nodes={faqs.length > 0 ? [faqPageNode(faqs)] : []} />
        <div className="mx-auto max-w-4xl px-6 pb-20 pt-32 sm:pt-36">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">
            Hosted MCP
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold text-foreground sm:text-4xl">
            A hosted Google Workspace MCP for several accounts, in any MCP client
          </h1>
          {/* The answer to "what is the difference from Claude's built-in
              Google connectors", in the first hundred words of the page. The
              sentences are lib/site-faq.ts's, shared with the FAQ answer, and
              the rules for the vendor half are in the comment there. */}
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-foreground">
            {BUILT_IN_DIFFERENCE.ours} {BUILT_IN_DIFFERENCE.theirsLead}
            <a
              href={BUILT_IN_HELP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {BUILT_IN_DIFFERENCE.theirsSource}
            </a>
            {BUILT_IN_DIFFERENCE.theirsRest} {BUILT_IN_DIFFERENCE.close}
          </p>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Add one endpoint, sign in with Google, and your agent can edit the
            spreadsheet rather than describe it, and move a file from an
            email, from Drive, or from your computer to where you need it. No
            Google Cloud project, no
            OAuth client of your own, no per-product endpoints to wire up.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={signInHref()}
              className="rounded-full bg-primary px-7 py-3 text-sm font-medium text-primary-foreground transition-all hover:opacity-90"
            >
              Connect a Google account
            </a>
            <Link
              href="/docs/getting-started"
              className="rounded-full border border-border px-7 py-3 text-sm font-medium text-foreground transition-all hover:bg-muted"
            >
              Read the setup
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Google-verified since June 2026 ·{" "}
            <Link href="/blog/casa-tier-2-verified" className="underline underline-offset-2">
              CASA Tier 2 assessed
            </Link>{" "}
            ·{" "}
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-80"
            >
              Open source
              <GithubMark size={13} className="-mt-0.5 ml-1.5 inline" />
              <span className="sr-only"> on GitHub</span>
            </a>
          </p>

          {/* SCRUM-503: the client step, for a visitor who arrives with an
              agent in hand. */}
          <AddToAgent placement="landing" className="mt-10" />

          <h2 className="mt-16 font-display text-2xl font-bold text-foreground">
            Who writes what, and what this endpoint adds
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Most comparisons argue about tool counts. The question that decides
            it is narrower: when your agent finishes thinking, can it put the
            answer somewhere.
          </p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <tbody>
                {WRITES.map(([job, native, us]) => (
                  <tr key={job} className="border-b border-border">
                    <td className="py-3 pr-4 font-medium text-foreground">{job}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{native}</td>
                    <td className="py-3 text-foreground">{us}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            The native column is what Anthropic&apos;s help page says as of{" "}
            {BUILT_IN_CHECKED_ON}. The built-in connectors write to Docs, Sheets,
            and Slides now. What this gateway adds sits mostly outside the
            table: several Google accounts in one request, Contacts and Tasks,
            and Jira, Confluence, and Notion on the same endpoint.
          </p>

          {/* Moving files, in this page's own type. The copy is the home
              page's, from lib/site-faq.ts, and names no other product. */}
          <h3 className="mt-10 font-display text-lg font-semibold text-foreground">
            {FILE_MOVES.heading}
          </h3>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {FILE_MOVES.standfirst}
          </p>
          <ul className="mt-4 max-w-2xl space-y-2 text-sm leading-relaxed text-muted-foreground">
            {FILE_MOVES.jobs.map((job) => (
              <li key={job.id}>
                <span className="font-medium text-foreground">{job.title}.</span>{" "}
                {job.body}
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {FILE_MOVES.receipt} {FILE_MOVES.limits}{" "}
            <Link href={FILE_MOVES.docsHref} className="underline underline-offset-2">
              {FILE_MOVES.docsLabel}
            </Link>
            .
          </p>

          <h2 className="mt-16 font-display text-2xl font-bold text-foreground">
            The three routes, and when each one wins
          </h2>
          <div className="mt-6 space-y-6">
            {ROUTES.map((r) => (
              <div key={r.name} className="rounded-lg border border-border p-5">
                <h3 className="font-display text-lg font-semibold text-foreground">
                  {r.name}
                </h3>
                <dl className="mt-3 space-y-2 text-sm">
                  <div>
                    <dt className="inline font-medium text-foreground">Setup: </dt>
                    <dd className="inline text-muted-foreground">{r.setup}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-foreground">Covers: </dt>
                    <dd className="inline text-muted-foreground">{r.covers}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-foreground">Where it stops: </dt>
                    <dd className="inline text-muted-foreground">{r.gap}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>

          <h2 className="mt-16 font-display text-2xl font-bold text-foreground">
            Use something else when
          </h2>
          <ul className="mt-4 max-w-2xl list-disc space-y-2 pl-5 text-base leading-relaxed text-muted-foreground">
            <li>
              <span className="text-foreground">Your work stays in Google and in Claude.</span>{" "}
              As of {BUILT_IN_CHECKED_ON}, Anthropic&apos;s help page says
              Claude&apos;s Gmail, Google Calendar, and Google Drive connectors
              are available for all users on Claude and Claude Desktop, and
              that Claude creates and edits Docs, Sheets, and Slides files.
              They may be all you need.
            </li>
            <li>
              <span className="text-foreground">You need Google Chat.</span> Google
              has an official Chat MCP. We have no Chat tools.
            </li>
            <li>
              <span className="text-foreground">
                A third party in the path is disqualifying.
              </span>{" "}
              That is a real answer. {SELF_HOSTING}
            </li>
          </ul>

          {siteFaqGroups("/hosted-google-workspace-mcp").map((group) => (
            <FaqSection
              key={group.title}
              title={group.title}
              faqs={group.faqs}
              variant="section"
              className="mt-16"
            />
          ))}

          <p className="mt-12 text-base leading-relaxed text-muted-foreground">
            The long version, with every tool enumerated and dated, is in{" "}
            <Link
              href="/blog/hosted-google-workspace-mcp"
              className="underline underline-offset-2"
            >
              the three-way comparison
            </Link>
            .
          </p>
        </div>
      </main>
    </>
  );
}
