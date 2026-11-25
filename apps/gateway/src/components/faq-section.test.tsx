import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { faqAnchor } from "@/lib/faq";
import { FaqSection } from "./faq-section";

const FAQS = [
  { q: "Can it attach files to an email?", a: "Yes, from Drive or by a file reference." },
  { q: "Is there a rate limit?", a: "On the dashboard, yes." },
];

const html = renderToStaticMarkup(<FaqSection faqs={FAQS} />);
const strip = (s: string) => s.replace(/<[^>]+>/g, "");
const headings = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => m[1]);

describe("FaqSection", () => {
  it("renders each question as a heading whose text is the question and nothing else", () => {
    // A reader of the outline gets the question, with no permalink mark in it.
    expect(headings.map(strip)).toEqual(FAQS.map((f) => f.q));
    expect(headings.join("")).not.toContain("<a");
  });

  it("keeps a labelled permalink to each question beside its heading", () => {
    for (const faq of FAQS) {
      const anchor = faqAnchor(faq.q);
      expect(html).toContain(`id="${anchor}"`);
      const link = html.match(new RegExp(`<a href="#${anchor}"[^>]*>([\\s\\S]*?)</a>`));
      expect(link, faq.q).not.toBeNull();
      expect(link![0]).toContain(`aria-label="Link to: ${faq.q}"`);
      // The mark itself is decoration: the label is the link's name.
      expect(link![1]).toBe('<span aria-hidden="true">#</span>');
    }
  });

  it("renders nothing for an empty list", () => {
    expect(renderToStaticMarkup(<FaqSection faqs={[]} />)).toBe("");
  });
});
