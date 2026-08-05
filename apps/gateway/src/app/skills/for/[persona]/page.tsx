import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { SkillCard } from "@/components/skill-card";
import {
  getAllPersonas,
  getPersonaBySlug,
  skillsForPersona,
} from "@/lib/personas";

type Props = { params: Promise<{ persona: string }> };

export function generateStaticParams() {
  return getAllPersonas().map((persona) => ({ persona: persona.slug }));
}

/** Its own page, not an anchor on the index, so which audience actually
 * reads is a question pageviews can answer. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { persona: slug } = await params;
  const persona = getPersonaBySlug(slug);
  if (!persona) return {};

  const title = `${persona.metaTitle} | DataToRAG`;
  const url = `https://datatorag.com/skills/for/${slug}`;

  return {
    title,
    description: persona.situation,
    alternates: { canonical: url },
    openGraph: {
      title,
      description: persona.situation,
      type: "website",
      url,
    },
  };
}

export default async function PersonaPage({ params }: Props) {
  const { persona: slug } = await params;
  const persona = getPersonaBySlug(slug);
  if (!persona) notFound();

  const skills = skillsForPersona(persona);

  return (
    <>
      <Navbar />
      <main className="flex-1 bg-background">
        <div className="mx-auto max-w-5xl px-6 pb-16 pt-32 sm:pb-20 sm:pt-36">
          <Link
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            href="/skills"
          >
            <ArrowLeftIcon aria-hidden="true" className="size-4" />
            All skills
          </Link>

          <div className="mt-8 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              {persona.title}
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold leading-tight text-foreground sm:text-4xl">
              &ldquo;{persona.situation}&rdquo;
            </h1>
            <div
              className="prose mt-6"
              dangerouslySetInnerHTML={{ __html: persona.introHtml }}
            />
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {skills.map((skill) => (
              <SkillCard key={skill.slug} skill={skill} />
            ))}
          </div>

          {/* The flat list stays one click away: someone who knows what they
              want should never have to go through a persona. */}
          <div className="mt-12 rounded-2xl border border-border p-6">
            <h2 className="font-display text-base font-semibold text-foreground">
              Not quite you?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              These are the ones that fit this situation, not all of them.{" "}
              <Link
                className="font-medium text-primary hover:underline"
                href="/skills"
              >
                Browse every skill
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
