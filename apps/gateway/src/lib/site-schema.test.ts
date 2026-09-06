import { describe, expect, it } from "vitest";
import { faqPageNode, serializeJsonLd } from "./site-schema";

/**
 * The FAQPage projection and the script-escape beneath it.
 *
 * WHY THE ESCAPE IS TESTED HERE AND NOT AGAINST THE RENDERED PAGE. Checking the
 * built HTML for the absence of a literal "<" inside the ld+json block looks
 * like a verification and is not one: no shipped answer contains that character,
 * so the check returns its passing value whether or not the escape runs. A check
 * whose failure mode produces the passing value is not a check. Feeding the
 * function a "<" on purpose is the version that can go red.
 */

describe("serializeJsonLd", () => {
  it("escapes a < that would close the script element early", () => {
    const out = serializeJsonLd([{ text: "ends early </script> here" }]);
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c/script>");
  });

  it("the escape control can go red", () => {
    // Mutation control: the unescaped serialization must still contain the
    // character, or the assertion above would pass against any input.
    const unescaped = JSON.stringify([{ text: "ends early </script> here" }]);
    expect(unescaped).toContain("<");
  });

  it("round-trips to the same data once unescaped", () => {
    // The escape must not corrupt the payload it protects.
    const nodes = [{ "@type": "Thing", text: "a < b and </script>" }];
    const parsed = JSON.parse(serializeJsonLd(nodes).replace(/\\u003c/g, "<"));
    expect(parsed).toEqual(nodes);
  });

  it("renders nothing distinguishable for an empty node list", () => {
    expect(serializeJsonLd([])).toBe("[]");
  });
});

describe("faqPageNode", () => {
  it("carries the flattened projection, not the authored markdown", () => {
    const node = faqPageNode([
      { q: "Where are the docs?", a: "See [the guide](/docs/getting-started)." },
    ]);
    const entity = (node.mainEntity as Record<string, unknown>[])[0];
    const answer = entity.acceptedAnswer as Record<string, unknown>;

    expect(node["@type"]).toBe("FAQPage");
    expect(entity["@type"]).toBe("Question");
    expect(entity.name).toBe("Where are the docs?");
    expect(answer.text).toBe("See the guide.");
    // The authored link syntax must not survive into the machine-readable copy.
    expect(answer.text).not.toContain("](");
  });

  it("builds one Question per authored pair, in order", () => {
    const node = faqPageNode([
      { q: "First?", a: "One, in 2026." },
      { q: "Second?", a: "Two, in 2026." },
    ]);
    const entities = node.mainEntity as Record<string, unknown>[];
    expect(entities.map((e) => e.name)).toEqual(["First?", "Second?"]);
  });

  it("ships no offers, and this is deliberate", () => {
    // Pinned rather than left to a comment. plans.ts holds no dollar amounts and
    // the prices are hand-written on the pricing page in two places already, so
    // an offers block here would be a third hand-maintained copy in the one
    // format a machine quotes verbatim. If someone adds one, this goes red and
    // they have to read the reasoning in site-schema.ts first.
    const serialized = serializeJsonLd([faqPageNode([{ q: "Cost?", a: "See pricing." }])]);
    expect(serialized).not.toContain("offers");
    expect(serialized).not.toContain("priceCurrency");
  });
});
