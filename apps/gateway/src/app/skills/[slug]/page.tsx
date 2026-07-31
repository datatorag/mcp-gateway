import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, CircleCheckIcon } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { CopySkill } from "@/components/copy-skill";
import {
  connectorsFor,
  getAllSkills,
  getRelatedSkills,
  getSkillBySlug,
} from "@/lib/skills";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getAllSkills().map((skill) => ({ slug: skill.slug }));
}

/** Own metadata per page, query-shaped — never the root default. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const skill = getSkillBySlug(slug);
  if (!skill) return {};

  const title = `${skill.title} | DataToRAG`;
  const description = `${skill.situation} ${skill.produces}`;
  const url = `https://datatorag.com/skills/${slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, type: "article", url },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SkillPage({ params }: Props) {
  const { slug } = await params;
  const skill = getSkillBySlug(slug);
  if (!skill) notFound();

  const related = getRelatedSkills(slug);
  const connectors = connectorsFor(skill.tools);

  return (
    <>
      <Navbar />
      <main className="flex-1 bg-background">
        <article className="mx-auto max-w-3xl px-6 py-20">
          <Link
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            href="/skills"
          >
            <ArrowLeftIcon aria-hidden="true" className="size-4" />
            Skills
          </Link>

          <h1 className="mt-6 font-display text-3xl font-bold leading-tight text-foreground sm:text-4xl">
            {skill.title}
          </h1>

          {/* Situation first: the reader should recognise their own problem
              before reading anything about tools. */}
          <p className="mt-5 font-display text-lg font-medium leading-relaxed text-muted-foreground">
            &ldquo;{skill.situation}&rdquo;
          </p>
          <p className="mt-4 flex items-start gap-2.5 text-base leading-relaxed text-foreground">
            <CircleCheckIcon
              aria-hidden="true"
              className="mt-1 size-5 shrink-0 text-primary"
            />
            <span>{skill.produces}</span>
          </p>

          <div className="mt-8 grid gap-4 rounded-2xl border border-border bg-secondary/40 p-5 sm:grid-cols-2">
            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tools it uses
              </h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {skill.tools.map((tool) => (
                  <span
                    className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground/80"
                    key={tool}
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                What it needs
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>{connectors.join(" and ")} connected</li>
                <li>
                  {skill.accounts === "multiple"
                    ? "Works across several connected accounts"
                    : "Works with one connected account"}
                </li>
                <li>The gateway URL in your Claude client</li>
              </ul>
            </div>
          </div>

          <div
            className="prose mt-10"
            dangerouslySetInnerHTML={{ __html: skill.introHtml }}
          />

          <div className="mt-8">
            <CopySkill source={skill.skillSource} />
            <p className="mt-3 text-xs text-muted-foreground">
              Paste this into your Claude client as a skill, then ask for it by
              name. It calls your connected accounts through the gateway, and
              every write asks you first.
            </p>
          </div>

          <div
            className="prose mt-10"
            dangerouslySetInnerHTML={{ __html: skill.notesHtml }}
          />

          {/* Signup is the CTA, never a wall — everything above reads
              signed-out. */}
          <div className="mt-12 rounded-2xl border border-border bg-secondary/40 p-6 text-center">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Run it against your own data
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Connect Google Workspace, paste the gateway URL into Claude, and
              this skill works on your accounts.
            </p>
            <Link
              className="mt-5 inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              href="/auth/login"
            >
              Get the gateway
            </Link>
          </div>

          {related.length > 0 && (
            <div className="mt-14 border-t border-border pt-8">
              <h2 className="font-display text-base font-semibold text-foreground">
                Other skills
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {related.map((r) => (
                  <Link
                    className="rounded-xl border border-border p-4 transition-colors hover:border-foreground/20 hover:bg-secondary/50"
                    href={`/skills/${r.slug}`}
                    key={r.slug}
                  >
                    <p className="text-sm font-medium leading-snug text-foreground">
                      {r.title}
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {r.produces}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </article>
      </main>
    </>
  );
}
