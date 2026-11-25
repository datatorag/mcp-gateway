import { marked } from "marked";
import { CONNECTORS, type Connector } from "./docs-connectors";
import {
  defineCollection,
  field,
  type ContentFaq,
  type ParsedFile,
} from "./content-collection";

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  order: number;
  section: string;
  connector: string | null;
  /** Per-page questions and answers, rendered on the page and emitted as
   * FAQPage JSON-LD from the same strings. Same field, same shape and same
   * reader as the blog's, deliberately: docs pages are already question-shaped
   * and a second mechanism for them is how the two drift. Empty for most
   * pages. */
  faqs: ContentFaq[];
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

/** Every docs page once, in the order the sidebar lists them: the general
 * pages, then each connector's overview followed by its pages. Previous and
 * Next walk this, so they never leave a connector's group midway. Frontmatter
 * `order` sorts within a list only; it is not a position among all pages. */
export function getDocsSequence(): DocPage[] {
  return [
    ...getTopLevelDocs(),
    ...getConnectorGroups().flatMap(({ overview, pages }) =>
      overview ? [overview, ...pages] : pages
    ),
  ];
}

/** The pages before and after a page in the reading order. */
export function getDocNeighbors(slug: string): {
  prev: DocPage | null;
  next: DocPage | null;
} {
  const sequence = getDocsSequence();
  const index = sequence.findIndex((d) => d.slug === slug);
  if (index === -1) return { prev: null, next: null };
  return { prev: sequence[index - 1] ?? null, next: sequence[index + 1] ?? null };
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
    faqs: field.faqList(data.faqs),
    content,
    html,
  };
}
