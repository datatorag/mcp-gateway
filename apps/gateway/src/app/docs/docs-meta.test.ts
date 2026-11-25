import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { docBreadcrumbTrail, docSchemaNodes, docUrl, getAllDocs, type DocPage } from "@/lib/docs";
import { getConnector } from "@/lib/docs-connectors";
import { faqAnswerText } from "@/lib/faq";
import type { SchemaNode } from "@/lib/site-schema";
import { DOCS_INDEX_DESCRIPTION, DOCS_INDEX_PATH, DOCS_INDEX_SEARCH_TITLE } from "./copy";
import { ALL_TOOLS_DESCRIPTION, ALL_TOOLS_PATH, ALL_TOOLS_SEARCH_TITLE } from "./tools/copy";

/* What every docs page says about itself to a search engine or a link
   preview: its title, its description, its structured data, and where its
   links go. One list, so the two route pages (the index and the all-tools
   page) are held to the same rules as the markdown pages. */

const docs = getAllDocs();
const pages: { path: string; title: string; description: string }[] = [
  ...docs.map((d) => ({ path: `/docs/${d.slug}`, title: d.searchTitle, description: d.description })),
  { path: DOCS_INDEX_PATH, title: DOCS_INDEX_SEARCH_TITLE, description: DOCS_INDEX_DESCRIPTION },
  { path: ALL_TOOLS_PATH, title: ALL_TOOLS_SEARCH_TITLE, description: ALL_TOOLS_DESCRIPTION },
];

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("docs page titles", () => {
  it("covers every docs page and the two route pages", () => {
    // Guards the guard: an empty collection would pass everything below.
    expect(docs.length).toBeGreaterThan(10);
    expect(pages.length).toBe(docs.length + 2);
  });

  it("every title says MCP and DataToRAG", () => {
    const missing = pages.filter((p) => !/\bMCP\b/.test(p.title) || !p.title.includes("DataToRAG")).map((p) => p.path);
    expect(missing).toEqual([]);
  });

  it("no two pages share a title", () => {
    const titles = pages.map((p) => p.title);
    expect(titles.filter((t, i) => titles.indexOf(t) !== i)).toEqual([]);
  });

  it("every title fits in what a result shows", () => {
    expect(pages.filter((p) => p.title.length > 60).map((p) => `${p.path} (${p.title.length})`)).toEqual([]);
  });

  it("every markdown page writes its own search title", () => {
    // The built pattern is a fallback for a page somebody forgot, not a title.
    const fallback = docs.filter((d) => d.searchTitle === `${d.title} | DataToRAG MCP Docs`).map((d) => d.slug);
    expect(fallback).toEqual([]);
  });

  it("names a Google service by its full name", () => {
    for (const d of docs.filter((doc) => doc.connector === "google-workspace")) {
      // Gmail is the one whose own name is the full name.
      const full = d.slug === "gmail" ? "Gmail" : `Google ${d.title}`;
      expect(d.searchTitle, d.slug).toContain(full);
    }
  });

  it("the pages send the search title, and the heading stays the page's own name", () => {
    const page = source("src/app/docs/[slug]/page.tsx");
    expect(page).toMatch(/const title = doc\.searchTitle;/);
    expect(page).toMatch(/<\/h1>/);
    expect(page).toMatch(/\{doc\.title\}\s*<\/h1>/);
    expect(source("src/app/docs/page.tsx")).toMatch(/title: DOCS_INDEX_SEARCH_TITLE/);
    expect(source("src/app/docs/tools/page.tsx")).toMatch(/title: ALL_TOOLS_SEARCH_TITLE/);
  });
});

describe("docs page descriptions", () => {
  it("every description is written to 120 to 160 characters", () => {
    const off = pages
      .filter((p) => p.description.length < 120 || p.description.length > 160)
      .map((p) => `${p.path} (${p.description.length})`);
    expect(off).toEqual([]);
  });

  it("no two pages share a description", () => {
    const all = pages.map((p) => p.description);
    expect(all.filter((d, i) => all.indexOf(d) !== i)).toEqual([]);
  });
});

describe("docs page addresses in metadata", () => {
  it("every docs page states its canonical, its Open Graph address and type, and the card", () => {
    const page = source("src/app/docs/[slug]/page.tsx");
    expect(page).toMatch(/alternates: \{ canonical: url \}/);
    expect(page).toMatch(/openGraph: \{ \.\.\.SOCIAL_OPEN_GRAPH, title, description: doc\.description, type: "article", url \}/);
    expect(page).toMatch(/const url = docUrl\(slug\);/);
    expect(docUrl("gmail")).toBe("https://datatorag.com/docs/gmail");
    for (const file of ["src/app/docs/page.tsx", "src/app/docs/tools/page.tsx"]) {
      const text = source(file);
      expect(text, file).toMatch(/alternates: \{ canonical: PAGE_URL \}/);
      expect(text, file).toMatch(/type: "website",\s+url: PAGE_URL,/);
    }
  });
});

