import { marked } from "marked";
import {
  defineCollection,
  field,
  type ContentFaq,
  type ParsedFile,
} from "./content-collection";

export type BlogFaq = ContentFaq;

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  /** ISO date of the latest edit to a published post; absent = never edited.
   * Feeds JSON-LD dateModified and the rendered "Edited" note. */
  updated?: string;
  /** One-line summary of what the latest edit changed, shown in the note. */
  updatedNote?: string;
  readTime: string;
  author: string;
  authorImage?: string;
  category?: string;
  ogImage?: string;
  coverImage?: string;
  tags: string[];
  /** Per-post questions and answers, rendered on the page and emitted as
   * FAQPage JSON-LD from the same strings. Empty for most posts. */
  faqs: BlogFaq[];
  content: string;
  html: string;
}

/** The page projection of an authored answer.
 *
 * `parseInline` on purpose: links and inline code work, block-level markdown
 * does not, so an answer stays one paragraph by construction. */
export function faqAnswerHtml(a: string): string {
  return marked.parseInline(a) as string;
}

/** Stable anchor for one question, derived from `q` and never hand-authored, so
 * it cannot disagree with the heading it labels. Deep-linkable answers give a
 * citing engine something more specific than the page. */
export function faqAnchor(q: string): string {
  const body = q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `faq-${body}`;
}

/** The JSON-LD projection of the same string.
 *
 * Plain text rather than the rendered HTML the site FAQ page embeds. The rich
 * result that made markup-in-answers worth tolerating was retired by Google on
 * 2026-05-07, and a machine consumer reading `acceptedAnswer.text` is better
 * served by prose than by anchor tags. Both projections are pure functions of
 * `a`, so neither can drift from the other or from the page. */
export function faqAnswerText(a: string): string {
  return a
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

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

export function getRelatedPosts(slug: string, limit = 3): BlogPost[] {
  const post = getPostBySlug(slug);
  if (!post || post.tags.length === 0) return [];

  const tagSet = new Set(post.tags);
  const all = getAllPosts();

  return all
    .filter((p) => p.slug !== slug && p.tags.some((t) => tagSet.has(t)))
    .sort((a, b) => {
      const aOverlap = a.tags.filter((t) => tagSet.has(t)).length;
      const bOverlap = b.tags.filter((t) => tagSet.has(t)).length;
      if (bOverlap !== aOverlap) return bOverlap - aOverlap;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    })
    .slice(0, limit);
}

function parsePost({ slug, data, content }: ParsedFile): BlogPost {
  const html = marked.parse(content) as string;

  const words = content.split(/\s+/).length;
  const readTime = `${Math.max(1, Math.ceil(words / 230))} min read`;

  return {
    slug,
    title: field.string(data.title, slug),
    excerpt: field.string(data.excerpt),
    date: field.string(data.date, new Date().toISOString().slice(0, 10)),
    updated: data.updated as string | undefined,
    updatedNote: data.updatedNote as string | undefined,
    readTime,
    author: field.string(data.author, "DataToRAG"),
    authorImage: data.authorImage as string | undefined,
    category: data.category as string | undefined,
    ogImage: data.ogImage as string | undefined,
    coverImage: data.coverImage as string | undefined,
    tags: field.stringArray(data.tags),
    faqs: field.faqList(data.faqs),
    content,
    html,
  };
}
