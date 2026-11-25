// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { getAllPosts, postSearchDescription } from "./blog";
import { BLOG_FEED_URL, blogFeedXml, xmlEscape } from "./blog-feed";
import { GET } from "@/app/blog/feed.xml/route";

/* The blog's feed: RSS 2.0, every post, newest first. Parsed as XML, so a
   character that needed escaping fails here. */

const posts = getAllPosts();
const xml = blogFeedXml();
const doc = new DOMParser().parseFromString(xml, "application/xml");
const text = (parent: Element | Document, name: string) => parent.querySelector(name)?.textContent ?? null;
const items = [...doc.querySelectorAll("channel > item")];

describe("the blog feed", () => {
  it("is well-formed XML with one channel", () => {
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"')).toBe(true);
    expect(doc.querySelectorAll("rss > channel")).toHaveLength(1);
  });

  it("names the blog, its address, and itself", () => {
    const channel = doc.querySelector("channel")!;
    expect(text(channel, ":scope > title")).toBe("DataToRAG blog");
    expect(text(channel, ":scope > link")).toBe("https://datatorag.com/blog");
    expect(text(channel, ":scope > description")!.length).toBeGreaterThan(50);
    const self = [...channel.children].find((c) => c.tagName === "atom:link")!;
    expect(self.getAttribute("href")).toBe(BLOG_FEED_URL);
    expect(BLOG_FEED_URL).toBe("https://datatorag.com/blog/feed.xml");
    expect(self.getAttribute("rel")).toBe("self");
    expect(self.getAttribute("type")).toBe("application/rss+xml");
  });

  it("holds every post exactly once, newest first, each with an absolute link", () => {
    expect(posts.length).toBeGreaterThan(40);
    expect(items.map((i) => text(i, "link"))).toEqual(posts.map((p) => `https://datatorag.com/blog/${p.slug}`));
    const dates = items.map((i) => new Date(text(i, "pubDate")!).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("each item carries its title, link, id, day, and description", () => {
    items.forEach((item, i) => {
      const post = posts[i];
      expect(text(item, "title"), post.slug).toBe(post.title);
      expect(text(item, "guid"), post.slug).toBe(`https://datatorag.com/blog/${post.slug}`);
      expect(item.querySelector("guid")!.getAttribute("isPermaLink")).toBe("true");
      expect(text(item, "pubDate"), post.slug).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} 00:00:00 GMT$/);
      expect(new Date(text(item, "pubDate")!).toISOString().slice(0, 10), post.slug).toBe(post.date);
      expect(text(item, "description"), post.slug).toBe(postSearchDescription(post));
      expect(text(item, "description")!.length, post.slug).toBeGreaterThan(0);
    });
  });

  it("escapes what XML reserves", () => {
    expect(xmlEscape(`Docs & Sheets <b> "it's"`)).toBe("Docs &amp; Sheets &lt;b&gt; &quot;it&apos;s&quot;");
    expect(xmlEscape("a\u0000b\u000Bc")).toBe("abc");
    // The posts themselves need it, so the parse above is a real check.
    expect(posts.some((p) => /[&<>]/.test(`${p.title}${postSearchDescription(p)}`)) || xml.includes("&apos;") || xml.includes("&quot;")).toBe(true);
  });

  it("is answered as RSS", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expect(await res.text()).toBe(xml);
  });
});
