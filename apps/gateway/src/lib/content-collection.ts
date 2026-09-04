import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

/** The markdown-in-repo loader every content collection shares.
 *
 * Blog, changelog, docs and skills each had their own verbatim copy of this
 * read-dir → parse → sort → cache dance, and the copies drifted (one read
 * `order` with `??`, another with a typeof check). This is the one loader;
 * each collection still owns its own type, its own frontmatter contract and
 * its own parse function, which is the part that should differ.
 *
 * Content is static at deploy time, so the parsed list is cached at module
 * level and a markdown edit does nothing on a running server — it needs a
 * restart or redeploy (dev-server hot reload aside).
 */
export interface Collection<T extends { slug: string }> {
  getAll: () => T[];
  getBySlug: (slug: string) => T | null;
}

/** One authored question and its answer.
 *
 * `a` is markdown. It is the ONE definition: the page renders it to HTML and the
 * JSON-LD carries it flattened to plain text, both derived by pure functions, so
 * there is no second copy to drift. Answers live in frontmatter rather than in a
 * sibling file deliberately: the frontmatter-parse guard and the retention-claim
 * sweep both scan `content/**\/*.md` by extension, and an FAQ answer is exactly
 * the kind of prose that makes a retention or capability claim. A new directory
 * would escape both guards with no failing test to say so. */
export interface ContentFaq {
  q: string;
  a: string;
}

export interface ParsedFile {
  slug: string;
  /** Frontmatter, as gray-matter returned it. */
  data: Record<string, unknown>;
  /** Body markdown, frontmatter stripped. */
  content: string;
  /** The whole file, for parsers that need the source verbatim (skills lift
   * the copy payload out of it — a rendering is not the data). */
  raw: string;
}

export function defineCollection<T extends { slug: string }>(opts: {
  /** Directory name under `content/`. */
  dir: string;
  /** Turn one parsed file into the collection's own type; return null to
   * exclude it (a file missing something the type requires). */
  parse: (file: ParsedFile) => T | null;
  /** Applied once, at load. */
  sort?: (a: T, b: T) => number;
}): Collection<T> {
  const dirPath = path.join(process.cwd(), "content", opts.dir);
  let cache: T[] | null = null;
  const bySlug = new Map<string, T>();

  function getAll(): T[] {
    if (cache) return cache;
    if (!fs.existsSync(dirPath)) return [];

    const items = fs
      .readdirSync(dirPath)
      .filter((f) => f.endsWith(".md"))
      .map((file) => {
        const slug = file.replace(/\.md$/, "");
        const raw = fs.readFileSync(path.join(dirPath, file), "utf-8");
        const { data, content } = matter(raw);
        return opts.parse({ slug, data: data as Record<string, unknown>, content, raw });
      })
      .filter((item): item is T => item !== null);

    cache = opts.sort ? items.sort(opts.sort) : items;
    for (const item of cache) bySlug.set(item.slug, item);
    return cache;
  }

  return {
    getAll,
    getBySlug(slug: string) {
      if (!cache) getAll();
      return bySlug.get(slug) ?? null;
    },
  };
}

/** Frontmatter readers, so a field means the same thing in every collection
 * (`order` was read two different ways before this). */
export const field = {
  string: (v: unknown, fallback = ""): string =>
    typeof v === "string" ? v : fallback,
  number: (v: unknown, fallback: number): number =>
    typeof v === "number" ? v : fallback,
  stringArray: (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String) : [],
  /** Discards a malformed entry rather than coercing it, matching
   * `stringArray`. A half-written FAQ renders nothing, which is visible; a
   * coerced one would render `[object Object]` into a page AND into JSON-LD. */
  faqList: (v: unknown): ContentFaq[] =>
    Array.isArray(v)
      ? v.flatMap((entry) => {
          if (typeof entry !== "object" || entry === null) return [];
          const { q, a } = entry as { q?: unknown; a?: unknown };
          if (typeof q !== "string" || q.trim() === "") return [];
          if (typeof a !== "string" || a.trim() === "") return [];
          return [{ q: q.trim(), a: a.trim() }];
        })
      : [],
};
