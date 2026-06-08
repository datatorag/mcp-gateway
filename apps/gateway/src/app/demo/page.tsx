import type { Metadata } from "next";
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
      <main className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">
            Get in touch
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            What are you trying
            <br />
            to build with AI?
          </h1>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            We&apos;re building DataToRAG for teams that want their assistants to
            actually do things with their data. Read inboxes, update sheets, draft
            docs against the real source. If that&apos;s what you&apos;re after, tell
            us a bit about your setup and we&apos;ll reach out.
          </p>

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
        </div>
      </main>
    </>
  );
}
