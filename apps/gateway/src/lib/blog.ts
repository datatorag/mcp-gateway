import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";

const BLOG_DIR = path.join(process.cwd(), "content", "blog");

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

// Cache parsed posts since blog content is static at deploy time
let postsCache: BlogPost[] | null = null;
const postsBySlug = new Map<string, BlogPost>();

export function getAllPosts(): BlogPost[] {
  if (postsCache) return postsCache;

  if (!fs.existsSync(BLOG_DIR)) return [];

  postsCache = fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parsePost(f.replace(/\.md$/, "")))
    .filter((p): p is BlogPost => p !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  for (const post of postsCache) postsBySlug.set(post.slug, post);
  return postsCache;
}

export function getPostBySlug(slug: string): BlogPost | null {
  if (!postsCache) getAllPosts();
  return postsBySlug.get(slug) ?? null;
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

function parsePost(slug: string): BlogPost | null {
  const filePath = path.join(BLOG_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const html = marked.parse(content) as string;

  const words = content.split(/\s+/).length;
  const readTime = `${Math.max(1, Math.ceil(words / 230))} min read`;

  return {
    slug,
    title: data.title ?? slug,
    excerpt: data.excerpt ?? "",
    date: data.date ?? new Date().toISOString().slice(0, 10),
    updated: data.updated,
    updatedNote: data.updatedNote,
    readTime,
    author: data.author ?? "DataToRAG",
    authorImage: data.authorImage,
    category: data.category,
    ogImage: data.ogImage,
    coverImage: data.coverImage,
    tags: Array.isArray(data.tags) ? data.tags : [],
    content,
    html,
  };
}
