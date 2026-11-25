import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPOSITORY_URL } from "@/components/github-mark";
import {
  collectionPageNode,
  faqPageNode,
  organizationNode,
  serializeJsonLd,
  siteNodes,
  softwareApplicationNode,
  techArticleNode,
  websiteNode,
} from "./site-schema";

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

/* The three nodes the root layout emits on every page: who publishes the
   site, the site, and the product. They have to agree with each other, and
   every page-level node has to name the same publisher. */
describe("site-wide nodes", () => {
  const SITE = "https://datatorag.com";
  const ORG_ID = `${SITE}/#organization`;

  it("an Organization with its name, address, logo, and the repository", () => {
    const org = organizationNode();
    expect(org["@context"]).toBe("https://schema.org");
    expect(org["@type"]).toBe("Organization");
    expect(org["@id"]).toBe(ORG_ID);
    expect(org.name).toBe("DataToRAG");
    expect(org.url).toBe(SITE);
    expect(org.logo).toBe(`${SITE}/datatorag-logo-256.png`);
    expect(org.sameAs).toEqual([REPOSITORY_URL]);
  });

  it("names a logo file the site serves", () => {
    const logo = (organizationNode().logo as string).replace(SITE, "");
    expect(() => readFileSync(path.join(process.cwd(), "public", logo))).not.toThrow();
  });

  it("a WebSite published by that organization", () => {
    const site = websiteNode();
    expect(site["@context"]).toBe("https://schema.org");
    expect(site["@type"]).toBe("WebSite");
    expect(site["@id"]).toBe(`${SITE}/#website`);
    expect(site.name).toBe("DataToRAG");
    expect(site.url).toBe(SITE);
    expect(site.publisher).toEqual({ "@id": ORG_ID });
  });

  it("a SoftwareApplication for the product, published by that organization", () => {
    const app = softwareApplicationNode();
    expect(app["@context"]).toBe("https://schema.org");
    expect(app["@type"]).toBe("SoftwareApplication");
    expect(app.name).toBe("DataToRAG");
    expect(app.url).toBe(SITE);
    expect(app.applicationCategory).toBe("DeveloperApplication");
    expect((app.description as string).length).toBeGreaterThan(20);
    expect(app.publisher).toEqual({ "@id": ORG_ID });
    expect(app.sameAs).toEqual([REPOSITORY_URL]);
  });

  it("the three agree on the name and the address, and each has its own id", () => {
    const nodes = siteNodes();
    expect(nodes.map((n) => n["@type"])).toEqual(["Organization", "WebSite", "SoftwareApplication"]);
    expect(new Set(nodes.map((n) => n.name))).toEqual(new Set(["DataToRAG"]));
    expect(new Set(nodes.map((n) => n.url))).toEqual(new Set([SITE]));
    expect(new Set(nodes.map((n) => n["@id"])).size).toBe(3);
  });

  it("state no price, rating, or review", () => {
    const serialized = serializeJsonLd(siteNodes());
    for (const word of ["offers", "price", "aggregateRating", "ratingValue", "review"]) {
      expect(serialized, word).not.toContain(word);
    }
  });

  it("the root layout emits them once, and no page declares its own", () => {
    const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
    expect(read("src/app/layout.tsx").match(/<JsonLd nodes=\{siteNodes\(\)\} \/>/g)).toHaveLength(1);
    for (const file of ["src/app/page.tsx", "src/app/docs/page.tsx", "src/app/docs/[slug]/page.tsx", "src/app/docs/layout.tsx"]) {
      expect(read(file), file).not.toMatch(/siteNodes|organizationNode|websiteNode|softwareApplicationNode/);
    }
  });
});

describe("page-level nodes name the same publisher", () => {
  const org = { "@type": "Organization", "@id": "https://datatorag.com/#organization", name: "DataToRAG", url: "https://datatorag.com" };

  it("a TechArticle carries its headline, description, address, date, author, and publisher", () => {
    const node = techArticleNode({ headline: "Gmail", description: "What it covers.", url: "https://datatorag.com/docs/gmail", dateModified: "2026-11-25" });
    expect(node).toMatchObject({
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: "Gmail",
      description: "What it covers.",
      url: "https://datatorag.com/docs/gmail",
      dateModified: "2026-11-25",
      author: org,
      publisher: org,
    });
  });

  it("a TechArticle with no known date states none", () => {
    const node = techArticleNode({ headline: "Gmail", description: "What it covers.", url: "https://datatorag.com/docs/gmail", dateModified: null });
    expect("dateModified" in node).toBe(false);
  });

  it("a CollectionPage carries its name, description, address, and publisher, and no date", () => {
    const node = collectionPageNode({ name: "All tools", description: "Every tool.", url: "https://datatorag.com/docs/tools" });
    expect(node).toMatchObject({ "@type": "CollectionPage", name: "All tools", description: "Every tool.", url: "https://datatorag.com/docs/tools", publisher: org });
    expect(Object.keys(node).filter((k) => k.startsWith("date"))).toEqual([]);
  });
});
