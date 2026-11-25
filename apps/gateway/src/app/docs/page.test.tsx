import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/docs" }));

const { default: DocsIndexPage, metadata } = await import("./page");
const { getAllDocs, getDocsSequence } = await import("@/lib/docs");

const html = renderToStaticMarkup(<DocsIndexPage />);

/* /docs is a page, not a redirect: every docs page with its description, in
   the sidebar's order, read from the collection so a new page appears with
   no edit here. */
describe("the docs index", () => {
  it("links every docs page once, in the reading order, with its description", () => {
    const all = getAllDocs();
    expect(all.length).toBeGreaterThan(10);
    const linked = [...html.matchAll(/href="\/docs\/([^"#/]+)"/g)].map((m) => m[1]).filter((slug) => slug !== "tools");
    expect(linked).toEqual(getDocsSequence().map((d) => d.slug));
    const text = html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    for (const doc of all) {
      if (doc.description) expect(text, doc.slug).toContain(doc.description);
    }
  });

  it("has one h1, says what DataToRAG is, and links the all-tools page", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/DataToRAG is an MCP server/);
    expect(html).toContain('href="/docs/tools"');
  });

  it("describes itself: a title, a written description, and its own canonical address", () => {
    expect(metadata.title).toContain("DataToRAG");
    const description = metadata.description ?? "";
    expect(description.length).toBeGreaterThanOrEqual(120);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(metadata.alternates?.canonical).toBe("https://datatorag.com/docs");
  });

  it("has no docs page whose address the all-tools page would shadow", () => {
    expect(getAllDocs().map((d) => d.slug)).not.toContain("tools");
  });
});
