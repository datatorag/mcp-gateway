import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getAllDocs, getDocBySlug } from "@/lib/docs";
import { SetupInstructions } from "@/components/setup-instructions";
import { ServiceIcon, serviceFromSlug } from "@/components/service-icon";
import { DocViewTracker } from "./view-tracker";
import { DocsCta } from "../cta";

// A doc's markdown can place `<!--setup-instructions-->` on its own line to
// render the shared SetupInstructions component (the same client picker +
// copy-config the dashboard wizard renders — one source of truth, SCRUM-24)
// at that exact spot. marked passes HTML comments through untouched, so the
// marker survives into doc.html for us to split on.
const SETUP_MARKER = "<!--setup-instructions-->";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllDocs().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDocBySlug(slug);
  if (!doc) return { title: "Not Found" };

  return {
    title: `${doc.title} | DataToRAG Docs`,
    description: doc.description,
    alternates: { canonical: `https://datatorag.com/docs/${slug}` },
  };
}

export default async function DocPage({ params }: Props) {
  const { slug } = await params;
  const doc = getDocBySlug(slug);
  if (!doc) notFound();

  const allDocs = getAllDocs();
  const currentIndex = allDocs.findIndex((d) => d.slug === slug);
  const prev = currentIndex > 0 ? allDocs[currentIndex - 1] : null;
  const next =
    currentIndex < allDocs.length - 1 ? allDocs[currentIndex + 1] : null;

  // Without the marker, split returns [wholeDoc] and `after` is undefined.
  const [before, after] = doc.html.split(SETUP_MARKER);

  return (
    <div>
      <DocViewTracker slug={doc.slug} section={doc.section} />
      <h1 className="flex items-center gap-3 font-display text-2xl font-bold text-foreground">
        {serviceFromSlug(doc.slug) && (
          <ServiceIcon service={doc.slug} size={28} />
        )}
        {doc.title}
      </h1>
      {doc.description && (
        <p className="mt-1.5 text-sm text-muted-foreground">
          {doc.description}
        </p>
      )}

      <div
        className="prose mt-8"
        dangerouslySetInnerHTML={{ __html: before }}
      />
      {after !== undefined && (
        <>
          <div className="mt-6">
            <SetupInstructions sourcePrefix="docs" />
          </div>
          <div
            className="prose mt-6"
            dangerouslySetInnerHTML={{ __html: after }}
          />
        </>
      )}

      {/* The conversion moment: the reader has just finished the page. The
          sidebar CTA is always on screen and therefore easy to stop seeing;
          this one is not. Placed ABOVE prev/next on purpose, because
          prev/next offers more reading and would otherwise be the last
          thing on the page. */}
      <DocsCta variant="inline" />

      {/* Prev / Next navigation */}
      {(prev || next) && (
        <div className="mt-12 flex items-center justify-between border-t border-border pt-6">
          {prev ? (
            <Link
              href={`/docs/${prev.slug}`}
              className="group flex flex-col"
            >
              <span className="text-xs text-muted-foreground">Previous</span>
              <span className="text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                {prev.title}
              </span>
            </Link>
          ) : (
            <div />
          )}
          {next ? (
            <Link
              href={`/docs/${next.slug}`}
              className="group flex flex-col items-end"
            >
              <span className="text-xs text-muted-foreground">Next</span>
              <span className="text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                {next.title}
              </span>
            </Link>
          ) : (
            <div />
          )}
        </div>
      )}
    </div>
  );
}
