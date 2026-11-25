import { marked } from "marked";
import { enhanceDocMedia } from "./docs-media";
import { SITE_NAME, SITE_URL } from "./site-schema";
import {
  defineCollection,
  field,
  type ContentFaq,
  type ParsedFile,
} from "./content-collection";

export type BlogFaq = ContentFaq;

export interface BlogPost {
  slug: string;
  /** The post's headline: the page's heading and the index card. */
  title: string;
  /** The teaser under the headline on the index card. */
  excerpt: string;
  /** What a search result and a link preview show as the title: the words
   * people search, then the brand, in 60 characters or fewer. Absent on a
   * post that has not written one; `postSearchTitle` gives the fallback. */
  searchTitle?: string;
  /** What a search result shows under the title: 120 to 160 characters that
   * say what the post answers. Absent on a post that has not written one;
   * `postSearchDescription` falls back to the excerpt. */
  searchDescription?: string;
  date: string;
  /** ISO date of the latest edit to a published post; absent = never edited.
   * Feeds JSON-LD dateModified and the rendered "Edited" note. */
  updated?: string;
  /** Every edit that changed what the post says, newest first, each opening
   * with its day. The page shows the newest and folds the rest
   * (`edit-note.ts`). */
  updatedNote?: string;
  readTime: string;
  author: string;
  authorImage?: string;
  category?: string;
  ogImage?: string;
  coverImage?: string;
  /** A looping cover animation (SCRUM-509): a site path with no extension,
   * with an .mp4 and a .webm at it. `coverImage` is its still. See
   * `cover-video.ts`. */
  coverVideo?: string;
  /** An animated SVG cover (SCRUM-509): a /blog/ path ending in .svg.
   * `coverImage` is its still; a post sets this or `coverVideo`, not both.
   * See `cover-animation.ts`. */
  coverAnimation?: string;
  /** What the cover shows, for a screen reader, when the title does not say
   * it. Used as the cover image's text alternative. */
  coverAlt?: string;
  tags: string[];
  /** A main post for its topic. The index lists these first, under "Start
   * here", when at least one post is marked. */
  pillar: boolean;
  /** Slugs of the posts to show as related, in order. They come before the
   * posts chosen by shared tags. A slug that names no post is a mistake a
   * test catches. */
  related: string[];
  /** Per-post questions and answers, rendered on the page and emitted as
   * FAQPage JSON-LD from the same strings. Empty for most posts. */
  faqs: BlogFaq[];
  content: string;
  html: string;
}

/* The FAQ projections moved to `faq.ts` when docs gained the same block. They
 * were never blog-specific, and a docs page importing them from here is how the
 * second copy starts. */

const collection = defineCollection<BlogPost>({
  dir: "blog",
  parse: parsePost,
  sort: (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
});

export function getAllPosts(): BlogPost[] {
  return collection.getAll();
}

export function getPostBySlug(slug: string): BlogPost | null {
  return collection.getBySlug(slug);
}

/** A post's own address. */
export const postUrl = (slug: string): string => `${SITE_URL}/blog/${slug}`;

/** The `<title>` of a post: its search title when it wrote one, else its
 * headline and the brand. */
export const postSearchTitle = (post: Pick<BlogPost, "title" | "searchTitle">): string =>
  post.searchTitle ?? `${post.title} | ${SITE_NAME}`;

/** The meta description of a post: its search description when it wrote
 * one, else its excerpt. */
export const postSearchDescription = (post: Pick<BlogPost, "excerpt" | "searchDescription">): string =>
  post.searchDescription ?? post.excerpt;

/** The day a post last changed: its latest edit, or the day it was
 * published. The page's "Edited" date, the structured data, the sitemap,
 * and the feed all read this one. */
export const postModified = (post: Pick<BlogPost, "date" | "updated">): string => post.updated ?? post.date;

/**
 * The posts shown under a post as related: the ones it names in `related`,
 * in the order it names them, then the posts that share the most tags with
 * it, newest first among equals, up to `limit`.
 */
export function getRelatedPosts(slug: string, limit = 3): BlogPost[] {
  const post = getPostBySlug(slug);
  if (!post) return [];

  const named = [...new Set(post.related)]
    .filter((s) => s !== slug)
    .flatMap((s) => getPostBySlug(s) ?? []);
  const taken = new Set([slug, ...named.map((p) => p.slug)]);

  const tagSet = new Set(post.tags);
  const byTags = getAllPosts()
    .filter((p) => !taken.has(p.slug) && p.tags.some((t) => tagSet.has(t)))
    .sort((a, b) => {
      const aOverlap = a.tags.filter((t) => tagSet.has(t)).length;
      const bOverlap = b.tags.filter((t) => tagSet.has(t)).length;
      if (bOverlap !== aOverlap) return bOverlap - aOverlap;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

  return [...named, ...byTags].slice(0, limit);
}

/** The main posts, newest first. Empty until a post sets `pillar`. */
export function getPillarPosts(): BlogPost[] {
  return getAllPosts().filter((p) => p.pillar);
}

function parsePost({ slug, data, content }: ParsedFile): BlogPost {
  const coverImage = data.coverImage as string | undefined;
  // Pictures in the body get their real size and load when the reader nears
  // them (`docs-media.ts`). The cover is the picture at the top of a post, so
  // a body picture loads at once only in a post with no cover.
  const html = enhanceDocMedia(marked.parse(content) as string, { eagerFirst: !coverImage });

  const words = content.split(/\s+/).length;
  const readTime = `${Math.max(1, Math.ceil(words / 230))} min read`;

  return {
    slug,
    title: field.string(data.title, slug),
    excerpt: field.string(data.excerpt),
    searchTitle: field.string(data.searchTitle).trim() || undefined,
    searchDescription: field.string(data.searchDescription).trim() || undefined,
    date: field.string(data.date, new Date().toISOString().slice(0, 10)),
    updated: data.updated as string | undefined,
    updatedNote: data.updatedNote as string | undefined,
    readTime,
    author: field.string(data.author, "DataToRAG"),
    authorImage: data.authorImage as string | undefined,
    category: data.category as string | undefined,
    ogImage: data.ogImage as string | undefined,
    coverImage,
    coverVideo: data.coverVideo as string | undefined,
    coverAnimation: data.coverAnimation as string | undefined,
    coverAlt: data.coverAlt as string | undefined,
    tags: field.stringArray(data.tags),
    pillar: data.pillar === true,
    related: field.stringArray(data.related),
    faqs: field.faqList(data.faqs),
    content,
    html,
  };
}
