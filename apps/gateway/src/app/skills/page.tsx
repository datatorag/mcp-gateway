import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { SkillCard } from "@/components/skill-card";
import { getAllSkills } from "@/lib/skills";

const TITLE = "Skills for Claude and Google Workspace | DataToRAG";
const DESCRIPTION =
  "Working agent skills you can copy into Claude: triage your inbox, see your week across every calendar, keep a knowledge base in Google Sheets. Each one is the real file we run, not a description of one.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://datatorag.com/skills" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    url: "https://datatorag.com/skills",
  },
};

export default function SkillsIndexPage() {
  const skills = getAllSkills();

  return (
    <>
      <Navbar />
      <main className="flex-1 bg-background">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              Skills
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold text-foreground sm:text-4xl">
              Copy a skill into Claude and it works
            </h1>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Each one is the actual file, not a description of what is
              possible. Paste it into Claude, connect your account, and it runs
              against your own data through the gateway.
            </p>
          </div>

          {/* Browsable by situation: people arrive with "my inbox is a mess",
              not with "I would like to use gmail_search". */}
          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {skills.map((skill) => (
              <SkillCard key={skill.slug} skill={skill} />
            ))}
          </div>

          <div className="mt-12 rounded-2xl border border-border p-6">
            <h2 className="font-display text-base font-semibold text-foreground">
              What you need to run one
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              A DataToRAG account with Google Workspace connected, and the
              gateway URL in your Claude client. The skills are readable
              without any of that, so read first and connect when one is worth
              running.{" "}
              <Link
                className="font-medium text-primary hover:underline"
                href="/docs/getting-started"
              >
                Getting started
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
