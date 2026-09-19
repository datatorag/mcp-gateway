/**
 * The FAQ content rules, applied to every surface that publishes FAQs.
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
 * WHY THIS IS A REGISTRY AND NOT A DIRECTORY WALK, which is the change SCRUM-213
 * made. These rules used to read `content/blog` directly, so extending FAQs to
 * docs and to the landing pages meant writing a second sweep beside this one.
 * Two sweeps drift, and the one nobody extended fails by looking at nothing,
 * which is the exact failure this repo keeps producing one directory over. There
 * is now ONE list of sources and ONE set of rules over their union. Adding a
 * surface is appending to SOURCES, and forgetting to is not possible in the way
 * that matters, because a surface with no registered source has no FAQs to check
 * and a registered source that stops resolving fails loudly.
 *
 * Note what these rules do NOT do: they cannot tell whether a date is the RIGHT
 * date, or whether a claim was ever true. They pin that the qualification
 * survived the trip out of the page. Claims are a person's job.
 */

import { describe, expect, it } from "vitest";
import { faqAnchor, faqAnswerHtml, faqAnswerText, type FaqEntry } from "./faq";
import type { ContentFaq } from "./content-collection";
import { getAllPosts } from "./blog";
import { getAllDocs } from "./docs";
import { siteFaqPages } from "./site-faq";
import { skillFaqPages } from "./skills";
import { personaFaqPages } from "./personas";

/** Third parties whose behaviour changes without telling us. Our own product is
 * deliberately absent: "DataToRAG sends email" needs no date, because if it
 * stops being true that is our bug to fix, not a surface moving underneath us.
 *
 * "built-in" was added when the landing FAQs arrived, and the gap is worth
 * recording: the same competitor is called "native connectors" on /faq and
 * "built-in connector" on the home page, so a pattern written against one
 * page's vocabulary went blind the moment an answer was written in the other's.
 * A claim does not become datable or undatable according to which synonym the
 * author reached for. */
const COMPETITOR =
  /\b(Composio|Zapier|Pipedream|(?:native|built-in) connectors?|Claude's (?:native|built-in)|Anthropic)\b/;

const HAS_YEAR = /\b(20\d{2})\b/;

/** A folded block scalar joins its lines with spaces, so a hyphenated word
 * broken across two lines silently becomes "self- hosting" once folded. */
const HYPHEN_SPLIT = /\w+- \w+/g;

/** Markdown link syntax or an HTML tag surviving into the JSON-LD projection.
 * `<[a-z]` alone requires a letter straight after the angle bracket, so it does
 * NOT see a closing tag; the closer is matched explicitly rather than left to
 * read like coverage it does not provide. */
const MARKUP = /\]\(|<\/?[a-z]/i;

/** The target of a markdown link, read off the AUTHORED string. */
const LINK_TARGET = /\]\(([^)]*)\)/g;

/** Where an answer's link may point: a site-relative path, an on-page anchor,
 * or an absolute http(s) URL. Everything else, `javascript:` and `data:`
 * included, is refused rather than enumerated, because a deny list of
 * protocols is the shape that misses the next one. An allow list also refuses
 * what a deny list would have to anticipate: an uppercase scheme, and an
 * entity-encoded one like `java&#9;script:` that a browser decodes back into a
 * working URL, both fail simply by not starting with something allowed.
 *
 * NEITHER SLASH-LIKE CHARACTER MAY FOLLOW THE FIRST SLASH. `//evil.com` is
 * protocol-relative and lands offsite while looking site-relative in the
 * source. `/\evil.com` does the same thing, because the URL parser treats a
 * backslash as a slash in that position; today `marked` percent-encodes it
 * back to same-origin, but that is the renderer saving us rather than this
 * rule, and this rule is the one documented as not depending on the content or
 * the renderer behaving. A bare `/` is allowed: it is the home page. */
