/**
 * Per-post FAQ answers: the dated-claim rule, and the two projections.
 *
 * WHY THE DATE RULE EXISTS, because it is the part a future author will drop.
 * Our comparison posts hedge competitor claims with "at the time of writing" and
 * "as of mid-2026". Those work in a post, where "the writing" is the thing you
 * are reading. An FAQ ANSWER IS BUILT TO BE QUOTED AWAY FROM ITS PAGE: that is
 * the entire reason we publish it, and it is what an answer engine does with it.
 * Lift "Composio has no standalone Slides toolkit at the time of writing" into
 * an acceptedAnswer and the hedge evaporates, leaving an undated, permanent,
 * machine-readable claim about somebody else's moving product.
 *
 * So a competitor claim in an answer carries a literal date. Keyed to the claim
 * (does this answer name a competitor at all) rather than to the phrasing of any
 * known-bad example, because a pattern built from the examples you already have
 * can only ever re-find those examples.
 *
 * Note what this guard does NOT do: it cannot tell whether a date is the RIGHT
 * date, or whether the claim was ever true. It pins that the qualification
 * survived the trip out of the post. Claims are a person's job.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { faqAnchor, faqAnswerHtml, faqAnswerText } from "./blog";

const BLOG_DIR = join(import.meta.dirname, "../../content/blog");

/** Third parties whose behaviour changes without telling us. Our own product is
 * deliberately absent: "DataToRAG sends email" needs no date, because if it
 * stops being true that is our bug to fix, not a surface moving underneath us. */
