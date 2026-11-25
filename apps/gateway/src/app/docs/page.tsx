import type { Metadata } from "next";
import Link from "next/link";
import { getConnectorGroups, getTopLevelDocs, type DocPage } from "@/lib/docs";
import { PUBLIC_CONNECTORS_TEXT } from "@/lib/public-integrations";
import { SITE_NAME, SITE_URL, breadcrumbNode, collectionPageNode } from "@/lib/site-schema";
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "@/lib/social-card";
import { JsonLd } from "@/components/json-ld";
import { ServiceIcon, serviceFromSlug } from "@/components/service-icon";
import { DocsCta } from "./cta";
import {
  DOCS_GLOSSARY,
  DOCS_GLOSSARY_HEADING,
  DOCS_INDEX_HEADING,
  DOCS_INDEX_DESCRIPTION,
  DOCS_INDEX_PATH,
  DOCS_INDEX_SEARCH_TITLE,
} from "./copy";
import { ALL_TOOLS_DESCRIPTION, ALL_TOOLS_PATH, ALL_TOOLS_TITLE } from "./tools/copy";

const PAGE_URL = `${SITE_URL}${DOCS_INDEX_PATH}`;

export const metadata: Metadata = {
  title: DOCS_INDEX_SEARCH_TITLE,
  description: DOCS_INDEX_DESCRIPTION,
  alternates: { canonical: PAGE_URL, types: { "text/markdown": `${PAGE_URL}.md` } },
  openGraph: {
    ...SOCIAL_OPEN_GRAPH,
    title: DOCS_INDEX_SEARCH_TITLE,
    description: DOCS_INDEX_DESCRIPTION,
    type: "website",
    url: PAGE_URL,
  },
  twitter: { ...SOCIAL_TWITTER, title: DOCS_INDEX_SEARCH_TITLE, description: DOCS_INDEX_DESCRIPTION },
};

/** One page of the list: its title, linked, and its one-line description. */
function PageEntry({ href, title, description, slug }: { href: string; title: string; description: string; slug?: string }) {
  const service = slug ? serviceFromSlug(slug) : null;
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-primary"
      >
        {service && <ServiceIcon service={service} size={15} />}
        {title}
      </Link>
      {description && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>}
    </li>
  );
}

const entryFor = (doc: DocPage) => (
  <PageEntry key={doc.slug} href={`/docs/${doc.slug}`} title={doc.title} description={doc.description} slug={doc.slug} />
);

/**
 * The docs index: every docs page with its description, grouped as the
 * sidebar groups them. Read from the collection, so a new page is listed
 * with no edit here. Static, like every other docs page.
 */
export default function DocsIndexPage() {
  const topLevel = getTopLevelDocs();
  const groups = getConnectorGroups();

  return (
    <div>
      {/* No date: the list is read from every docs page, so no day is its own. */}
      <JsonLd
        nodes={[
          collectionPageNode({ name: DOCS_INDEX_HEADING, description: DOCS_INDEX_DESCRIPTION, url: PAGE_URL }),
          breadcrumbNode([
            { name: SITE_NAME, url: SITE_URL },
            { name: "Docs", url: PAGE_URL },
          ]),
        ]}
      />
      <h1 className="font-display text-2xl font-bold text-foreground">{DOCS_INDEX_HEADING}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        DataToRAG is an MCP server that gives your agent tools for {PUBLIC_CONNECTORS_TEXT}. These pages cover how
        to connect a client and what each tool does.
      </p>

      {/* Moving files, named: it is a thing the server does across services,
          so no single service's page says it. The link goes to a section of
          the page, which the list below links whole. */}
      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="font-display text-base font-bold text-foreground">Move files between services</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          The DataToRAG MCP server takes a file from an email, from Google Drive, or from your computer and puts
          it on a Jira issue, on a Notion page, in Google Drive, or in an email. Each move answers with a receipt
          that gives the file&apos;s name, size, and SHA-256.{" "}
          <Link
            href="/docs/file-references#tools-that-take-a-file"
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            See the tools that take a file
          </Link>
          .
        </p>
      </div>

      <section className="mt-8">
        <h2 className="font-display text-lg font-bold text-foreground">General</h2>
        <ul className="mt-4 space-y-4">
          {topLevel.map(entryFor)}
          <PageEntry href={ALL_TOOLS_PATH} title={ALL_TOOLS_TITLE} description={ALL_TOOLS_DESCRIPTION} />
        </ul>
      </section>

      {groups.map(({ connector, overview, pages }) => (
        <section key={connector.id} className="mt-10">
          <h2 className="font-display text-lg font-bold text-foreground">{connector.title}</h2>
          <ul className="mt-4 space-y-4">
            {overview && (
              <PageEntry
                href={`/docs/${overview.slug}`}
                title={`${overview.title} overview`}
                description={overview.description}
              />
            )}
            {pages.map(entryFor)}
          </ul>
        </section>
      ))}

      {/* The docs' vocabulary. Each term's id is an address a page can link. */}
      <section id="glossary" className="mt-10 scroll-mt-28">
        <h2 className="font-display text-lg font-bold text-foreground">{DOCS_GLOSSARY_HEADING}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Every docs page uses one name for each of these.
        </p>
        <dl className="mt-4 space-y-4">
          {DOCS_GLOSSARY.map(({ id, term, definition }) => (
            <div key={id}>
              <dt id={id} className="scroll-mt-28 text-sm font-medium text-foreground">
                {term}
              </dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{definition}</dd>
            </div>
          ))}
        </dl>
      </section>

      <DocsCta variant="inline" />
    </div>
  );
}
