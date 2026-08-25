import { describe, expect, it, vi } from "vitest";

// The tools query is best-effort and irrelevant here; keep it off the network.
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  },
}));

import sitemap from "./sitemap";
import { SHARE_LINKS } from "@/lib/share-links";

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
});
