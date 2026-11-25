/**
 * A stable address for every section of a docs page.
 *
 * Markdown gives `<h2>Text</h2>` with no id, so a section could not be linked
 * or cited. Each h2 and h3 in a docs page's rendered HTML gets an `id` made
 * from its own words, and a link to itself beside it.
 *
 * The id is derived when the page is rendered and stored nowhere, so it
 * follows the heading: reword a heading and its address changes with it.
 * A heading repeated on one page gets `-2`, `-3`, and so on, in page order.
 *
 * The link sits beside the heading, not inside it, the way the questions
 * block does it (`components/faq-section.tsx`): the heading's text stays the
 * section's name alone, the link's mark is hidden from assistive technology
 * and its label is its name. Styled by `.docs-heading` in `globals.css`.
 */

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** A heading's words: its HTML without tags, entities read back as text. */
export function headingText(innerHtml: string): string {
  return innerHtml
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      const lower = name.toLowerCase();
      if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
      return NAMED_ENTITIES[lower] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** The id for a heading's words: lowercase ASCII letters and digits joined
 * by single hyphens. An accent is dropped from its letter, an apostrophe
 * joins its word ("What's new" is `whats-new`), and anything else becomes a
 * break. A heading with no letter or digit at all is `section`. */
export function headingSlug(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['‘’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

const escapeAttribute = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const HEADING = /<(h[23])((?:\s[^>]*)?)>([\s\S]*?)<\/\1>/gi;
const ID_ATTRIBUTE = /\sid="([^"]*)"/i;

export interface DocHeading {
  level: 2 | 3;
  id: string;
  text: string;
}

/** Give every h2 and h3 in `html` an id and a link to itself, and report
 * them in page order. A heading that already states an id (written as HTML
 * in the page) keeps it and is left as it is; the ids made here never repeat
 * one of those, or each other. */
export function anchorDocHeadings(html: string): { html: string; headings: DocHeading[] } {
  const used = new Set<string>();
  for (const match of html.matchAll(HEADING)) {
    const own = match[2].match(ID_ATTRIBUTE)?.[1];
    if (own) used.add(own);
  }

  const headings: DocHeading[] = [];
  const out = html.replace(HEADING, (whole: string, tag: string, attributes: string, inner: string) => {
    const level = tag.toLowerCase() === "h2" ? 2 : 3;
    const text = headingText(inner);
    const own = attributes.match(ID_ATTRIBUTE)?.[1];
    if (own) {
      headings.push({ level, id: own, text });
      return whole;
    }
    const base = headingSlug(text);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    headings.push({ level, id, text });
    return (
      `<div class="docs-heading"><${tag}${attributes} id="${id}">${inner}</${tag}>` +
      `<a class="docs-heading-link" href="#${id}" aria-label="Link to: ${escapeAttribute(text)}"><span aria-hidden="true">#</span></a></div>`
    );
  });
  return { html: out, headings };
}

/** The docs loader's hook: the HTML with its headings addressed. */
export function addHeadingAnchors(html: string): string {
  return anchorDocHeadings(html).html;
}