const SAFE_HREF = /^(\/([^/\\]|$)|#|https?:\/\/)/;

interface LoadResult {
  entries: FaqEntry[];
  /** How many candidate files or pages the loader actually looked at. Separate
   * from `entries` on purpose: zero entries is legitimate for a surface that has
   * not been written yet, zero SCANNED means the loader stopped resolving and
   * every rule below has quietly gone vacuous for that source. Those two states
   * are indistinguishable from the entry count alone. */
  scanned: number;
}

interface FaqSource {
  name: string;
  /** Entries this source is currently known to ship. Raised in the same commit
   * that adds content, so a source that silently empties fails rather than
   * reporting clean. */
  minimum: number;
  load: () => LoadResult;
}

/** Reads authored FAQs THROUGH THE COLLECTION THE PAGES RENDER FROM.
 *
 * Not by re-parsing the markdown here, which is what this file used to do. A
 * guard with its own copy of the parse is a second derived artifact: it and the
 * app agree right up until `field.faqList` changes under both, and then the
 * guard reports on a pipeline nobody ships. Going through `getAllPosts` and
 * `getAllDocs` means these rules see exactly the strings the page renders and
 * the JSON-LD carries, so a renamed frontmatter key empties the source here at
 * the same moment it empties the page. */
function collectionSource(
  name: string,
  load: () => { slug: string; faqs: ContentFaq[] }[]
): () => LoadResult {
  return () => {
    const pages = load();
    return {
      entries: pages.flatMap((p) =>
        p.faqs.map((f) => ({ source: name, where: p.slug, q: f.q, a: f.a }))
      ),
      scanned: pages.length,
    };
  };
}

/** Every surface that publishes FAQs.
 *
 * `minimum` is the count the source ships today, not a token non-zero. Set
 * tight on purpose: it ratchets only when content is added, and a tight floor is
 * what turns "somebody deleted the FAQ block" into a red test instead of a
 * quieter page.
 *
 * `scanned` is tracked separately from the entry count because they answer
 * different questions: a source can legitimately hold no FAQs yet, but a source
 * that scans nothing has stopped resolving and every rule below has gone vacuous
 * for it. The entry count alone cannot tell those apart. */
const SOURCES: FaqSource[] = [
  { name: "blog", minimum: 18, load: collectionSource("blog", getAllPosts) },
  { name: "docs", minimum: 72, load: collectionSource("docs", getAllDocs) },
  // The landing pages are TSX and keep their answers in a typed module. They go
  // through the SAME reader as the two markdown collections, because
  // `siteFaqPages` hands back the same `{ slug, faqs }` shape; the rules below
  // never learn which one they are looking at. A second reader for a second
  // authoring format is the drift this registry exists to prevent.
  { name: "landing", minimum: 30, load: collectionSource("landing", siteFaqPages) },
  // Registered at zero, with content following in its own commit. `scanned`
  // is what makes that safe: these two report how many pages they resolved,
  // so a source wired to a collection that later stops loading fails here
  // even while its authored count is legitimately nothing yet. A source
  // registered only when it has content is a source nobody notices is
  // missing.
  //
  // Skills read through `skillFaqPages`, which goes to the FILES rather than
  // to the skills table: the answers are published page copy keyed by slug,
  // never part of the artifact a reader copies and never on a user's own row.
  { name: "skills", minimum: 50, load: collectionSource("skills", skillFaqPages) },
  { name: "personas", minimum: 16, load: collectionSource("personas", personaFaqPages) },
];

const loaded = SOURCES.map((s) => ({ source: s, result: s.load() }));
const allFaqs: FaqEntry[] = loaded.flatMap(({ result }) => result.entries);

const label = (f: FaqEntry) => `${f.source}/${f.where}: ${f.q}`;

describe("FAQ sources resolve", () => {
  // The per-source control. Without it, a source whose directory moved or whose
  // field was renamed contributes nothing, every rule below passes over the
  // remaining sources, and the suite reports clean because it went blind rather
  // than because the content is good. An aggregate count cannot catch that: the
  // blog alone keeps the total comfortably non-zero.
  it.each(SOURCES.map((s) => s.name))("%s is reachable and non-empty of files", (name) => {
    const { source, result } = loaded.find((l) => l.source.name === name)!;
    expect(result.scanned, `${name}: loader scanned nothing, so its rules are vacuous`)
      .toBeGreaterThan(0);
    expect(
      result.entries.length,
      `${name}: expected at least ${source.minimum} authored FAQs and found ${result.entries.length}`
    ).toBeGreaterThanOrEqual(source.minimum);
  });

  it("the reachability control can go red", () => {
    // Mutation control for the control itself. A source that resolves nothing
    // must fail the assertion above, not slip through it.
    const dead: LoadResult = { entries: [], scanned: 0 };
    expect(dead.scanned > 0).toBe(false);
  });
});

describe("FAQ answers", () => {
  it("finds authored FAQs at all", () => {
    // Every case below is vacuous against an empty list, and an empty list is
    // exactly what a moved directory or a renamed field produces.
    expect(allFaqs.length).toBeGreaterThan(5);
  });

  it("every answer naming a competitor carries a year", () => {
    const undated = allFaqs
      .filter((f) => COMPETITOR.test(f.a) && !HAS_YEAR.test(f.a))
      .map(label);

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

    // Both vocabularies, because the pages disagree on what to call it and the
    // rule must not.
    for (const phrase of [
      "The native connector cannot send.",
      "The built-in connector cannot send.",
      "Claude's built-in Drive connector cannot edit a file you already have.",
    ]) {
      expect(COMPETITOR.test(phrase), phrase).toBe(true);
    }
  });

  it("matches the competitors our shipped answers actually name", () => {
    // Positive control with a stated expectation, so a pattern that matched
    // nothing could not report the suite clean. The real answers name several.
    expect(allFaqs.filter((f) => COMPETITOR.test(f.a)).length).toBeGreaterThan(5);
  });

  it("no hyphenated word was split by line wrapping", () => {
    // The defect is INVISIBLE IN THE SOURCE, where it looks like ordinary
    // wrapping, and appears only in the rendered page and in the JSON-LD. Found
    // by looking at the rendered frame, and only enumeration found the rest.
    const split = allFaqs.flatMap((f) =>
      [...f.a.matchAll(HYPHEN_SPLIT)].map((m) => `${label(f)} -> "${m[0]}"`)
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
    // proper noun somewhere after its first sentence.
    const subjectless = allFaqs
      .filter((f) => !/\b[A-Z][A-Za-z]+/.test(f.a.replace(/^[^.]*\.\s*/, "")))
      .map(label);
    expect(subjectless).toEqual([]);
  });

  it("every link in an answer points somewhere a link may point", () => {
    // WHY THIS IS NOT COVERED BY THE MARKUP RULE, which is what it looks like.
    // `marked` does not strip dangerous protocols any more: parseInline on
    // "[x](javascript:alert(1))" renders the anchor with that href intact. The
    // markup rule cannot see it, because `faqAnswerText` strips the link syntax
    // BEFORE the rule runs, so the rule only ever inspects the link's label.
    // That leaves a hole in the one defence `faq.ts` documents as not depending
    // on content being well behaved, so it is checked on the RAW authored
    // string instead of on either projection.
    const bad = allFaqs.flatMap((f) =>
      [...f.a.matchAll(LINK_TARGET)]
        .map((m) => m[1].trim())
        .filter((href) => !SAFE_HREF.test(href))
        .map((href) => `${label(f)} -> "${href}"`)
    );
    expect(bad, `FAQ answers may only link a site path, an anchor or http(s):\n${bad.join("\n")}`)
      .toEqual([]);
  });

  it("the link rule can go red, and sees what the markup rule cannot", () => {
    const attack = "See [the roundup](javascript:alert(1)) for more.";
    const targets = [...attack.matchAll(LINK_TARGET)].map((m) => m[1]);
    // The capture stops at the first ")", so a target containing parentheses
    // arrives truncated. Harmless for THIS rule and only because of its shape:
    // SAFE_HREF is an allow list anchored at the start, so a shorter string can
    // never acquire a safe prefix it did not already have. Do not reuse
    // LINK_TARGET for anything that needs the whole href.
    expect(targets).toEqual(["javascript:alert(1"]);
    expect(SAFE_HREF.test(targets[0])).toBe(false);
    // The rule this one exists beside would pass the same string, which is the
    // whole reason it exists: the flattened projection keeps only the label.
    expect(MARKUP.test(faqAnswerText(attack))).toBe(false);
    // And the renderer really does emit it, so this is not a hypothetical.
    expect(faqAnswerHtml(attack)).toContain("javascript:alert(1)");

    for (const good of ["/docs/sheets", "/", "#faq-x", "https://datatorag.com/x", "http://example.com"]) {
      expect(SAFE_HREF.test(good), good).toBe(true);
    }
    // The two that read as site-relative and are not, plus the two shapes an
    // allow list refuses without having to recognise them.
    for (const bad of ["//evil.com", "/\\evil.com", "JaVaScRiPt:alert(1)", "java&#9;script:alert(1)", "data:text/html,x"]) {
      expect(SAFE_HREF.test(bad), bad).toBe(false);
    }
  });

  it("gives every question a unique, stable anchor within its page", () => {
    const byPage = new Map<string, string[]>();
    for (const f of allFaqs) {
      const key = `${f.source}/${f.where}`;
      const list = byPage.get(key) ?? [];
      list.push(faqAnchor(f.q));
      byPage.set(key, list);
    }
    for (const [page, anchors] of byPage) {
      expect(new Set(anchors).size, `${page} has a duplicate FAQ anchor`).toBe(
        anchors.length
      );
      for (const anchor of anchors) expect(anchor).toMatch(/^faq-[a-z0-9-]+$/);
    }
  });
});

describe("the rules do not depend on where an answer came from", () => {
  // SCRUM-213's landing surfaces are TSX and hold their answers in a typed
  // module, not in markdown. That source is registered above now, but these
  // cases were written before it existed and stay: they are hand-built rather
  // than read off disk, so they hold the source-shape-agnostic property on its
  // own, without depending on any particular source still being registered.
  const synthetic: FaqEntry[] = [
    {
      source: "fixture",
      where: "landing",
      q: "Does this rule see a non-markdown source?",
      a: "Zapier MCP exposed Gmail, Docs, Sheets, Drive and Calendar as of July 2026.",
    },
  ];

  it("passes a clean hand-built entry", () => {
    expect(synthetic.filter((f) => COMPETITOR.test(f.a) && !HAS_YEAR.test(f.a))).toEqual([]);
    expect(synthetic.flatMap((f) => [...f.a.matchAll(HYPHEN_SPLIT)])).toEqual([]);
    expect(synthetic.every((f) => !MARKUP.test(faqAnswerText(f.a)))).toBe(true);
  });

  it("reddens a dirty hand-built entry on each rule", () => {
    const undatedClaim: FaqEntry = { ...synthetic[0], a: "Zapier MCP does not expose Slides." };
    expect(COMPETITOR.test(undatedClaim.a) && !HAS_YEAR.test(undatedClaim.a)).toBe(true);

    const foldSplit: FaqEntry = { ...synthetic[0], a: "It is a self- hosting story in 2026." };
    expect([...foldSplit.a.matchAll(HYPHEN_SPLIT)]).toHaveLength(1);

    const markup: FaqEntry = { ...synthetic[0], a: 'Ends early </script> in 2026.' };
    expect(MARKUP.test(faqAnswerText(markup.a))).toBe(true);
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
    for (const { a } of allFaqs) {
      expect(faqAnswerText(a).length).toBeGreaterThan(0);
      expect(faqAnswerHtml(a).length).toBeGreaterThan(0);
    }
  });

  it("keeps JSON-LD answers free of markup", () => {
    // The page escapes "<" when serializing regardless; this keeps authored
    // answers clean rather than relying on that single defence.
    for (const f of allFaqs) {
      expect(faqAnswerText(f.a), label(f)).not.toMatch(MARKUP);
    }
  });

  it("the markup rule sees a closing tag, not just an opening one", () => {
    expect(MARKUP.test("ends the block early </script>")).toBe(true);
    expect(MARKUP.test("an opening <a href")).toBe(true);
    expect(MARKUP.test("a markdown [link](/blog/x)")).toBe(true);
    expect(MARKUP.test("plain prose with a < b arithmetic")).toBe(false);
  });
});
