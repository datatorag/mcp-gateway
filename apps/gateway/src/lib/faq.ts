import { marked } from "marked";
import type { ContentFaq } from "./content-collection";

/** Per-page questions and answers, shared by every surface that publishes them.
 *
 * These projections started life in `blog.ts`, which was right while the blog
 * was the only surface with FAQs. Docs now render the same block, and a docs
 * page importing from `blog.ts` would be the first step toward a second copy.
 * Nothing here knows what collection an answer came from, which is the property
 * that lets one guard walk every source (see `faq.test.ts`).
 *
 * `a` is markdown and it is the ONE definition. The page derives HTML from it,
 * the JSON-LD derives plain text from it, both by pure functions, so there is no
 * second copy of an answer anywhere and the two cannot disagree.
 */

/** The page projection of an authored answer.
 *
 * `parseInline` on purpose: links and inline code work, block-level markdown
 * does not, so an answer stays one paragraph by construction. */
export function faqAnswerHtml(a: string): string {
  return marked.parseInline(a) as string;
}

/** Stable anchor for one question, derived from `q` and never hand-authored, so
 * it cannot disagree with the heading it labels. Deep-linkable answers give a
 * citing engine something more specific than the page. */
export function faqAnchor(q: string): string {
  const body = q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `faq-${body}`;
}

/** The JSON-LD projection of the same string.
 *
 * Plain text rather than the rendered HTML the site FAQ page embeds. The rich
 * result that made markup-in-answers worth tolerating was retired by Google on
 * 2026-05-07, and a machine consumer reading `acceptedAnswer.text` is better
 * served by prose than by anchor tags. Both projections are pure functions of
 * `a`, so neither can drift from the other or from the page. */
export function faqAnswerText(a: string): string {
  return a
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** One authored question and answer, tagged with where it came from.
 *
 * The `source` is what makes a per-source positive control possible: a walk that
 * silently stops resolving one collection returns fewer entries and is otherwise
 * indistinguishable from a collection that legitimately has no FAQs yet. */
export interface FaqEntry extends ContentFaq {
  /** Registered source name, e.g. `"blog"`. */
  source: string;
  /** Where inside that source, e.g. a filename. Used in failure messages so a
   * red guard names the file to open rather than only the question. */
  where: string;
}
