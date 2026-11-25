import { describe, expect, it } from "vitest";
import { getAllPosts } from "./blog";
import { afterEditedDate, editNoteHtml, splitEditNote } from "./edit-note";
import { formatContentDate } from "./utils";

/* A post's edit note is one line holding every edit, newest first. These
   rules hold the split the page and the Markdown copy both read. */

describe("splitting an edit note into its entries", () => {
  it("a note with no day is one entry", () => {
    expect(splitEditNote("Fixed three links. Two pointed at a page that moved.")).toEqual([
      { date: null, text: "Fixed three links. Two pointed at a page that moved." },
    ]);
    expect(splitEditNote("  ")).toEqual([]);
  });

  it("each day that opens a sentence opens an entry, newest first as written", () => {
    const note = "November 25, 2026: the table is corrected. It said No. November 17, 2026: dropped a figure. October 19, 2026: one row added.";
    expect(splitEditNote(note)).toEqual([
      { date: "November 25, 2026", text: "November 25, 2026: the table is corrected. It said No." },
      { date: "November 17, 2026", text: "November 17, 2026: dropped a figure." },
      { date: "October 19, 2026", text: "October 19, 2026: one row added." },
    ]);
  });

  it("a day inside a sentence opens nothing", () => {
    const note = "November 25, 2026: the section now says what changed on August 24, 2026: the widest grant is promoted. As of November 25, 2026, the row is gone.";
    expect(splitEditNote(note)).toHaveLength(1);
  });

  it("a day may carry a few words before its colon, and the same day may open two entries", () => {
    const entries = splitEditNote("November 25, 2026, second pass: re-read every page. November 25, 2026: two rows corrected.");
    expect(entries.map((e) => e.date)).toEqual(["November 25, 2026", "November 25, 2026"]);
    expect(entries[0].text).toBe("November 25, 2026, second pass: re-read every page.");
  });

  it('"Earlier" opens an entry too, as the oldest notes write it', () => {
    const entries = splitEditNote("November 25, 2026: eighth note. Rows corrected. Earlier, seventh note, one row is removed. EARLIER: Corrected as pricing firmed up. Earlier versions said otherwise.");
    expect(entries.map((e) => e.text)).toEqual([
      "November 25, 2026: eighth note. Rows corrected.",
      "Earlier, seventh note, one row is removed.",
      "EARLIER: Corrected as pricing firmed up. Earlier versions said otherwise.",
    ]);
    expect(entries.slice(1).map((e) => e.date)).toEqual([null, null]);
  });

  it("loses no words", () => {
    for (const post of getAllPosts().filter((p) => p.updatedNote)) {
      const note = post.updatedNote!.replace(/\s+/g, " ").trim();
      expect(splitEditNote(note).map((e) => e.text).join(" "), post.slug).toBe(note);
    }
  });
});

describe("printing the day once", () => {
  it("an entry that opens with the day shown gives it up", () => {
    const [entry] = splitEditNote("November 25, 2026: the table is corrected.");
    expect(afterEditedDate(entry, "November 25, 2026")).toBe(": the table is corrected.");
    const [second] = splitEditNote("November 25, 2026, second pass: re-read.");
    expect(afterEditedDate(second, "November 25, 2026")).toBe(", second pass: re-read.");
  });

  it("an entry with no day, or another day, is kept whole", () => {
    expect(afterEditedDate({ date: null, text: "Fixed three links." }, "August 12, 2026")).toBe(": Fixed three links.");
    const [entry] = splitEditNote("November 17, 2026: dropped a figure.");
    expect(afterEditedDate(entry, "November 25, 2026")).toBe(": November 17, 2026: dropped a figure.");
  });
});

describe("a note's words as HTML", () => {
  it("renders links and inline code, and shows a raw tag as text", () => {
    expect(editNoteHtml("See [the post](/blog/x) and `jira_get_issue`.")).toBe('See <a href="/blog/x">the post</a> and <code>jira_get_issue</code>.');
    expect(editNoteHtml("the <title> tag")).toBe("the &lt;title&gt; tag");
    expect(editNoteHtml("<script>x</script>")).not.toContain("<script");
  });
});

describe("the notes as published", () => {
  const noted = getAllPosts().filter((p) => p.updated && p.updatedNote);

  it("has notes to read, some with earlier entries", () => {
    expect(noted.length).toBeGreaterThan(10);
    expect(noted.filter((p) => splitEditNote(p.updatedNote!).length > 1).length).toBeGreaterThan(5);
  });

  it("a note that opens with a day opens with the day the post was last edited", () => {
    // The page prints `updated` as the "Edited" day and the structured data
    // states it as the modified date. A newest entry dated another day would
    // put two different days side by side.
    const wrong = noted.flatMap((p) => {
      const [latest] = splitEditNote(p.updatedNote!);
      return latest.date !== null && latest.date !== formatContentDate(p.updated!) ? [`${p.slug}: note opens ${latest.date}, updated is ${p.updated}`] : [];
    });
    expect(wrong).toEqual([]);
  });

  it("follows only this site's links and https addresses, and renders no image", () => {
    expect(editNoteHtml("see [the docs](/docs/gmail) and [a page](https://example.com/a)")).toContain('<a href="/docs/gmail">the docs</a>');
    expect(editNoteHtml("[a page](https://example.com/a)")).toContain('<a href="https://example.com/a">a page</a>');
    for (const bad of ["[x](javascript:alert(1))", "[x](data:text/html,hi)", "[x](//example.com)", "<javascript:alert(1)>"]) {
      expect(editNoteHtml(bad), bad).not.toMatch(/<a\s/);
    }
    expect(editNoteHtml("![alt words](https://example.com/a.png)")).not.toMatch(/<img/);
  });
});
