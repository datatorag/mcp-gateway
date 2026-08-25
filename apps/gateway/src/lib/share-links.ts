/**
 * Short share links: `/r/<slug>` (SCRUM-152).
 *
 * Reddit is roughly a fifth of our traffic and, until this existed, no link
 * shared there had ever carried a campaign tag. The reason was friction —
 * tagging by hand from text snippets, per thread — and the fix is to move the
 * tagging to the server so the link a person pastes is short and clean.
 *
 * The short form matters for a second reason: a long utm tail in a Reddit
 * comment READS AS MARKETING, and in the Claude subreddits, where the value
 * of a comment is that it is genuine help, that is what gets it downvoted or
 * removed. So this protects the channel it measures.
 *
 * THE MAP IS DATA. One place, readable at a glance; adding a slug is one line
 * here and nothing else. `share-links.test.ts` checks every target still
 * renders, so a renamed blog slug fails the suite the day it is renamed.
 *
 * THE TARGET NEVER COMES FROM INPUT. Only the slug is looked up; the path is
 * always a value from this map or "/". An open redirect is a phishing
 * primitive — the victim authenticates against our real domain and lands on
 * the attacker's — which is the same reasoning written into
 * `postLoginDestination`.
 *
 * Every redirect carries utm_source=reddit, utm_medium=social, the mapped
 * campaign, and utm_content=<slug>. `acquisition_entry_url` stores the full
 * query string, so utm_content lands per user without a dedicated column.
 */

export interface ShareLink {
  /** Site-relative path, no query or hash — the resolver appends the tags. */
  to: string;
  /** utm_campaign for this link. */
  campaign: string;
}

export const SHARE_SOURCE = "reddit";
export const SHARE_MEDIUM = "social";

/** utm_campaign for a slug nobody defined — a typo in a comment we cannot
 *  edit, so the link must still work, just with imprecise attribution. */
export const UNKNOWN_CAMPAIGN = "reddit-unknown";

/** One line per share link. Keys are what people type: lowercase kebab. */
export const SHARE_LINKS: Readonly<Record<string, ShareLink>> = {
  saas: { to: "/", campaign: "showcase" },
  help: { to: "/docs/getting-started", campaign: "claude-help" },
  gmail: {
    to: "/blog/claude-gmail-connector-vs-datatorag-send-reply",
    campaign: "claude-help",
  },
  "multi-account": {
    to: "/blog/one-prompt-two-inboxes-multi-account-mcp",
    campaign: "claude-help",
  },
  drive: {
    to: "/blog/claude-google-drive-vs-datatorag-editing",
    campaign: "claude-help",
  },
  triage: { to: "/skills/inbox-triage", campaign: "claude-help" },
  what: { to: "/hosted-google-workspace-mcp", campaign: "claude-help" },
};

export interface ResolvedShareLink {
  /** Normalised slug as looked up (lowercased, trimmed). */
  slug: string;
  /** Whether the slug is in the map. */
  known: boolean;
  campaign: string;
  /** RELATIVE location for the redirect: mapped path (or "/") plus the tags.
   *  Relative on purpose — behind the CDN `request.url` is the internal
   *  address, so anything absolute built from it points at localhost. */
  location: string;
}

/** What may be reflected into utm_content. The slug is user input; it rides
 *  along only as an encoded query value on a fixed path, but it is still
 *  stored per user in the entry url, so anything outside a short kebab token
 *  is replaced rather than passed through. */
const TAME_SLUG = /^[a-z0-9-]{1,32}$/;

export function resolveShareLink(rawSlug: string): ResolvedShareLink {
  const slug = rawSlug.trim().toLowerCase();
  // `hasOwn`, not `in`/index: a slug like "constructor" must not resolve
  // through Object.prototype.
  const link = Object.hasOwn(SHARE_LINKS, slug) ? SHARE_LINKS[slug] : null;
  const to = link?.to ?? "/";
  const campaign = link?.campaign ?? UNKNOWN_CAMPAIGN;

  const tags = new URLSearchParams({
    utm_source: SHARE_SOURCE,
    utm_medium: SHARE_MEDIUM,
    utm_campaign: campaign,
    utm_content: TAME_SLUG.test(slug) ? slug : "invalid",
  });

  return { slug, known: link !== null, campaign, location: `${to}?${tags}` };
}
