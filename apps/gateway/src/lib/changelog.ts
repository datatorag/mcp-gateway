import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";

const CHANGELOG_DIR = path.join(process.cwd(), "content", "changelog");

export interface ChangelogEntry {
  slug: string;
  title: string;
  date: string;
  tags: string[];
  connector?: string;
  content: string;
  html: string;
}

// Cache parsed entries since changelog content is static at deploy time
let entriesCache: ChangelogEntry[] | null = null;

export function getAllEntries(): ChangelogEntry[] {
  if (entriesCache) return entriesCache;

  if (!fs.existsSync(CHANGELOG_DIR)) return [];

  entriesCache = fs
    .readdirSync(CHANGELOG_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseEntry(f.replace(/\.md$/, "")))
    .filter((e): e is ChangelogEntry => e !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return entriesCache;
}

function parseEntry(slug: string): ChangelogEntry | null {
  const filePath = path.join(CHANGELOG_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const html = marked.parse(content) as string;

  return {
    slug,
    title: data.title ?? slug,
    date: data.date ?? new Date().toISOString().slice(0, 10),
    tags: Array.isArray(data.tags) ? data.tags : [],
    connector: data.connector,
    content,
    html,
  };
}
