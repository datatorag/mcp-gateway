import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { ContactForm } from "./contact-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Request a Demo | DataToRAG",
  description:
    "See how DataToRAG connects Google Workspace, Atlassian, and your other data sources to Claude. Get a walkthrough tailored to your team.",
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
            Request a demo
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            See DataToRAG running against
            <br />
            your own data.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            Tell us about your team and what you&apos;d like Claude to reach. We&apos;ll
            set up a 30-minute walkthrough against a workspace that mirrors your
            setup — Google Workspace, Atlassian, or a custom connector.
          </p>

          <ul className="mt-8 space-y-4 text-sm text-muted-foreground">
            <li className="flex gap-3">
              <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              Tailored to your stack — we map the demo to the tools your team
              already uses.
            </li>
            <li className="flex gap-3">
              <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              Real prompts, real answers — bring the questions you wish your
              assistant could already handle.
            </li>
            <li className="flex gap-3">
              <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              No commitment. Self-serve and paid tiers both available after.
            </li>
          </ul>

          <p className="mt-10 text-xs text-muted-foreground">
            Already on a self-serve plan?{" "}
            <a
              href="mailto:support@datatorag.com"
              className="underline hover:text-foreground"
            >
              support@datatorag.com
            </a>{" "}
            reaches the team directly.
          </p>
        </div>

        <div>
          <ContactForm utm={utm} />
        </div>
      </main>
    </>
  );
}