/* Structured data. Each docs page emits what it is (TechArticle), where it
   sits (BreadcrumbList), and its questions (FAQPage) when it has any. */
describe("docs page structured data", () => {
  const byType = (nodes: SchemaNode[], type: string) => nodes.filter((n) => n["@type"] === type);
  const org = { "@type": "Organization", "@id": "https://datatorag.com/#organization", name: "DataToRAG", url: "https://datatorag.com" };

  it.each(docs.map((d) => [d.slug, d] as const))("%s: a TechArticle with every required property", (_slug, doc: DocPage) => {
    const nodes = docSchemaNodes(doc);
    const [article, ...extra] = byType(nodes, "TechArticle");
    expect(extra).toEqual([]);
    expect(article["@context"]).toBe("https://schema.org");
    // The strings the page shows, never a second copy.
    expect(article.headline).toBe(doc.title);
    expect(article.description).toBe(doc.description);
    expect((article.headline as string).length).toBeGreaterThan(0);
    expect(article.url).toBe(`https://datatorag.com/docs/${doc.slug}`);
    expect(article.mainEntityOfPage).toBe(article.url);
    expect(article.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(article.dateModified).toBe(doc.updated);
    expect(article.author).toEqual(org);
    expect(article.publisher).toEqual(org);
  });

  it.each(docs.map((d) => [d.slug, d] as const))("%s: a BreadcrumbList from the site down to the page", (_slug, doc: DocPage) => {
    const [crumbs, ...extra] = byType(docSchemaNodes(doc), "BreadcrumbList");
    expect(extra).toEqual([]);
    const items = crumbs.itemListElement as { "@type": string; position: number; name: string; item: string }[];
    expect(items.map((i) => i.position)).toEqual(items.map((_, i) => i + 1));
    for (const item of items) {
      expect(item["@type"]).toBe("ListItem");
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.item).toMatch(/^https:\/\/datatorag\.com(\/|$)/);
    }
    const group = doc.connector ? getConnector(doc.connector) : undefined;
    expect(items.map((i) => i.name)).toEqual(["DataToRAG", "Docs", ...(group ? [group.title] : []), doc.title]);
    expect(items[1].item).toBe("https://datatorag.com/docs");
    expect(items.at(-1)!.item).toBe(`https://datatorag.com/docs/${doc.slug}`);
    // The group's entry is a docs page that exists.
    if (group) expect(docs.map((d) => `https://datatorag.com/docs/${d.slug}`)).toContain(items[2].item);
  });

  it("lists a connector's page under its connector, and an overview page under Docs", () => {
    const names = (slug: string) => docBreadcrumbTrail(docs.find((d) => d.slug === slug)!).map((e) => e.name);
    expect(names("gmail")).toEqual(["DataToRAG", "Docs", "Google Workspace", "Gmail"]);
    expect(names("jira")).toEqual(["DataToRAG", "Docs", "Atlassian", "Jira"]);
    expect(names("google-workspace")).toEqual(["DataToRAG", "Docs", "Google Workspace"]);
    expect(names("getting-started")).toEqual(["DataToRAG", "Docs", "Getting Started"]);
  });

  it.each(docs.map((d) => [d.slug, d] as const))("%s: a FAQPage holding every question on the page", (_slug, doc: DocPage) => {
    const faqPages = byType(docSchemaNodes(doc), "FAQPage");
    expect(faqPages).toHaveLength(doc.faqs.length > 0 ? 1 : 0);
    if (faqPages.length === 0) return;
    const entities = faqPages[0].mainEntity as { "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } }[];
    expect(entities.map((e) => e.name)).toEqual(doc.faqs.map((f) => f.q));
    for (const [i, entity] of entities.entries()) {
      expect(entity["@type"]).toBe("Question");
      expect(entity.acceptedAnswer["@type"]).toBe("Answer");
      expect(entity.acceptedAnswer.text).toBe(faqAnswerText(doc.faqs[i].a));
      expect(entity.acceptedAnswer.text.length).toBeGreaterThan(0);
    }
  });

  it("the page renders those nodes, and the two route pages a CollectionPage and a trail with no date", () => {
    expect(source("src/app/docs/[slug]/page.tsx")).toMatch(/<JsonLd nodes=\{docSchemaNodes\(doc\)\} \/>/);
    for (const file of ["src/app/docs/page.tsx", "src/app/docs/tools/page.tsx"]) {
      const text = source(file);
      expect(text, file).toMatch(/collectionPageNode\(/);
      expect(text, file).toMatch(/breadcrumbNode\(/);
      // Both are built from other sources; a date here would be invented.
      expect(text, file).not.toMatch(/dateModified|lastModified/);
    }
  });
});

/* One question block per page: the frontmatter `faqs`, which is what renders
   on the page and what the FAQPage node is built from. A second section of
   questions in the body is on the page and in no structured data. */
describe("docs page questions", () => {
  it("no page's body has a question section of its own", () => {
    const own = docs.flatMap((d) =>
      (d.content.match(/^#{1,6} .*$/gm) ?? [])
        .filter((heading) => /\bquestions?\b|\bFAQs?\b|\?\s*$/i.test(heading))
        .map((heading) => `${d.slug}: ${heading}`)
    );
    expect(own).toEqual([]);
  });

  it("the rule can go red", () => {
    expect(/\bquestions?\b|\bFAQs?\b|\?\s*$/i.test("## Common questions")).toBe(true);
    expect(/\bquestions?\b|\bFAQs?\b|\?\s*$/i.test("## Connecting")).toBe(false);
  });
});

/* Links between pages. A link to a docs page that does not exist answers 404
   at request time, and a link to an address that only redirects costs a hop
   on every crawl. */
describe("docs page links", () => {
  /** Addresses that only send the reader somewhere else. */
  const REDIRECTS = ["/tools", "/skills/for", "/dashboard/mcp-config", "/dashboard/api-keys"];
  const docPaths = new Set([DOCS_INDEX_PATH, ALL_TOOLS_PATH, ...docs.map((d) => `/docs/${d.slug}`)]);

  /** Every internal address a page links to, from its body and its answers,
   * without the hash or query. Image links are files, not pages. */
  const linksOf = (doc: DocPage): string[] => {
    const text = [doc.content, ...doc.faqs.map((f) => f.a)].join("\n");
    const markdown = [...text.matchAll(/(!?)\[[^\]]*\]\((?:https:\/\/datatorag\.com)?(\/[^)\s#?]*)/g)]
      .filter((m) => m[1] !== "!")
      .map((m) => m[2]);
    const html = [...text.matchAll(/href="(?:https:\/\/datatorag\.com)?(\/[^"#?]*)/g)].map((m) => m[1]);
    return [...markdown, ...html].map((href) => (href.length > 1 ? href.replace(/\/$/, "") : href));
  };

  it("reads links out of the pages", () => {
    expect(docs.flatMap(linksOf).length).toBeGreaterThan(50);
  });

  it("no link goes to an address that only redirects", () => {
    const through = docs.flatMap((d) => linksOf(d).filter((href) => REDIRECTS.includes(href)).map((href) => `${d.slug}: ${href}`));
    expect(through).toEqual([]);
  });

  it("the redirect list names addresses that do redirect", () => {
    for (const href of REDIRECTS) {
      const file = `src/app${href}/page.tsx`;
      expect(existsSync(path.join(process.cwd(), file)), file).toBe(true);
      expect(source(file), file).toMatch(/(permanentRedirect|redirect)\(/);
    }
  });

  it("every link to a docs page names a page that exists", () => {
    const broken = docs.flatMap((d) =>
      linksOf(d)
        .filter((href) => href === "/docs" || href.startsWith("/docs/"))
        .filter((href) => !docPaths.has(href))
        .map((href) => `${d.slug}: ${href}`)
    );
    expect(broken).toEqual([]);
  });

  it("the connector pages are linked from another page's body", () => {
    // Each connector's overview and each service page is reached from prose,
    // not from the sidebar alone.
    const linked = new Set(docs.flatMap((d) => linksOf(d).filter((href) => href !== `/docs/${d.slug}`)));
    const targets = docs.filter((d) => d.connector !== null || getConnector(d.slug)).map((d) => `/docs/${d.slug}`);
    expect(targets.length).toBeGreaterThan(8);
    expect(targets.filter((href) => !linked.has(href))).toEqual([]);
  });

  it("Getting Started links every connector page", () => {
    const from = new Set(linksOf(docs.find((d) => d.slug === "getting-started")!));
    const targets = docs.filter((d) => d.connector !== null || getConnector(d.slug)).map((d) => `/docs/${d.slug}`);
    expect(targets.filter((href) => !from.has(href))).toEqual([]);
  });
});
