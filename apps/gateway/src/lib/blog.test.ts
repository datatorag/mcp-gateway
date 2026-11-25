import { describe, expect, it } from "vitest";
import { getAllPosts, getPillarPosts, getPostBySlug, getRelatedPosts, postModified, postSearchDescription, postSearchTitle } from "./blog";

/* What every post says about itself to a search result, and which posts it
   points a reader to next. Read from the posts as published. */

const posts = getAllPosts();

describe("a post's search title and description", () => {
  it("has posts to read", () => {
    expect(posts.length).toBeGreaterThan(40);
  });

  it("fall back to the headline with the brand, and to the excerpt", () => {
    expect(postSearchTitle({ title: "A headline" })).toBe("A headline | DataToRAG");
    expect(postSearchTitle({ title: "A headline", searchTitle: "Words People Search | DataToRAG" })).toBe("Words People Search | DataToRAG");
    expect(postSearchDescription({ excerpt: "The teaser." })).toBe("The teaser.");
    expect(postSearchDescription({ excerpt: "The teaser.", searchDescription: "What the post answers." })).toBe("What the post answers.");
  });

  it("a written search title fits in what a result shows: 60 characters or fewer", () => {
    const long = posts.filter((p) => p.searchTitle && p.searchTitle.length > 60).map((p) => `${p.slug} (${p.searchTitle!.length})`);
    expect(long).toEqual([]);
  });

  it("a written search description is 120 to 160 characters", () => {
    const off = posts
      .filter((p) => p.searchDescription && (p.searchDescription.length < 120 || p.searchDescription.length > 160))
      .map((p) => `${p.slug} (${p.searchDescription!.length})`);
    expect(off).toEqual([]);
  });

  it("no two posts share a title", () => {
    const titles = posts.map(postSearchTitle);
    expect(titles.filter((t, i) => titles.indexOf(t) !== i)).toEqual([]);
  });
});

describe("related posts", () => {
  it("every slug a post names is a post, and not itself", () => {
    const wrong = posts.flatMap((p) => p.related.filter((slug) => slug === p.slug || !getPostBySlug(slug)).map((slug) => `${p.slug} names ${slug}`));
    expect(wrong).toEqual([]);
  });

  it("the posts a post names come first, in its order; shared tags fill the rest", () => {
    for (const post of posts.filter((p) => p.related.length > 0)) {
      const named = [...new Set(post.related)].slice(0, 3);
      expect(getRelatedPosts(post.slug).slice(0, named.length).map((p) => p.slug), post.slug).toEqual(named);
    }
    for (const post of posts) {
      const related = getRelatedPosts(post.slug);
      expect(related.length, post.slug).toBeLessThanOrEqual(3);
      expect(related.map((p) => p.slug), post.slug).not.toContain(post.slug);
      expect(new Set(related.map((p) => p.slug)).size, post.slug).toBe(related.length);
    }
  });

  it("a post that names none gets the posts sharing the most tags, newest first among equals", () => {
    const post = posts.find((p) => p.related.length === 0 && p.tags.length > 0)!;
    const overlap = (slug: string) => getPostBySlug(slug)!.tags.filter((t) => post.tags.includes(t)).length;
    const related = getRelatedPosts(post.slug);
    expect(related.length).toBeGreaterThan(0);
    for (const r of related) expect(overlap(r.slug)).toBeGreaterThan(0);
    const counts = related.map((r) => overlap(r.slug));
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("an unknown post has none", () => {
    expect(getRelatedPosts("no-such-post")).toEqual([]);
  });
});

describe("the main posts and the modified day", () => {
  it("the main posts are the ones marked, newest first", () => {
    expect(getPillarPosts().map((p) => p.slug)).toEqual(posts.filter((p) => p.pillar).map((p) => p.slug));
  });

  it("a post's modified day is its latest edit, or the day it was published", () => {
    expect(postModified({ date: "2026-04-05", updated: "2026-11-25" })).toBe("2026-11-25");
    expect(postModified({ date: "2026-04-05" })).toBe("2026-04-05");
  });

  it("a picture in a post's body states its size and waits for the reader when the post has a cover", () => {
    const withPictures = posts.filter((p) => p.coverImage && /<img\b/.test(p.html));
    expect(withPictures.length).toBeGreaterThan(5);
    for (const post of withPictures) {
      for (const tag of post.html.match(/<img\b[^>]*>/g)!) {
        expect(tag, post.slug).toContain('loading="lazy"');
        if (/\ssrc="\/blog\/[^"]+\.(png|jpe?g|gif|webp)"/.test(tag)) expect(tag, post.slug).toMatch(/\swidth="\d+" height="\d+"/);
      }
    }
  });
});
