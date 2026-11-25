import type { Metadata } from "next";
import Link from "next/link";
import { getConnectorGroups, getTopLevelDocs, type DocPage } from "@/lib/docs";
import { PUBLIC_CONNECTORS_TEXT } from "@/lib/public-integrations";
import { ServiceIcon, serviceFromSlug } from "@/components/service-icon";
import { DocsCta } from "./cta";
import { ALL_TOOLS_DESCRIPTION, ALL_TOOLS_PATH, ALL_TOOLS_TITLE } from "./tools/copy";

const DESCRIPTION = `Documentation for DataToRAG, an MCP server for ${PUBLIC_CONNECTORS_TEXT}: connect a client, then see what every tool does.`;

export const metadata: Metadata = {
  title: "Documentation | DataToRAG Docs",
  description: DESCRIPTION,
  alternates: { canonical: "https://datatorag.com/docs" },
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
      <h1 className="font-display text-2xl font-bold text-foreground">DataToRAG documentation</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        DataToRAG is an MCP server that gives your agent tools for {PUBLIC_CONNECTORS_TEXT}. These pages cover how
        to connect a client and what each tool does.
      </p>

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

      <DocsCta variant="inline" />
    </div>
  );
}
