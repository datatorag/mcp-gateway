import { faqAnswerText } from "./faq";
import type { ContentFaq } from "./content-collection";
import { REPOSITORY_URL } from "@/components/github-mark";
import { PUBLIC_CONNECTORS_TEXT } from "./public-integrations";

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
 * Organization, WebSite and SoftwareApplication are built here too (see
 * `siteNodes`), and every page-level node names the organization by the same
 * `@id`, so the site describes one publisher and never two that differ.
 */

/** The site's address and name, as every node states them. */
export const SITE_URL = "https://datatorag.com";
export const SITE_NAME = "DataToRAG";

const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const SOFTWARE_ID = `${SITE_URL}/#software`;

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

/** The trail to a page, from the home page down: each entry a name and its
 * address. Every content page carries one (SCRUM-514). */
export function breadcrumbNode(trail: { name: string; url: string }[]): SchemaNode {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((entry, i) => ({ "@type": "ListItem", position: i + 1, name: entry.name, item: entry.url })),
  };
}

/** A page that shows how a task is done, step by step (SCRUM-514). The steps
 * are the same strings the page lists, never a second copy, and the dates
 * are the record's own. */
export function howToNode(page: {
  name: string;
  description: string;
  url: string;
  date: string;
  steps: { name: string; text: string }[];
}): SchemaNode {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: page.name,
    description: page.description,
    url: page.url,
    datePublished: page.date,
    dateModified: page.date,
    step: page.steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.name, text: s.text })),
  };
}

/** The organization as a page-level node names it: the same `@id` the
 * site-wide Organization node carries, with the name and address repeated so
 * the reference still reads on its own. */
export function organizationRef(): SchemaNode {
  return { "@type": "Organization", "@id": ORGANIZATION_ID, name: SITE_NAME, url: SITE_URL };
}

/** Who publishes the site. `sameAs` holds only addresses that are certainly
 * ours: the public source repository. */
export function organizationNode(): SchemaNode {
  return {
    "@context": "https://schema.org",
    ...organizationRef(),
    logo: `${SITE_URL}/datatorag-logo-256.png`,
    sameAs: [REPOSITORY_URL],
  };
}

/** The site itself, published by the organization. */
export function websiteNode(): SchemaNode {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    url: SITE_URL,
    publisher: { "@id": ORGANIZATION_ID },
  };
}

/** The product: the hosted MCP server. No `offers`, no rating, and no review,
 * for the reason at the top of this file: nothing here is a figure somebody
 * would have to keep in step by hand. */
export function softwareApplicationNode(): SchemaNode {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": SOFTWARE_ID,
    name: SITE_NAME,
    url: SITE_URL,
    description: `A hosted MCP server that gives an agent tools for ${PUBLIC_CONNECTORS_TEXT}.`,
    applicationCategory: "DeveloperApplication",
    publisher: { "@id": ORGANIZATION_ID },
    sameAs: [REPOSITORY_URL],
  };
}

/** The three nodes every page carries, emitted once by the root layout. */
export function siteNodes(): SchemaNode[] {
  return [organizationNode(), websiteNode(), softwareApplicationNode()];
}

/** A documentation page. `TechArticle` because a docs page is reference and
 * how-to material for a technical product. The headline and description are
 * the strings the page shows; `dateModified` is the day the page's file last
 * changed and is left out when that is not known, never guessed. */
export function techArticleNode(page: {
  headline: string;
  description: string;
  url: string;
  dateModified: string | null;
}): SchemaNode {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: page.headline,
    description: page.description,
    url: page.url,
    mainEntityOfPage: page.url,
    inLanguage: "en",
    ...(page.dateModified ? { dateModified: page.dateModified } : {}),
    author: organizationRef(),
    publisher: organizationRef(),
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": SOFTWARE_ID },
  };
}

/** A page that is a list of other pages or of generated entries (the docs
 * index, the all-tools page). It carries no date: what it shows is read from
 * other sources when it is built or requested, so no single day is its own. */
export function collectionPageNode(page: { name: string; description: string; url: string }): SchemaNode {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: page.name,
    description: page.description,
    url: page.url,
    isPartOf: { "@id": WEBSITE_ID },
    publisher: organizationRef(),
  };
}

/** A list of pages, in the order given: each a name and its address. */
export function itemListNode(items: { name: string; url: string }[]): SchemaNode {
  return {
    "@type": "ItemList",
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, url: item.url })),
  };
}

/** The blog's index: a page that lists every post, newest first. */
export function blogIndexNode(page: {
  name: string;
  description: string;
  url: string;
  posts: { name: string; url: string }[];
}): SchemaNode {
  return {
    ...collectionPageNode({ name: page.name, description: page.description, url: page.url }),
    mainEntity: itemListNode(page.posts),
  };
}

/** One blog post. The headline and the dates are the ones the page shows;
 * the picture is always present (a post with none of its own passes the
 * site's card); the publisher is the site-wide organization, by its `@id`. */
export function blogPostingNode(post: {
  headline: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified: string;
  image: string;
  keywords: string[];
  section?: string;
  author: { name: string; image?: string };
}): SchemaNode {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.headline,
    description: post.description,
    datePublished: post.datePublished,
    dateModified: post.dateModified,
    inLanguage: "en",
    isAccessibleForFree: true,
    url: post.url,
    image: post.image,
    ...(post.keywords.length > 0 ? { keywords: post.keywords.join(", ") } : {}),
    ...(post.section ? { articleSection: post.section } : {}),
    author: { "@type": "Person", name: post.author.name, ...(post.author.image ? { image: post.author.image } : {}) },
    publisher: { ...organizationRef(), logo: { "@type": "ImageObject", url: `${SITE_URL}/datatorag-logo-256.png` } },
    isPartOf: { "@id": WEBSITE_ID },
    mainEntityOfPage: { "@type": "WebPage", "@id": post.url },
  };
}
