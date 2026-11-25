import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { AddToAgent } from "@/components/add-to-agent";
import { Navbar } from "@/components/navbar";
import { JsonLd } from "@/components/json-ld";
import { CopyPrompt } from "@/components/use-cases/copy-prompt";
import { UseCaseCard } from "@/components/use-cases/use-case-card";
import { UseCaseReplay } from "@/components/use-cases/use-case-replay";
import { UseCaseResultView } from "@/components/use-cases/use-case-result";
import { breadcrumbNode, howToNode } from "@/lib/site-schema";
import { getSkillBySlug } from "@/lib/skills";
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "@/lib/social-card";
import {
  USE_CASE_SERVICES,
  getAllUseCases,
  getUseCaseBySlug,
  relatedUseCases,
  shortTool,
  useCasePassage,
  useCaseSearchTitle,
} from "@/lib/use-cases";
import { formatContentDate } from "@/lib/utils";

type Props = { params: Promise<{ slug: string }> };

const BASE = "https://datatorag.com";

export function generateStaticParams() {
  return getAllUseCases().map((u) => ({ slug: u.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const useCase = getUseCaseBySlug(slug);
  if (!useCase) return {};
  const title = `${useCaseSearchTitle(useCase)} | DataToRAG`;
  const url = `${BASE}/use-cases/${slug}`;
  return {
    title,
    description: useCase.description,
    alternates: { canonical: url },
    openGraph: { ...SOCIAL_OPEN_GRAPH, title, description: useCase.description, type: "article", url },
    twitter: { ...SOCIAL_TWITTER, title, description: useCase.description },
  };
}

export default async function UseCasePage({ params }: Props) {
  const { slug } = await params;
  const useCase = getUseCaseBySlug(slug);
  if (!useCase) notFound();

  const url = `${BASE}/use-cases/${slug}`;
  const skill = useCase.skill ? await getSkillBySlug(useCase.skill) : null;
  const related = relatedUseCases(useCase);

  return (
    <>
      <Navbar />
      <main className="flex-1 bg-background">
        <JsonLd
          nodes={[
            breadcrumbNode([
              { name: "DataToRAG", url: BASE },
              { name: "Use cases", url: `${BASE}/use-cases` },
              { name: useCase.title, url },
            ]),
            howToNode({
              name: useCase.title,
              description: useCase.description,
              url,
              date: useCase.date,
              steps: useCase.steps.map((s) => ({ name: s.label, text: `${s.label} (${shortTool(s.tool)})` })),
            }),
          ]}
        />
        <article className="mx-auto max-w-3xl px-6 pb-16 pt-32 sm:pb-20 sm:pt-36">
          <Link href="/use-cases" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon aria-hidden="true" className="size-4" />
            Use cases
          </Link>

          <h1 className="mt-6 font-display text-3xl font-bold text-foreground sm:text-4xl">{useCase.title}</h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">{useCasePassage(useCase)}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Updated <time dateTime={useCase.date}>{formatContentDate(useCase.date)}</time>
          </p>

          <section aria-label="Replay" className="mt-8">
            <UseCaseReplay useCase={useCase} />
          </section>

          {/* The same content as plain text, for anyone who gets no animation. */}
          <section className="mt-12">
            <h2 className="font-display text-xl font-semibold text-foreground">What to ask</h2>
            <div className="mt-4">
              <CopyPrompt prompt={useCase.prompt} slug={useCase.slug} />
            </div>
          </section>

          <section className="mt-10">
            <h2 className="font-display text-xl font-semibold text-foreground">What the agent does</h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-foreground">
              {useCase.steps.map((step, i) => (
                <li key={i}>
                  {step.label}{" "}
                  <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{shortTool(step.tool)}</code>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-10">
            <h2 className="font-display text-xl font-semibold text-foreground">What comes back</h2>
            <p className="mt-4 text-sm leading-relaxed text-foreground">{useCase.answer}</p>
            <div className="mt-4">
              <UseCaseResultView result={useCase.result} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Sample content. Yours comes from your own accounts.</p>
          </section>

          <section className="mt-12">
            <h2 className="font-display text-xl font-semibold text-foreground">Try it</h2>
            {skill && (
              <p className="mt-4 text-sm leading-relaxed text-foreground">
                There is a ready-made skill for this:{" "}
                <Link href={`/skills/${skill.slug}`} className="font-medium text-primary underline underline-offset-2">
                  {skill.title}
                </Link>
                .
              </p>
            )}
            <div className="mt-6">
              <AddToAgent heading={false} layout="compact" placement="page" />
            </div>
          </section>

          <section className="mt-12">
            <h2 className="font-display text-xl font-semibold text-foreground">The tools it uses</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {useCase.services.map((s) => (
                <li key={s}>
                  <Link
                    href={`/docs/${USE_CASE_SERVICES[s].docs}`}
                    className="inline-flex rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-sm text-foreground hover:border-foreground/20"
                  >
                    {USE_CASE_SERVICES[s].label} docs
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {related.length > 0 && (
            <section className="mt-12">
              <h2 className="font-display text-xl font-semibold text-foreground">Related use cases</h2>
              <ul className="mt-4 grid gap-5 sm:grid-cols-2">
                {related.map((u) => (
                  <UseCaseCard heading="h3" key={u.slug} useCase={u} />
                ))}
              </ul>
            </section>
          )}
        </article>
      </main>
    </>
  );
}
