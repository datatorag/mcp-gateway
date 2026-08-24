import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/navbar";

/* THE PHRASE-OWNING PAGE, added 2026-08-24.
   Asked to list hosted Google Workspace MCP servers, an assistant returned
   Google's official servers and four self-hosted GitHub projects and did not
   reach us until we were named. Nothing on the site matched the phrase outside
   one blog post, so there was nothing to find. Title, slug and h1 all carry it.

   IT ALSO ABSORBS THE "WRITE ACCESS" PAGE rather than shipping that separately.
   Two thin pages competing for adjacent queries is worse than one that answers
   both, and write access IS the differentiator, so it belongs in the middle of
   this page rather than off to the side. Split it out later only if the queries
   prove genuinely distinct.

   ACCURACY CONSTRAINTS, all verified 2026-08-24 against live tool surfaces and
   Google's published MCP reference. Re-check before editing any of them:
   - Google's official MCP servers WRITE, and deeply. Never claim otherwise.
   - Google's own Gmail MCP has no send, reply or forward.
   - Claude's native Gmail connector DOES send, reply and forward. It gained
     those verbs in August; two of our posts said otherwise and were wrong.
   - Claude's native Drive can CREATE files but its update_file changes title
     and parent only, never content. Keep every Drive row create-vs-change.
   - There is no official Tasks MCP.
   No tool counts on this page on purpose: lib/tool-count-claims.test.ts fails
   a bare count, and every exact figure we have published has drifted. */

const TITLE = "Hosted Google Workspace MCP - no Cloud project, no OAuth setup";
const DESCRIPTION =
  "A hosted MCP endpoint for Gmail, Sheets, Docs, Slides, Calendar, Contacts and Tasks. One URL, one sign-in, no Google Cloud project. Every write asks you first.";
const URL = "https://datatorag.com/hosted-google-workspace-mcp";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: {
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
    covers: "Gmail, Calendar, Drive. That is the whole Google surface.",
    gap: "No Sheets, Docs, Slides, Contacts or Tasks connector at all. One Google account at a time.",
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
      "Gmail, Drive, Sheets, Docs, Slides, Calendar, Contacts, Tasks, plus Jira and Confluence on the same endpoint.",
    gap: "We are a third party in the path. No Google Chat tools. Self-host if that trade is wrong for you.",
  },
];

const WRITES = [
  ["Read a spreadsheet", "Native: yes", "Us: yes"],
  ["Change a cell in it", "Native: no Sheets connector", "Us: yes"],
  ["Create a Google Doc", "Native: yes, via Drive", "Us: yes"],
  ["Write content into it", "Native: no", "Us: yes"],
  ["Create a presentation", "Native: yes, and it arrives empty", "Us: yes"],
  ["Put content on the slides", "Native: no", "Us: yes"],
  ["Send an email", "Native: yes, since August", "Us: yes"],
  ["Work across two Google accounts", "Native: no, one at a time", "Us: yes"],
];

export default function HostedGoogleWorkspaceMcpPage() {
  return (
    <>
      <Navbar />
      <main className="flex-1 bg-background">
        <div className="mx-auto max-w-4xl px-6 pb-20 pt-32 sm:pt-36">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">
            Hosted MCP
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold text-foreground sm:text-4xl">
            A hosted Google Workspace MCP, with write access
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Add one endpoint, sign in with Google, and your agent can edit the
            spreadsheet rather than describe it. No Google Cloud project, no
            OAuth client of your own, no per-product endpoints to wire up.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/auth/login"
              className="rounded-full bg-primary px-7 py-3 text-sm font-medium text-primary-foreground transition-all hover:opacity-90"
            >
              Connect a Google account
            </Link>
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
            · Open source, self-host it if you prefer
          </p>

          <h2 className="mt-16 font-display text-2xl font-bold text-foreground">
            Where the writes actually stop
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
              <span className="text-foreground">Calendars or file management are the whole job.</span>{" "}
              Claude&apos;s native connectors cover both better than we do, and
              they are free.
            </li>
            <li>
              <span className="text-foreground">You need Google Chat.</span> Google
              has an official Chat MCP. We have no Chat tools.
            </li>
            <li>
              <span className="text-foreground">
                A third party in the path is disqualifying.
              </span>{" "}
              That is a real answer, and self-hosting this gateway is the version
              of us that respects it.
            </li>
          </ul>

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
