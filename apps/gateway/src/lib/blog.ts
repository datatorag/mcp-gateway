import { marked } from "marked";
import { defineCollection, field, type ParsedFile } from "./content-collection";

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
  content: string;
  html: string;
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
    content,
    html,
  };
}
