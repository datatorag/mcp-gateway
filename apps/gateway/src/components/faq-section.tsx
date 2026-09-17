import type { ContentFaq } from "@/lib/content-collection";
import { faqAnchor, faqAnswerHtml } from "@/lib/faq";

/** The on-page FAQ block, shared by every surface that publishes one.
 *
 * Deliberately NOT an accordion: collapsed text is worse to extract from and the
 * block is short. Questions are real headings so a reader parsing document
 * structure finds them as questions, and each carries an id plus scroll-mt-28 so
 * a deep link is not hidden under the fixed navbar.
 *
 * THE ON-PAGE BLOCK IS THE DELIVERABLE, not the JSON-LD beside it. Google
 * retired the FAQ rich result on 2026-05-07, so nothing here wins a search
 * appearance; what an answer engine actually reads is this markup. If only one
 * half of a surface's FAQ work ships, it should be this half.
 *
 * Anchors are derived from `q` rather than authored, so a heading and its link
 * cannot disagree. The guard pins that they stay unique within a page.
 */

/** Type scale, and ONLY type scale.
 *
 * A closed set of two rather than class props, because the internals are where
 * the extraction properties live: heading levels, derived ids, self-links and
 * the refusal to collapse. Those do not vary and are not overridable. What does
 * vary is that a block under a blog post is a footnote to something else, while
 * on `/faq` the questions are the entire page and reading them at footnote size
 * would be worse. Adding a third entry here should feel like a decision. */
const VARIANTS = {
  /** A block at the foot of a page about something else: blog, docs. */
  compact: {
    heading: "font-display text-lg font-bold text-foreground",
    question: "group text-sm font-semibold text-foreground",
    list: "mt-6 space-y-7",
  },
  /** A page whose whole subject is the questions. */
  page: {
    heading: "text-xl font-semibold text-foreground",
    question: "group font-medium text-foreground",
    list: "mt-6 space-y-8",
  },
  /** A section of a marketing page, sitting among other sections at that
   * page's heading scale. Added for the home and pricing blocks: at `page`
   * scale the FAQ heading would read as a subheading of whatever came before
   * it, and the alternative to a third entry here was those two pages
   * hand-rolling the block, which is the thing this component removed. */
  section: {
    heading: "font-display text-2xl font-bold text-foreground sm:text-3xl",
    question: "group font-medium text-foreground",
    list: "mt-8 space-y-8",
  },
} as const;

export function FaqSection({
  faqs,
  title = "Frequently asked questions",
  variant = "compact",
  className = "mt-12 border-t border-border pt-10",
}: {
  faqs: ContentFaq[];
  /** The block's own heading. A grouped page passes its section name; every
   * other surface wants the default, which is also what a reader scanning for
   * the block is looking for. */
  title?: string;
  variant?: keyof typeof VARIANTS;
  /** Surfaces differ in the spacing they need around the block; the internals
   * do not vary and are not overridable, because that is where the extraction
   * properties live. */
  className?: string;
}) {
  if (faqs.length === 0) return null;
  const styles = VARIANTS[variant];

  return (
    <section className={className}>
      <h2 className={styles.heading}>{title}</h2>
      <div className={styles.list}>
        {faqs.map((faq) => {
          const anchor = faqAnchor(faq.q);
          return (
            <div key={anchor} id={anchor} className="scroll-mt-28">
              <h3 className={styles.question}>
                {faq.q}{" "}
                <a
                  href={`#${anchor}`}
                  className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Link to: ${faq.q}`}
                >
                  #
                </a>
              </h3>
              <div
                className="mt-2 text-sm leading-relaxed text-muted-foreground [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-foreground [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs"
                dangerouslySetInnerHTML={{ __html: faqAnswerHtml(faq.a) }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
