import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DOC_SETUP_MARKER, docSchemaNodes, docUrl, getAllDocs, getDocBySlug, getDocNeighbors } from "@/lib/docs";
import { markdownUrl } from "@/lib/markdown-copies";
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "@/lib/social-card";
import { formatContentDate } from "@/lib/utils";
import { AddToAgent } from "@/components/add-to-agent";
import { FaqSection } from "@/components/faq-section";
import { JsonLd } from "@/components/json-ld";
import { ServiceIcon, serviceFromSlug } from "@/components/service-icon";
import { DocViewTracker } from "./view-tracker";
import { DocsCta } from "../cta";
import { getConnector } from "@/lib/docs-connectors";

/** The connector a doc belongs to, by its `connector` field or because it is
 * a connector's own overview page; undefined for a general page. */
function connectorTitleFor(doc: { connector: string | null; slug: string }): string | undefined {
  return (getConnector(doc.connector ?? "") ?? getConnector(doc.slug))?.title;
}

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

  // The search title, never the visible one: the h1 stays the page's short
  // name, the `<title>` carries the service's full name, "MCP", and the brand.
  const title = doc.searchTitle;
  const url = docUrl(slug);
  return {
    title,
    description: doc.description,
    // The page stays the canonical address; its Markdown copy is offered as
    // another form of it, for a reader that is a program.
    alternates: { canonical: url, types: { "text/markdown": markdownUrl(`/docs/${slug}`) } },
    openGraph: { ...SOCIAL_OPEN_GRAPH, title, description: doc.description, type: "article", url },
    twitter: { ...SOCIAL_TWITTER, title, description: doc.description },
  };
}

export default async function DocPage({ params }: Props) {
  const { slug } = await params;
  const doc = getDocBySlug(slug);
  if (!doc) notFound();

  const { prev, next } = getDocNeighbors(slug);

  // Without the marker, split returns [wholeDoc] and `after` is undefined.
  const [before, after] = doc.html.split(DOC_SETUP_MARKER);

  return (
    <div>
      <DocViewTracker slug={doc.slug} section={doc.section} />
      {/* What the page is, where it sits, and its questions. The
          organization, the site, and the product are the root layout's. */}
      <JsonLd nodes={docSchemaNodes(doc)} />
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
      {doc.updated && (
        <p className="mt-2 text-xs text-muted-foreground">
          Updated <time dateTime={doc.updated}>{formatContentDate(doc.updated)}</time>
        </p>
      )}

      <div
        className="prose mt-8"
        dangerouslySetInnerHTML={{ __html: before }}
      />
      {after !== undefined && (
        <>
          <div className="mt-6">
            <AddToAgent placement="docs" heading={false} />
          </div>
          <div
            className="prose mt-6"
            dangerouslySetInnerHTML={{ __html: after }}
          />
        </>
      )}

      {/* After the body and before the CTA, so it reads as part of the page
          rather than as part of the pitch. Same component the blog renders. */}
      <FaqSection faqs={doc.faqs} />
      {/* The one pointer to the site's question page, under the page's own
          questions, so no docs page needs a second question section. */}
      {doc.faqs.length > 0 && (
        <p className="mt-8 text-sm text-muted-foreground">
          More answers are on the{" "}
          <Link href="/faq" className="font-medium text-primary hover:underline">
            FAQ page
          </Link>
          .
        </p>
      )}

      {/* The conversion moment: the reader has just finished the page. The
          sidebar CTA is always on screen and therefore easy to stop seeing;
          this one is not. Placed ABOVE prev/next on purpose, because
          prev/next offers more reading and would otherwise be the last
          thing on the page. */}
      <DocsCta variant="inline" connectorTitle={connectorTitleFor(doc)} />

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
