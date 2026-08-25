import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPostBySlug } from "./blog";
import { getDocBySlug } from "./docs";
import { getSkillBySlug } from "./skills";
import {
  SHARE_LINKS,
  SHARE_MEDIUM,
  SHARE_SOURCE,
  UNKNOWN_CAMPAIGN,
  resolveShareLink,
} from "./share-links";

/**
 * Does `target` (a site-relative path) actually render? Content routes are
 * answered by the same collection libs the pages use, so a renamed blog slug
 * fails here the day it is renamed. Everything else must have a `page.tsx`
 * at the matching spot under `src/app`.
 */
function routeExists(target: string): boolean {
  const blog = target.match(/^\/blog\/([^/]+)$/);
  if (blog) return getPostBySlug(blog[1]) !== null;
  const doc = target.match(/^\/docs\/([^/]+)$/);
  if (doc) return getDocBySlug(doc[1]) !== null;
  const skill = target.match(/^\/skills\/([^/]+)$/);
  if (skill) return getSkillBySlug(skill[1]) !== null;
  const dir = target === "/" ? "" : target.replace(/^\//, "");
  return fs.existsSync(path.join(process.cwd(), "src/app", dir, "page.tsx"));
}

function query(location: string): URLSearchParams {
  return new URL(location, "https://example.invalid").searchParams;
}

function pathname(location: string): string {
  return new URL(location, "https://example.invalid").pathname;
}

describe("SHARE_LINKS map", () => {
  it("has at least the launch set", () => {
    for (const slug of ["saas", "help", "gmail", "multi-account", "drive", "triage", "what"]) {
      expect(SHARE_LINKS, `missing /r/${slug}`).toHaveProperty(slug);
    }
  });

  it("every mapped target resolves to a real route", () => {
    // A broken share link is worse than an untagged one, and this is exactly
    // the kind of map that rots when a blog slug is renamed.
    for (const [slug, link] of Object.entries(SHARE_LINKS)) {
      expect(routeExists(link.to), `/r/${slug} -> ${link.to} does not exist`).toBe(true);
    }
  });

  it("targets are bare site-relative paths", () => {
    // The resolver appends the utm query itself; a target carrying its own
    // query or hash would produce a second `?`. And `//host` is
    // protocol-relative, which a browser treats as a different origin.
    for (const [slug, link] of Object.entries(SHARE_LINKS)) {
      expect(link.to, slug).toMatch(/^\/(?!\/)/);
      expect(link.to, slug).not.toMatch(/[?#]/);
      expect(link.campaign, slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("slugs are lowercase kebab so they can be typed from memory", () => {
    for (const slug of Object.keys(SHARE_LINKS)) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe("resolveShareLink", () => {
  it("attaches the four utm parameters to a known slug's target", () => {
    const r = resolveShareLink("help");
    expect(r.known).toBe(true);
    expect(pathname(r.location)).toBe(SHARE_LINKS.help.to);
    const q = query(r.location);
    expect(q.get("utm_source")).toBe(SHARE_SOURCE);
    expect(q.get("utm_medium")).toBe(SHARE_MEDIUM);
    expect(q.get("utm_campaign")).toBe(SHARE_LINKS.help.campaign);
    expect(q.get("utm_content")).toBe("help");
  });

  it("keeps the location relative so no origin can leak into it", () => {
    for (const slug of [...Object.keys(SHARE_LINKS), "nope"]) {
      const { location } = resolveShareLink(slug);
      expect(location.startsWith("/")).toBe(true);
      expect(location).not.toMatch(/^https?:\/\//);
      expect(location).not.toMatch(/^\/\//);
    }
  });

  it("sends an unknown slug home with imprecise attribution, never nowhere", () => {
    const r = resolveShareLink("typo");
    expect(r.known).toBe(false);
    expect(pathname(r.location)).toBe("/");
    const q = query(r.location);
    expect(q.get("utm_source")).toBe(SHARE_SOURCE);
    expect(q.get("utm_medium")).toBe(SHARE_MEDIUM);
    expect(q.get("utm_campaign")).toBe(UNKNOWN_CAMPAIGN);
    expect(q.get("utm_content")).toBe("typo");
  });

  it("forgives case and surrounding whitespace, since comments are typed by hand", () => {
    expect(resolveShareLink("Help").known).toBe(true);
    expect(resolveShareLink(" help ").known).toBe(true);
    expect(pathname(resolveShareLink("GMAIL").location)).toBe(SHARE_LINKS.gmail.to);
  });

  it("never takes the target from input", () => {
    // Every one of these is the shape of an open-redirect attempt. The path
    // must be a mapped target or "/", whatever the slug looks like.
    const targets = new Set([...Object.values(SHARE_LINKS).map((l) => l.to), "/"]);
    for (const slug of [
      "https://evil.example",
      "//evil.example",
      "evil.example",
      "../dashboard",
      "help?to=https://evil.example",
      "help#https://evil.example",
      "help/../../etc",
      "saas\r\nLocation: https://evil.example",
      "",
    ]) {
      const { location } = resolveShareLink(slug);
      expect(targets.has(pathname(location)), JSON.stringify(slug)).toBe(true);
      expect(location).not.toContain("evil.example");
      expect(location).not.toMatch(/[\r\n]/);
    }
  });

  it("reflects only a tame form of an unknown slug into utm_content", () => {
    // The slug is user input. It rides along as a query VALUE (encoded, path
    // fixed), but it is still stored per user in the entry url, so anything
    // outside a short kebab token is replaced rather than passed through.
    expect(query(resolveShareLink("Gmial").location).get("utm_content")).toBe("gmial");
    expect(query(resolveShareLink("<script>").location).get("utm_content")).toBe("invalid");
    expect(query(resolveShareLink("a".repeat(200)).location).get("utm_content")).toBe(
      "invalid"
    );
    expect(query(resolveShareLink("").location).get("utm_content")).toBe("invalid");
  });
});
