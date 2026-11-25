import { marked } from "marked";
import { planLimits } from "@/gateway/billing/plans";
import { CHAT_MAX_STEPS, SKILL_RUN_MAX_STEPS } from "@/mastra/run-steps";
import docsDates from "../../content/docs-dates.json";
import { CONNECTORS, getConnector, type Connector } from "./docs-connectors";
import { addHeadingAnchors } from "./docs-headings";
import { enhanceDocMedia } from "./docs-media";
import {
  defineCollection,
  field,
  type ContentFaq,
  type ParsedFile,
} from "./content-collection";
import { SITE_NAME, SITE_URL, breadcrumbNode, faqPageNode, techArticleNode, type SchemaNode } from "./site-schema";

export interface DocPage {
  slug: string;
  /** The page's name as the page, the sidebar, and the index show it. */
  title: string;
  /** The page's `<title>`: the words a person searches, with the service's
   * full name, "MCP", and the brand. Frontmatter `searchTitle`; a page
   * without one gets `<title> | DataToRAG MCP Docs`. Never shown on the page. */
  searchTitle: string;
  /** The day the page's file last changed, `YYYY-MM-DD`, from
   * `content/docs-dates.json` (written by `pnpm docs:dates`); null when the
   * manifest has no entry, which a test fails on. Shown on the page, sent as
   * the sitemap's `lastmod`, and stated as `dateModified`. */
  updated: string | null;
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

/** The values a docs page may state by name instead of typing them.
 *
 * A page writes `{{plan.free.calls}}` and the loader fills it from here, so a
 * limit on a docs page is the number enforcement reads and cannot be left
 * behind when it changes. The plan numbers come from `planLimits`, the same
 * function the pricing cards and the call gate read; the step caps from the
 * constants the agent runs under. Add a name here, from the module that
 * decides the value, before a page uses it. */
export function docsValues(): Record<string, string> {
  const count = (n: number) => n.toLocaleString("en-US");
  const free = planLimits("free");
  const pro = planLimits("pro");
  return {
    "plan.free.calls": count(free.monthlyIncluded),
    "plan.free.runs": count(free.agentRuns),
    "plan.pro.calls": count(pro.monthlyIncluded),
    "plan.pro.runs": count(pro.agentRuns),
    "run.steps.chat": count(CHAT_MAX_STEPS),
    "run.steps.skill": count(SKILL_RUN_MAX_STEPS),
  };
}

/** A docs page's markdown can place this on its own line to put the "Add to
 * your agent" block (the one client picker the dashboard and the site render
 * too) at that spot. marked passes HTML comments through untouched, so the
 * marker survives into `html` for the page to split on; the page's Markdown
 * copy writes the same clients' steps there as a list. */
export const DOC_SETUP_MARKER = "<!--setup-instructions-->";

const DOC_TOKEN = /\{\{\s*([^{}\s]+)\s*\}\}/g;

/** Replace every `{{name}}` in `text` with its value. A name that is not in
 * `values` throws, naming the page: a page that states a number nobody
 * defined does not load, so it fails the build and the tests rather than
 * showing braces, or nothing, to a reader. */
export function fillDocTokens(
  text: string,
  values: Record<string, string>,
  slug: string
): string {
  return text.replace(DOC_TOKEN, (token, name: string) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(
        `content/docs/${slug}.md uses {{${name}}}, which is not a docs value. Known values: ${Object.keys(values).join(", ")}`
      );
    }
    return values[name];
  });
}

function parsePage({ slug, data, content: source }: ParsedFile): DocPage {
  const values = docsValues();
  const fill = (text: string) => fillDocTokens(text, values, slug);
  const content = fill(source);
  const html = addHeadingAnchors(enhanceDocMedia(marked.parse(content) as string));
  const title = field.string(data.title, slug);

  return {
    slug,
    title,
    searchTitle: field.string(data.searchTitle) || `${title} | ${SITE_NAME} MCP Docs`,
    updated: (docsDates as Record<string, string>)[slug] ?? null,
    description: fill(field.string(data.description)),
    order: field.number(data.order, 99),
    section: field.string(data.section, "general"),
    connector: field.string(data.connector) || null,
    faqs: field.faqList(data.faqs).map((f) => ({ q: fill(f.q), a: fill(f.a) })),
    content,
    html,
  };
}

/** A docs page's own address, absolute, as its canonical and every node
 * state it. */
export function docUrl(slug: string): string {
  return `${SITE_URL}/docs/${slug}`;
}

/** The trail to a docs page: the site, the docs index, the connector's
 * overview page when the page belongs to a connector, then the page. A
 * connector's own overview is not listed under itself. */
export function docBreadcrumbTrail(doc: DocPage): { name: string; url: string }[] {
  const group = doc.connector ? getConnector(doc.connector) : undefined;
  return [
    { name: SITE_NAME, url: SITE_URL },
    { name: "Docs", url: `${SITE_URL}/docs` },
    ...(group ? [{ name: group.title, url: docUrl(group.slug) }] : []),
    { name: doc.title, url: docUrl(doc.slug) },
  ];
}

/** The structured data of one docs page: what it is, where it sits, and its
 * questions when it has any. Built from the strings the page shows. */
export function docSchemaNodes(doc: DocPage): SchemaNode[] {
  return [
    techArticleNode({
      headline: doc.title,
      description: doc.description,
      url: docUrl(doc.slug),
      dateModified: doc.updated,
    }),
    breadcrumbNode(docBreadcrumbTrail(doc)),
    ...(doc.faqs.length > 0 ? [faqPageNode(doc.faqs)] : []),
  ];
}
