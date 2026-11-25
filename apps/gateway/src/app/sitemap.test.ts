import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The tools query is best-effort; keep it off the network. Two active rows,
// one of them an admin-only service's plugin (SCRUM-454).
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => Promise.resolve([{ slug: "notion-mcp" }, { slug: "slack-mcp" }]) }),
    }),
  },
}));

import sitemap from "./sitemap";
import { SHARE_LINKS } from "@/lib/share-links";
import { getAllUseCases } from "@/lib/use-cases";
import { getAllDocs } from "@/lib/docs";
import { getAllPosts } from "@/lib/blog";

describe("sitemap", () => {
  it("never lists a share link", async () => {
    // /r/<slug> routes are share links, not content. Listing them would have
    // them compete with the pages they point at.
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).not.toMatch(/\/r\//);
    }
    for (const slug of Object.keys(SHARE_LINKS)) {
      expect(urls).not.toContain(`https://datatorag.com/r/${slug}`);
    }
  });

  it("lists the use case list and every use case, each with its record's date (SCRUM-514)", async () => {
    const entries = await sitemap();
    const useCases = getAllUseCases();
    expect(useCases.length).toBeGreaterThan(0);
    for (const u of useCases) {
      const entry = entries.find((e) => e.url === `https://datatorag.com/use-cases/${u.slug}`);
      expect(entry, u.slug).toBeDefined();
      expect((entry!.lastModified as Date).toISOString().slice(0, 10)).toBe(u.date);
    }
    const list = entries.find((e) => e.url === "https://datatorag.com/use-cases");
    expect((list!.lastModified as Date).toISOString().slice(0, 10)).toBe(useCases.map((u) => u.date).sort().at(-1));
  });

  it("lists the blog index with the day of its newest post or edit, and every post with its own", async () => {
    const entries = await sitemap();
    const posts = getAllPosts();
    expect(posts.length).toBeGreaterThan(40);
    const days = posts.map((p) => p.updated ?? p.date);
    for (const [i, p] of posts.entries()) {
      const entry = entries.find((e) => e.url === `https://datatorag.com/blog/${p.slug}`);
      expect((entry!.lastModified as Date).toISOString().slice(0, 10), p.slug).toBe(days[i]);
    }
    const index = entries.find((e) => e.url === "https://datatorag.com/blog");
    expect((index!.lastModified as Date).toISOString().slice(0, 10)).toBe([...days].sort().at(-1));
    // A feed and a Markdown copy are not pages a search result should show.
    expect(entries.map((e) => e.url).filter((u) => /\.(xml|md)$/.test(u))).toEqual([]);
  });

  it("lists the docs index and the all-tools page, and never an address that only redirects", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.filter((u) => u === "https://datatorag.com/docs")).toHaveLength(1);
    expect(urls.filter((u) => u === "https://datatorag.com/docs/tools")).toHaveLength(1);
    expect(urls).not.toContain("https://datatorag.com/tools");
    // The index is a page: nothing in its source sends the reader elsewhere.
    const source = readFileSync(path.resolve(process.cwd(), "src/app/docs/page.tsx"), "utf8");
    expect(source).not.toMatch(/redirect\(/);
  });

  it("lists every docs page with the day its file last changed, and the two generated docs pages with none", async () => {
    const entries = await sitemap();
    const docs = getAllDocs();
    expect(docs.length).toBeGreaterThan(10);
    for (const d of docs) {
      const entry = entries.find((e) => e.url === `https://datatorag.com/docs/${d.slug}`);
      expect(entry, d.slug).toBeDefined();
      expect(d.updated, d.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const sent = entry!.lastModified as Date;
      const two = (n: number) => String(n).padStart(2, "0");
      expect(`${sent.getFullYear()}-${two(sent.getMonth() + 1)}-${two(sent.getDate())}`, d.slug).toBe(d.updated);
    }
    // The index is read from every docs page and the tool list from the
    // registry on each request: neither has a day of its own to state.
    for (const url of ["https://datatorag.com/docs", "https://datatorag.com/docs/tools"]) {
      expect(entries.find((e) => e.url === url)!.lastModified, url).toBeUndefined();
    }
  });

  it("lists an active plugin's page, and never an admin-only service's (SCRUM-454)", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain("https://datatorag.com/tools/notion-mcp");
    expect(urls).not.toContain("https://datatorag.com/tools/slack-mcp");
  });
});
