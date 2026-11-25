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

  it("lists an active plugin's page, and never an admin-only service's (SCRUM-454)", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain("https://datatorag.com/tools/notion-mcp");
    expect(urls).not.toContain("https://datatorag.com/tools/slack-mcp");
  });
});