const COMPETITOR =
  /\b(Composio|Zapier|Pipedream|native connectors?|Claude's native|Anthropic)\b/;

const HAS_YEAR = /\b(20\d{2})\b/;

interface Authored {
  file: string;
  q: string;
  a: string;
}

function authoredFaqs(): Authored[] {
  const out: Authored[] = [];
  for (const file of readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md"))) {
    const { data } = matter(readFileSync(join(BLOG_DIR, file), "utf8"));
    if (!Array.isArray(data.faqs)) continue;
    for (const entry of data.faqs as { q?: unknown; a?: unknown }[]) {
      if (typeof entry?.q !== "string" || typeof entry?.a !== "string") continue;
      out.push({ file, q: entry.q, a: entry.a });
    }
  }
  return out;
}

describe("blog FAQ answers", () => {
  it("finds authored FAQs at all", () => {
    // Every case below is vacuous against an empty list, and an empty list is
    // exactly what a moved directory or a renamed field produces.
    expect(authoredFaqs().length).toBeGreaterThan(5);
  });

  it("every answer naming a competitor carries a year", () => {
    const undated = authoredFaqs()
      .filter((f) => COMPETITOR.test(f.a) && !HAS_YEAR.test(f.a))
      .map((f) => `${f.file}: ${f.q}`);

    expect(
      undated,
      "An FAQ answer is quoted away from its page, so a competitor claim in one " +
        "needs a literal date. 'At the time of writing' does not survive the trip.\n" +
        undated.join("\n")
    ).toEqual([]);
  });

  it("the date rule can actually go red", () => {
    // Mutation control. The assertion above passes both when content is clean
    // and when COMPETITOR silently stops matching anything, and those two are
    // indistinguishable from the result alone.
    const bad = "Composio has no standalone Slides toolkit at the time of writing.";
    expect(COMPETITOR.test(bad) && !HAS_YEAR.test(bad)).toBe(true);

    const good = "Composio had no standalone Slides toolkit as of July 2026.";
    expect(COMPETITOR.test(good) && !HAS_YEAR.test(good)).toBe(false);
  });

  it("matches the competitors our shipped answers actually name", () => {
    // Positive control with a stated expectation, so a pattern that matched
    // nothing could not report the suite clean. The real answers name several.
    const named = authoredFaqs().filter((f) => COMPETITOR.test(f.a));
    expect(named.length).toBeGreaterThan(5);
  });

  it("no hyphenated word was split by line wrapping", () => {
    // A folded block scalar joins its lines with spaces, so a hyphenated word
    // broken across two lines silently becomes "self- hosting" once folded. The
    // defect is INVISIBLE IN THE SOURCE, where it looks like ordinary wrapping,
    // and appears only in the rendered page and in the JSON-LD. Found by looking
    // at the rendered frame, and only enumeration found the other four.
    const split = authoredFaqs()
      .flatMap(({ file, q, a }) =>
        [...a.matchAll(/\w+- \w+/g)].map((m) => `${file}: ${q} -> "${m[0]}"`)
      );
    expect(split).toEqual([]);
  });

  it("the hyphen-split rule can go red", () => {
    expect(/\w+- \w+/.test("so self- hosting is a clone")).toBe(true);
    expect(/\w+- \w+/.test("so self-hosting is a clone")).toBe(false);
  });

  it("every answer names its own subject rather than leaning on the question", () => {
    // An extracted answer arrives without its question. One that opens with a
    // bare pronoun or a bare "No." and never names what it is about reads as a
    // claim with no subject. Cheap proxy: the answer mentions a capitalised
    // proper noun somewhere.
    const subjectless = authoredFaqs()
      .filter((f) => !/\b[A-Z][A-Za-z]+/.test(f.a.replace(/^[^.]*\.\s*/, "")))
      .map((f) => `${f.file}: ${f.q}`);
    expect(subjectless).toEqual([]);
  });
});

describe("FAQ projections", () => {
  it("renders links and inline code for the page", () => {
    const html = faqAnswerHtml("See [the roundup](/blog/x) and `docs_batch_update`.");
    expect(html).toContain('<a href="/blog/x">the roundup</a>');
    expect(html).toContain("<code>docs_batch_update</code>");
  });

  it("flattens the same string to prose for JSON-LD", () => {
    const text = faqAnswerText("See [the roundup](/blog/x) and `docs_batch_update`.");
    expect(text).toBe("See the roundup and docs_batch_update.");
    expect(text).not.toContain("[");
    expect(text).not.toContain("`");
  });

  it("derives both projections from one authored string", () => {
    // The single-source property the whole design rests on: there is no second
    // copy of an answer anywhere, so the page and the JSON-LD cannot disagree.
    for (const { a } of authoredFaqs()) {
      expect(faqAnswerText(a).length).toBeGreaterThan(0);
      expect(faqAnswerHtml(a).length).toBeGreaterThan(0);
    }
  });

  it("keeps JSON-LD answers free of markup", () => {
    // `<[a-z]` alone requires a letter straight after the angle bracket, so it
    // does NOT see a closing tag. Read on its own it would look like coverage
    // of the script-termination hazard and is not, so the closer is matched
    // explicitly. The page escapes "<" when serializing regardless; this keeps
    // authored answers clean rather than relying on that single defence.
    for (const { file, q, a } of authoredFaqs()) {
      const text = faqAnswerText(a);
      expect(text, `${file}: ${q}`).not.toMatch(/\]\(|<\/?[a-z]/i);
    }
  });

  it("the markup rule sees a closing tag, not just an opening one", () => {
    const rule = /\]\(|<\/?[a-z]/i;
    expect(rule.test("ends the block early </script>")).toBe(true);
    expect(rule.test("an opening <a href")).toBe(true);
    expect(rule.test("a markdown [link](/blog/x)")).toBe(true);
    expect(rule.test("plain prose with a < b arithmetic")).toBe(false);
  });

  it("gives every question a unique, stable anchor", () => {
    const byFile = new Map<string, string[]>();
    for (const { file, q } of authoredFaqs()) {
      const list = byFile.get(file) ?? [];
      list.push(faqAnchor(q));
      byFile.set(file, list);
    }
    for (const [file, anchors] of byFile) {
      expect(new Set(anchors).size, `${file} has a duplicate FAQ anchor`).toBe(
        anchors.length
      );
      for (const anchor of anchors) expect(anchor).toMatch(/^faq-[a-z0-9-]+$/);
    }
  });
});
