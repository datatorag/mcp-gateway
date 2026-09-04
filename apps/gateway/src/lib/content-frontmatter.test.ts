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

  it.each(files)("%s has a well-formed faqs block, if it has one", (file) => {
    // A half-written entry renders nothing on the page AND drops a Question out
    // of the JSON-LD, silently, in a way no other check would notice.
    const { data } = matter(readFileSync(join(CONTENT_ROOT, file), "utf8"));
    if (data.faqs === undefined) return;
    expect(Array.isArray(data.faqs), `${file}: faqs must be a list`).toBe(true);
    for (const entry of data.faqs as unknown[]) {
      expect(typeof entry, `${file}: each faq is a q/a mapping`).toBe("object");
      const { q, a } = entry as { q?: unknown; a?: unknown };
      expect(typeof q === "string" && q.trim() !== "").toBe(true);
      expect(typeof a === "string" && a.trim() !== "").toBe(true);
    }
  });

  it("rejects a malformed faqs entry", () => {
    // Mutation control for the case above. Without this, a walker that stopped
    // finding faqs blocks would pass every file by looking at nothing.
    const { data } = matter(
      ["---", 'title: "x"', "faqs:", "  - q: Only a question", "---", "b"].join("\n")
    );
    const entry = (data.faqs as { q?: unknown; a?: unknown }[])[0];
    expect(typeof entry.q === "string" && entry.q.trim() !== "").toBe(true);
    expect(typeof entry.a === "string").toBe(false);
  });

  it("every updatedNote has an updated date, and leading dates agree", () => {
    // Our own disclosure mechanism failing silently: the page renders the
    // visible Edited note only when BOTH fields are present, and dateModified
    // falls back to date. So a note with no `updated` means a factual
    // correction shipped with no reader-facing note and no dateModified bump.
    // Found three times in one sweep, on three different posts, which is a
    // missing guard rather than three slips.
    //
    // SCOPE, stated because a clean result gets read as broader than it is: the
    // date-agreement half only applies to notes that OPEN with a written date.
    // Most notes do not, and leading with one is not required.
    const MONTHS = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const leadingDate = new RegExp(`^(${MONTHS.join("|")}) (\\d{1,2}),? (\\d{4})`);

    const missing: string[] = [];
    const disagree: string[] = [];
    let checkedLeadingDates = 0;

    for (const file of files) {
      const { data } = matter(readFileSync(join(CONTENT_ROOT, file), "utf8"));
      const note = data.updatedNote;
      if (typeof note !== "string" || note.trim() === "") continue;
      const updated = data.updated;
      if (typeof updated !== "string" || updated.trim() === "") {
        missing.push(file);
        continue;
      }
      const m = leadingDate.exec(note);
      if (!m) continue;
      checkedLeadingDates += 1;
      const month = String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0");
      const day = m[2].padStart(2, "0");
      const iso = `${m[3]}-${month}-${day}`;
      if (iso !== updated) disagree.push(`${file}: updated=${updated} note=${iso}`);
    }

    // Guards the guard: if nothing leads with a date, the second assertion is
    // vacuous and reports clean by looking at nothing.
    expect(checkedLeadingDates).toBeGreaterThan(0);
    expect(missing, `updatedNote with no updated date:\n${missing.join("\n")}`).toEqual([]);
    expect(disagree, `updated disagrees with the note's own date:\n${disagree.join("\n")}`).toEqual([]);
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
