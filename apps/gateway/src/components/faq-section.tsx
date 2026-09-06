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
export function FaqSection({
  faqs,
  className = "mt-12 border-t border-border pt-10",
}: {
  faqs: ContentFaq[];
  /** Surfaces differ in the spacing they need around the block; the internals
   * do not vary and are not overridable, because that is where the extraction
   * properties live. */
  className?: string;
}) {
  if (faqs.length === 0) return null;

  return (
    <section className={className}>
      <h2 className="font-display text-lg font-bold text-foreground">
        Frequently asked questions
      </h2>
      <div className="mt-6 space-y-7">
        {faqs.map((faq) => {
          const anchor = faqAnchor(faq.q);
          return (
            <div key={anchor} id={anchor} className="scroll-mt-28">
              <h3 className="group text-sm font-semibold text-foreground">
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
