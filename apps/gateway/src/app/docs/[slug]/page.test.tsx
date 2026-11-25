import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/docs/gmail", notFound: () => { throw new Error("not found"); } }));

const { default: DocPage, generateMetadata } = await import("./page");
const { getAllDocs, getDocBySlug } = await import("@/lib/docs");
const { formatContentDate } = await import("@/lib/utils");

const render = async (slug: string) => renderToStaticMarkup(await DocPage({ params: Promise.resolve({ slug }) }));
const nodesIn = (html: string): Record<string, unknown>[] =>
  [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].flatMap((m) => JSON.parse(m[1]));

/* A docs page as served: its short name as the heading, the search title in
   its metadata, one date in three places, and its structured data. */
describe("a docs page", () => {
  it("keeps its short name as the heading and sends the search title as its title", async () => {
    const doc = getDocBySlug("sheets")!;
    const html = await render("sheets");
    expect(html).toMatch(/<h1[^>]*>(<[^>]+>|\s)*Sheets<\/h1>/);
    expect(html).not.toContain(doc.searchTitle);
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "sheets" }) });
    expect(metadata.title).toBe(doc.searchTitle);
    expect(metadata.title).toContain("Google Sheets MCP");
    expect(metadata.description).toBe(doc.description);
    expect(metadata.alternates?.canonical).toBe("https://datatorag.com/docs/sheets");
    expect(metadata.openGraph).toMatchObject({ type: "article", url: "https://datatorag.com/docs/sheets", title: doc.searchTitle });
    expect((metadata.openGraph as { images: unknown[] }).images.length).toBe(1);
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", title: doc.searchTitle });
  });

  it.each(getAllDocs().map((d) => d.slug))("%s shows the date its structured data states", async (slug) => {
    const doc = getDocBySlug(slug)!;
    const html = await render(slug);
    expect(html).toContain(`Updated <time dateTime="${doc.updated}">${formatContentDate(doc.updated!)}</time>`);
    const nodes = nodesIn(html);
    expect(nodes.map((n) => n["@type"])).toEqual(["TechArticle", "BreadcrumbList", ...(doc.faqs.length > 0 ? ["FAQPage"] : [])]);
    expect(nodes[0].dateModified).toBe(doc.updated);
  });

  it("has one question block, with every question in the FAQPage node, and one pointer to the FAQ page", async () => {
    const doc = getDocBySlug("getting-started")!;
    const html = await render("getting-started");
    expect(html.match(/<h2[^>]*>[^<]*questions[^<]*<\/h2>/gi)).toEqual([expect.stringContaining("Frequently asked questions")]);
    const faq = nodesIn(html).find((n) => n["@type"] === "FAQPage")!;
    expect((faq.mainEntity as { name: string }[]).map((q) => q.name)).toEqual(doc.faqs.map((f) => f.q));
    expect(html.match(/href="\/faq"/g)).toHaveLength(1);
  });
});
