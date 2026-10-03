import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAllPosts } from "./blog";
import { MAX_CARD_BYTES, isCardShaped, postCardImage, readSitePng } from "./post-card-image";

/**
 * Which picture a post offers a link preview (SCRUM-367). A preview crops to
 * about 1.91:1, so a cover is offered only when it already has that shape.
 */

describe("the shape rule", () => {
  const kb = 100 * 1024;
  it("takes a card-shaped image", () => {
    expect(isCardShaped({ width: 1200, height: 630, bytes: kb })).toBe(true);
    expect(isCardShaped({ width: 1200, height: 600, bytes: kb })).toBe(true); // 2:1
    expect(isCardShaped({ width: 2200, height: 1160, bytes: kb })).toBe(true);
  });

  it("refuses the shapes a preview would crop into a band", () => {
    expect(isCardShaped({ width: 1440, height: 900, bytes: kb })).toBe(false); // 16:10
    expect(isCardShaped({ width: 2400, height: 1600, bytes: kb })).toBe(false); // 3:2
    expect(isCardShaped({ width: 1352, height: 956, bytes: kb })).toBe(false); // 1.41:1
    expect(isCardShaped({ width: 1186, height: 1100, bytes: kb })).toBe(false); // near square
    expect(isCardShaped({ width: 2850, height: 5284, bytes: kb })).toBe(false); // portrait
    expect(isCardShaped({ width: 3000, height: 1000, bytes: kb })).toBe(false); // too wide
  });

  it("refuses a megabyte or more, whatever the shape", () => {
    expect(isCardShaped({ width: 1200, height: 630, bytes: MAX_CARD_BYTES - 1 })).toBe(true);
    expect(isCardShaped({ width: 1200, height: 630, bytes: MAX_CARD_BYTES })).toBe(false);
  });

  it("refuses a size it cannot divide", () => {
    expect(isCardShaped({ width: 1200, height: 0, bytes: kb })).toBe(false);
  });
});

describe("reading a picture's size", () => {
  it("reads the site card", () => {
    expect(readSitePng("/social-card.png")).toMatchObject({ width: 1200, height: 630 });
  });

  it("answers null for a path that is not a site path, leaves public/, is missing, or is not a PNG", () => {
    expect(readSitePng("https://example.com/x.png")).toBeNull();
    expect(readSitePng("//example.com/x.png")).toBeNull();
    expect(readSitePng("social-card.png")).toBeNull();
    expect(readSitePng("/../package.json")).toBeNull();
    expect(readSitePng("/blog/../../package.json")).toBeNull();
    expect(readSitePng("/no-such-file.png")).toBeNull();
    const jpg = readdirSync(path.resolve(process.cwd(), "public")).find((f) => f.endsWith(".jpg"));
    expect(jpg).toBeDefined();
    expect(readSitePng(`/${jpg}`)).toBeNull();
  });
});

describe("what a post offers", () => {
  it("a card-shaped cover, absolute, with its size", () => {
    expect(postCardImage({ coverImage: "/social-card.png" })).toEqual({
      url: "https://datatorag.com/social-card.png",
      width: 1200,
      height: 630,
    });
  });

  it("nothing for a cover that is the wrong shape, missing, or absent: the site card stands", () => {
    expect(postCardImage({ coverImage: "/datatorag-logo.png" })).toBeUndefined(); // square
    expect(postCardImage({ coverImage: "/no-such-file.png" })).toBeUndefined();
    expect(postCardImage({})).toBeUndefined();
  });

  it("ogImage wins without the shape test, with a size when one can be read", () => {
    expect(postCardImage({ ogImage: "/datatorag-logo.png", coverImage: "/social-card.png" })).toEqual({
      url: "https://datatorag.com/datatorag-logo.png",
      width: 1024,
      height: 1024,
    });
    expect(postCardImage({ ogImage: "/no-such-file.png" })).toEqual({ url: "https://datatorag.com/no-such-file.png" });
  });
});

describe("the posts as they are published", () => {
  const posts = getAllPosts();

  it("every image a post offers is on this site, sized, card-shaped unless the author named it, and under 1 MB", () => {
    const offered = posts.flatMap((p) => {
      const card = postCardImage(p);
      return card ? [{ slug: p.slug, card, named: Boolean(p.ogImage) }] : [];
    });
    for (const { slug, card, named } of offered) {
      expect(card.url.startsWith("https://datatorag.com/"), slug).toBe(true);
      const size = readSitePng(new URL(card.url).pathname);
      expect(size, slug).not.toBeNull();
      expect(card.width, slug).toBe(size!.width);
      expect(card.height, slug).toBe(size!.height);
      if (!named) expect(isCardShaped(size!), slug).toBe(true);
      expect(size!.bytes, slug).toBeLessThan(MAX_CARD_BYTES);
    }
  });

  it("the rule is doing something: some covers pass and some are held back", () => {
    const withCover = posts.filter((p) => p.coverImage && !p.ogImage);
    const offered = withCover.filter((p) => postCardImage(p));
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThan(withCover.length);
  });
});
