/**
 * Does every content file's frontmatter actually parse?
 *
 * WHY THIS EXISTS. An unescaped pair of double quotes inside a double-quoted
 * YAML value ended the string early, the frontmatter stopped parsing, and the
 * production build died collecting page data for /blog/[slug]. `tsc` passed.
 * The entire unit suite passed. They would have passed for anyone, because
 * frontmatter is parsed when Next collects page data and NOWHERE ELSE — so the
 * production build was the only check in the repo that covered this class, and
 * on a repo with no CI that check runs only when a person types it. A
 * content-only change is exactly the kind where skipping the build feels safe.
 *
 * So the class moves into the suite, where it costs milliseconds and runs
 * whenever anything else does. This is a parser check, not a content check: it
 * asserts the file can be READ, and says nothing about whether what it says is
 * true. Claims are a person's job.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";

const CONTENT_ROOT = join(import.meta.dirname, "../../content");

/** Every markdown file under content/, relative to the root. */
function findMarkdown(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...findMarkdown(full, rel));
    else if (entry.endsWith(".md")) out.push(rel);
  }
  return out.sort();
}

const files = findMarkdown(CONTENT_ROOT);

describe("content frontmatter", () => {
  it("finds the content at all", () => {
    // A walker that silently matched nothing would make every case below
    // vacuously true, which is the failure this whole file exists to prevent
    // one level up.
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.startsWith("blog/"))).toBe(true);
  });

  it.each(files)("%s parses", (file) => {
    const raw = readFileSync(join(CONTENT_ROOT, file), "utf8");
    expect(
      () => matter(raw),
      `frontmatter does not parse, so the production build will fail collecting page data. ` +
        `The usual cause is an unescaped " inside a double-quoted value: escape it as \\" ` +
        `or wrap the value in single quotes.`
    ).not.toThrow();
  });

  it.each(files)("%s has a title", (file) => {
    // The one field every surface reads. A missing one renders an untitled
    // entry rather than failing, which is worse than failing.
    const { data } = matter(readFileSync(join(CONTENT_ROOT, file), "utf8"));
    expect(typeof data.title === "string" && data.title.trim() !== "").toBe(true);
  });

  it("catches the exact shape that broke the build", () => {
    // A guard that stops matching passes by failing to look, and clean content
    // would be indistinguishable from a broken checker. This pins that the
    // parser still rejects the real defect, using the real parser.
    const bad = [
      "---",
      'title: "x"',
      'note: "a phrase with "inner quotes" in it"',
      "---",
      "body",
    ].join("\n");
    expect(() => matter(bad)).toThrow();

    const fixed = bad.replace('"inner quotes"', '\\"inner quotes\\"');
    expect(() => matter(fixed)).not.toThrow();
  });
});
