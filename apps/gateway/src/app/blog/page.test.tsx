// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/navbar", () => ({ Navbar: () => null }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

const pillars = vi.hoisted(() => ({ slugs: [] as string[] }));
vi.mock("@/lib/blog", async (original) => {
  const real = await original<typeof import("@/lib/blog")>();
  return { ...real, getPillarPosts: () => (pillars.slugs.length > 0 ? real.getAllPosts().filter((p) => pillars.slugs.includes(p.slug)) : real.getPillarPosts()) };
});

import BlogListingPage, { metadata } from "./page";
import { BLOG_DESCRIPTION, BLOG_SEARCH_TITLE } from "./copy";
import { getAllPosts } from "@/lib/blog";

const posts = getAllPosts();
const render = () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(BlogListingPage());
  return host;
};

/* The blog's index: what it tells a search result and a program, and the
   group of main posts it leads with once a post is marked as one. */
describe("the blog index", () => {
  it("has a written title and description of the right length", () => {
    expect(metadata.title).toBe(BLOG_SEARCH_TITLE);
    expect(BLOG_SEARCH_TITLE.length).toBeLessThanOrEqual(60);
    expect(BLOG_SEARCH_TITLE).toMatch(/\bMCP\b/);
    expect(BLOG_SEARCH_TITLE).toContain("DataToRAG");
    expect(metadata.description).toBe(BLOG_DESCRIPTION);
    expect(BLOG_DESCRIPTION.length).toBeGreaterThanOrEqual(120);
    expect(BLOG_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it("states its canonical address, its feed, and its link preview", () => {
    expect(metadata.alternates).toEqual({
      canonical: "https://datatorag.com/blog",
      types: { "application/rss+xml": "https://datatorag.com/blog/feed.xml" },
    });
    expect(metadata.openGraph).toMatchObject({ title: BLOG_SEARCH_TITLE, description: BLOG_DESCRIPTION, type: "website", url: "https://datatorag.com/blog" });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", title: BLOG_SEARCH_TITLE, description: BLOG_DESCRIPTION });
  });

  it("lists every post, newest first, in its structured data, with its trail", () => {
    const host = render();
    const nodes = JSON.parse(host.querySelector('script[type="application/ld+json"]')!.textContent!) as Record<string, unknown>[];
    const page = nodes.find((n) => n["@type"] === "CollectionPage")!;
    expect(page).toMatchObject({ url: "https://datatorag.com/blog", description: BLOG_DESCRIPTION });
    const list = page.mainEntity as { "@type": string; numberOfItems: number; itemListElement: { position: number; name: string; url: string }[] };
    expect(list["@type"]).toBe("ItemList");
    expect(posts.length).toBeGreaterThan(40);
    expect(list.numberOfItems).toBe(posts.length);
    expect(list.itemListElement.map((i) => i.url)).toEqual(posts.map((p) => `https://datatorag.com/blog/${p.slug}`));
    expect(list.itemListElement.map((i) => i.position)).toEqual(posts.map((_p, i) => i + 1));
    expect(list.itemListElement.map((i) => i.name)).toEqual(posts.map((p) => p.title));
    const trail = nodes.find((n) => n["@type"] === "BreadcrumbList")!.itemListElement as { item: string }[];
    expect(trail.map((t) => t.item)).toEqual(["https://datatorag.com", "https://datatorag.com/blog"]);
  });

  it("links every post once from its grid, under the post's own headline", () => {
    const host = render();
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    for (const post of posts) {
      const links = [...host.querySelectorAll(`a[href="/blog/${post.slug}"]`)];
      expect(links.length, post.slug).toBe(post.pillar ? 2 : 1);
      expect(links.at(-1)!.querySelector("h2")!.textContent, post.slug).toBe(post.title);
    }
  });

  it("shows Start here only when a post is marked as a main post", () => {
    const marked = posts.filter((p) => p.pillar);
    const host = render();
    const section = host.querySelector('section[aria-labelledby="start-here"]');
    expect(Boolean(section)).toBe(marked.length > 0);
    if (section) expect([...section.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(marked.map((p) => `/blog/${p.slug}`));
  });

  it("leads with the main posts, above the grid, once some are marked", () => {
    pillars.slugs = [posts[3].slug, posts[7].slug];
    try {
      const host = render();
      const section = host.querySelector('section[aria-labelledby="start-here"]')!;
      expect(section.querySelector("h2")!.textContent).toBe("Start here");
      expect([...section.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([`/blog/${posts[3].slug}`, `/blog/${posts[7].slug}`]);
      const grid = host.querySelector(`a[href="/blog/${posts[0].slug}"]`)!;
      expect(section.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      pillars.slugs = [];
    }
  });
});
