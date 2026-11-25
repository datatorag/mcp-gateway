import { Marked } from "marked";

/**
 * A post's edit note, read as the list of edits it is.
 *
 * `updatedNote` in a post's frontmatter is one line that holds every edit the
 * post has had, newest first, each opening with the day it was made
 * ("November 25, 2026: ... October 19, 2026: ..."). The page shows the newest
 * in full and folds the rest away, so the line is split here, once, for the
 * page and for the post's Markdown copy.
 *
 * An entry opens at the start of the note, or after the end of a sentence,
 * with one of two things: a day and a colon, with a few words allowed
 * between them ("November 25, 2026, second pass:"), or the word "Earlier"
 * followed by a comma or a colon, which is how the oldest notes mark what
 * came before them. A day in the middle of a sentence ("what changed on
 * August 24, 2026: ...") opens nothing. A note with no such opening is one
 * entry.
 */

export interface EditNoteEntry {
  /** The day the entry opens with, as written ("November 25, 2026"), or
   * null when it opens with no day. */
  date: string | null;
  /** The entry's words as written, its opening day included. */
  text: string;
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const DAY = `(?:${MONTHS}) \\d{1,2}, \\d{4}`;
const DAY_LABEL = `${DAY}(?:,[^:.]{1,40})?:\\s`;
const EARLIER_LABEL = "(?:Earlier|EARLIER)[,:]\\s";
const ENTRY_START = new RegExp(`(?:^|(?<=[.!?]["')\\]]?\\s))(?=${DAY_LABEL}|${EARLIER_LABEL})`, "g");
const LEADING_DAY = new RegExp(`^(${DAY})(?=[,:])`);

export function splitEditNote(note: string): EditNoteEntry[] {
  const text = note.replace(/\s+/g, " ").trim();
  if (text === "") return [];
  const starts = [...new Set([0, ...[...text.matchAll(ENTRY_START)].map((m) => m.index)])];
  return starts.map((start, i) => {
    const entry = text.slice(start, starts[i + 1] ?? text.length).trim();
    return { date: entry.match(LEADING_DAY)?.[1] ?? null, text: entry };
  });
}

/**
 * What follows "Edited <day>" for the newest entry, so the day is printed
 * once. An entry that opens with the day shown gives up that day and keeps
 * the rest (": the table ..." or ", second pass: ..."). Any other entry is
 * kept whole behind a colon.
 */
export function afterEditedDate(entry: EditNoteEntry, shownDate: string): string {
  return entry.date === shownDate ? entry.text.slice(shownDate.length) : `: ${entry.text}`;
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* Links and inline code in a note render; a raw tag in one is shown as the
   characters it is, never as markup. */
/** Whether a note's link may be followed: this site's own pages and
 * sections, or an https address. Anything else is written out as text. */
const SAFE_HREF = /^(https:\/\/|\/(?!\/)|#)/;

const inline = new Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),
    // A note is words: an image in one is written out as its text.
    image: ({ text }) => escapeHtml(text),
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (!SAFE_HREF.test(href)) return label;
      return `<a href="${escapeHtml(href).replace(/"/g, "&quot;")}">${label}</a>`;
    },
  },
});

/** A note's words as HTML: one run of text, with its links and inline code. */
export function editNoteHtml(text: string): string {
  return inline.parseInline(text) as string;
}
