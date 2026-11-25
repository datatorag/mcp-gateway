import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAllDocs } from "./docs";
import { DOCS_DATES_FILE, docsLastChanged, gitHistoryAvailable, today } from "./docs-dates";

/* The date a docs page shows, sends as the sitemap's lastmod, and states as
   dateModified is one value: its entry in content/docs-dates.json, written
   by `pnpm docs:dates` from git. Nothing that serves a page can ask git (the
   image has no .git, CI has one commit), so the manifest is checked in and
   this test is what keeps it true. */

const cwd = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(cwd, DOCS_DATES_FILE), "utf8")) as Record<string, string>;
const docs = getAllDocs();
const RERUN = "Run `pnpm docs:dates` in apps/gateway and commit content/docs-dates.json.";

describe("docs dates manifest", () => {
  it("has a date for every docs page, and for nothing else", () => {
    expect(docs.length).toBeGreaterThan(10);
    const slugs = docs.map((d) => d.slug).sort();
    expect(Object.keys(manifest).sort(), RERUN).toEqual(slugs);
    for (const [slug, date] of Object.entries(manifest)) {
      expect(date, slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(`${date}T00:00:00`).getTime()), slug).toBe(false);
    }
  });

  it("is what every page loads as its date", () => {
    for (const doc of docs) expect(doc.updated, doc.slug).toBe(manifest[doc.slug]);
  });

  // Only a checkout with its whole history can say when a file last changed.
  // CI checks out one commit, and there every file would read as that day.
  it.skipIf(!gitHistoryAvailable(cwd))(
    "holds no date older than the page's last change in git (today, for a page with changes not committed)",
    () => {
      const changed = docsLastChanged(cwd);
      const stale = Object.entries(changed)
        .filter(([slug, date]) => date !== null && (manifest[slug] ?? "") < date)
        .map(([slug, date]) => `${slug}: manifest ${manifest[slug] ?? "none"}, changed ${date}`);
      expect(stale, RERUN).toEqual([]);
    }
  );

  it.skipIf(!gitHistoryAvailable(cwd))("holds no date after today", () => {
    const ahead = Object.entries(manifest).filter(([, date]) => date > today());
    expect(ahead, RERUN).toEqual([]);
  });
});
