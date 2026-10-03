/**
 * The site-wide link-preview card (SCRUM-367): one image, named once.
 *
 * WHY EVERY PAGE NAMES IT. Next does not merge `openGraph` or `twitter`
 * across segments: a page that sets its own object replaces the root's
 * whole, images included. An image set only in the root layout is therefore
 * lost on exactly the pages that bothered to describe themselves, which is
 * how the home page, pricing and docs came to unfurl with an empty
 * placeholder. So the root layout carries the card for pages that set
 * nothing, and every page that sets its own `openGraph` or `twitter` spreads
 * SOCIAL_OPEN_GRAPH or SOCIAL_TWITTER in. The test beside this file reads the
 * app tree and fails on a page that sets either without it.
 *
 * The URL is absolute and names production, as every canonical and og:url in
 * this app does: a crawler needs the full address, and a card is fetched by
 * the chat app's servers, never by the page. Chat apps cache a card by its
 * URL for a long time, so a redrawn card gets a new filename.
 *
 * The picture is rendered from tools/capture (the `social-card` still): the
 * logo and the name on the hero's navy, no claim.
 */
export const SOCIAL_CARD = {
  url: "https://datatorag.com/social-card.png",
  width: 1200,
  height: 630,
  alt: "DataToRAG",
  type: "image/png",
} as const;

/** Spread into a page's `openGraph` before its own fields. */
export const SOCIAL_OPEN_GRAPH = {
  siteName: "DataToRAG",
  images: [SOCIAL_CARD],
};

/** Spread into a page's `twitter` before its own fields. */
export const SOCIAL_TWITTER = {
  card: "summary_large_image" as const,
  images: [SOCIAL_CARD],
};
