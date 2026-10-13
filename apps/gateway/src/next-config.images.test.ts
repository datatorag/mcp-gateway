/**
 * The image optimizer's allow-list (next.config.ts) against what the site
 * really hands to `next/image`.
 *
 * Two directions, and both matter. Every local image the site shows has to
 * match the list, or it breaks in production and nowhere else. And nothing
 * under the download prefix may match, because the optimizer prints a path
 * it could not read as an image and a download link's credential is its
 * path (SCRUM-420).
 *
 * The sources are read from the code and the content, not listed here by
 * hand, and the matcher is the one the framework itself uses.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasLocalMatch } from "next/dist/shared/lib/match-local-pattern";
import nextConfig, { LOCAL_IMAGE_PATTERNS } from "../next.config";
import { walk } from "./gateway/admin-surface-walk";
import { getAllPosts } from "./lib/blog";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

/** Literal local `src` values in every component that imports next/image. */
function componentSources(): string[] {
  return walk(SRC, (f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .map((file) => readFileSync(join(SRC, file), "utf8"))
    .filter((text) => /from "next\/image"/.test(text))
    .flatMap((text) => [...text.matchAll(/\bsrc="(\/[^"]+)"/g)].map((m) => m[1]));
}

/** Blog covers, author pictures and the figures in a post's body: all of
 * these reach next/image through a prop, so no scan of the components can
 * see their values. */
function blogSources(): string[] {
  return getAllPosts().flatMap((post) => [
    ...[post.coverImage, post.authorImage].filter((src): src is string => !!src?.startsWith("/")),
    ...[...post.content.matchAll(/!\[[^\]]*\]\((\/[^)\s]+)/g)].map((m) => m[1]),
  ]);
}

const matches = (path: string) => hasLocalMatch(LOCAL_IMAGE_PATTERNS, path);

describe("the image optimizer's allow-list", () => {
  it("is the list the app is configured with", () => {
    expect(nextConfig.images?.localPatterns).toBe(LOCAL_IMAGE_PATTERNS);
    expect(LOCAL_IMAGE_PATTERNS.length).toBeGreaterThan(0);
  });

  it("covers every local image a component names, and each one exists", () => {
    const sources = [...new Set(componentSources())];
    // Not vacuous: the logo is named in several components.
    expect(sources).toContain("/datatorag-logo-256.png");
    for (const src of sources) {
      expect(matches(src), `${src} is given to next/image and is not in LOCAL_IMAGE_PATTERNS`).toBe(true);
      expect(existsSync(join(ROOT, "public", src)), `${src} is not in public/`).toBe(true);
    }
  });

  it("covers every cover, author picture and figure of the blog, and each one exists", () => {
    const sources = [...new Set(blogSources())];
    expect(sources.length).toBeGreaterThan(10);
    for (const src of sources) {
      expect(matches(src), `${src} is shown by the blog and is not in LOCAL_IMAGE_PATTERNS`).toBe(true);
      expect(existsSync(join(ROOT, "public", src)), `${src} is not in public/`).toBe(true);
    }
  });

  it.each([
    "/files/d/AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    "/files/x/../d/AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    "/fi\tles/d/token",
    "/foo/AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    "/AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    "/blog/../files/d/token",
    "/files",
    "/api/me",
    "/dashboard",
    "/mcp",
    "/datatorag-logo-256.png?x=/files/d/token",
  ])("does not let the optimizer fetch %j", (path) => {
    expect(matches(path)).toBe(false);
  });
});
