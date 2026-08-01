import { marked } from "marked";
import { CONNECTORS, type Connector } from "./docs-connectors";
import { defineCollection, field, type ParsedFile } from "./content-collection";

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  order: number;
  section: string;
  connector: string | null;
  content: string;
  html: string;
}

export interface ConnectorGroup {
  connector: Connector;
  overview: DocPage | null;
  pages: DocPage[];
}

const collection = defineCollection<DocPage>({
  dir: "docs",
  parse: parsePage,
  sort: (a, b) => a.order - b.order,
});

export function getAllDocs(): DocPage[] {
  return collection.getAll();
}

export function getDocBySlug(slug: string): DocPage | null {
  return collection.getBySlug(slug);
}

export function getTopLevelDocs(): DocPage[] {
  const connectorSlugs = new Set(CONNECTORS.map((c) => c.slug));
  return getAllDocs().filter(
    (d) => d.connector === null && !connectorSlugs.has(d.slug)
  );
}

export function getConnectorGroups(): ConnectorGroup[] {
  const all = getAllDocs();
  return CONNECTORS.map((connector) => {
    const overview = all.find((d) => d.slug === connector.slug) ?? null;
    const pages = all
      .filter((d) => d.connector === connector.id)
      .sort((a, b) => a.order - b.order);
    return { connector, overview, pages };
  });
}

function parsePage({ slug, data, content }: ParsedFile): DocPage {
  const html = marked.parse(content) as string;

  return {
    slug,
    title: field.string(data.title, slug),
    description: field.string(data.description),
    order: field.number(data.order, 99),
    section: field.string(data.section, "general"),
    connector: field.string(data.connector) || null,
    content,
    html,
  };
}
