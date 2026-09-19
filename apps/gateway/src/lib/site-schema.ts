import { faqAnswerText } from "./faq";
import type { ContentFaq } from "./content-collection";

/** Builders for the structured data the site emits.
 *
 * WHAT THIS IS FOR, stated because the obvious reading is wrong. Google RETIRED
 * the FAQ rich result for every site on 2026-05-07 and removed the documentation
 * on 2026-06-15. Nothing here earns a Google search appearance and nothing
 * shipped may claim it does. The justification is that an answer engine reading
 * structured data should find our published answers unambiguous, and the schema
 * is packaging riding along on content that is being published anyway.
 *
 * DELIBERATE NON-GOAL: no `offers`, and this is not an oversight to be tidied up
 * later. `plans.ts` holds the call caps and no dollar amounts, and the dollar
 * figures are hand-written on the pricing page in two separate places. An
 * `offers` block would be a THIRD hand-maintained copy, in the one format a
 * machine quotes verbatim, which is how a stale price reaches an AI answer. If
 * price ever belongs in here, lift the figures into `plans.ts` first and derive
 * all three surfaces from it. That is a separate change with its own risk.
 *
 * SCRUM-205 adds Organization, WebSite and SoftwareApplication nodes beside this
 * one. It should append here rather than start a third convention.
 */

/** A schema.org node, loose enough to hold any @type without pretending we have
 * modelled the vocabulary. */
export type SchemaNode = Record<string, unknown>;

/** Serializes nodes for embedding in a `<script type="application/ld+json">`.
 *
 * `JSON.stringify` does NOT escape `<`, so a literal `</script>` in any
 * serialized field closes the element early. Answer text is authored prose, so
 * that character arrives through content rather than through code.
 *
 * A separate function rather than an inline expression in the component so the
 * escape has somewhere to be tested. Asserting it against the rendered page
 * cannot work: no shipped answer contains a `<`, so the check passes whether or
 * not the escape happens, which is a control that cannot fire. */
export function serializeJsonLd(nodes: SchemaNode[]): string {
  return JSON.stringify(nodes).replace(/</g, "\\u003c");
}

/** The FAQPage node for one page's authored questions.
 *
 * `acceptedAnswer.text` is the flattened projection of the same authored string
 * the page renders, never a hand-written second copy, so the visible answer and
 * the machine-readable one cannot disagree. That matters beyond tidiness:
 * structured data that does not match visible content is the one thing Google's
 * guidance explicitly warns against, and it is also just lying in a
 * machine-readable format. */
export function faqPageNode(faqs: ContentFaq[]): SchemaNode {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: faqAnswerText(f.a) },
    })),
  };
}
