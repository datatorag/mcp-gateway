/**
 * Acquisition attribution — the wire format that carries browser-side
 * acquisition signals across the client/server boundary.
 *
 * Server-side events cannot be attributed without a session id. They are
 * emitted from this process, not from the visitor's browser, so nothing in
 * them identifies the browsing session that produced the action — and the
 * session row is where the entry channel, campaign and click ids live. The
 * browser therefore has to hand its session id (and its entry snapshot) to
 * the server at the moment of the action, and this module is the contract
 * both ends parse.
 *
 * Nothing here touches the DOM, express, or the analytics SDK: the client
 * decorator and the express routes both import these pure helpers so the
 * parameter names and the normalisation rules cannot drift apart.
 */

/**
 * Query-parameter names carrying each field. Prefixed `a_` so they read as
 * our own attribution echo rather than as a live campaign tag on the URL.
 */
export const ATTRIBUTION_PARAMS = {
  sessionId: "a_sid",
  distinctId: "a_did",
  utmSource: "a_utm_source",
  utmMedium: "a_utm_medium",
  utmCampaign: "a_utm_campaign",
  gclid: "a_gclid",
  gadSource: "a_gad_source",
  referringDomain: "a_ref_domain",
  entryUrl: "a_entry_url",
} as const;

export type AttributionField = keyof typeof ATTRIBUTION_PARAMS;

export type Attribution = Record<AttributionField, string | null>;

export const ATTRIBUTION_FIELDS = Object.keys(
  ATTRIBUTION_PARAMS
) as AttributionField[];

/**
 * Per-value cap. Entry URLs are the only field that runs long, and an
 * unbounded one would blow past the 4KB cookie limit the stash relies on.
 */
const MAX_VALUE_LENGTH = 500;

/**
 * The analytics SDK writes this sentinel — not an empty string — when a
 * visitor arrived with no referrer, so it has to be treated as absent or
 * every direct visit reads as a referral from a domain called "$direct".
 */
const DIRECT_SENTINEL = "$direct";

const EMPTY: Attribution = {
  sessionId: null,
  distinctId: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  gclid: null,
  gadSource: null,
  referringDomain: null,
  entryUrl: null,
};

function normalize(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === DIRECT_SENTINEL) return null;
  return trimmed.slice(0, MAX_VALUE_LENGTH);
}

export interface ParseAttributionOptions {
  /**
   * Host serving the current request (e.g. express `req.hostname`). When
   * known, a referring domain on our own site is treated exactly like the
   * `$direct` sentinel: the analytics SDK stamps its "initial" referrer at
   * first boot in a storage context, which can happen on an interior page
   * after an internal navigation — and an internal navigation must never
   * establish acquisition (SCRUM-87). The filter lives here, not in the
   * client snapshot, because this parse is the single choke point every
   * producer goes through and a modified or stale client cannot bypass it.
   */
  ownHost?: string | null;
}

/** Same site when the hosts are equal or one is a subdomain of the other
 *  (`www.datatorag.com` vs `datatorag.com`, either way around). */
function isOwnDomain(domain: string, ownHost: string): boolean {
  const a = domain.toLowerCase().replace(/\.$/, "");
  const b = ownHost.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Read an attribution snapshot out of any string-keyed bag — an express
 * `req.query`, a parsed cookie payload, a `URLSearchParams`. Absent, blank,
 * non-string and sentinel values all normalise to null, so a caller never
 * has to distinguish "missing" from "junk". A same-origin referring domain
 * normalises to null too, when the caller can name its own host.
 */
export function parseAttribution(
  source: Record<string, unknown> | URLSearchParams | null | undefined,
  opts?: ParseAttributionOptions
): Attribution {
  if (!source) return { ...EMPTY };
  const get =
    source instanceof URLSearchParams
      ? (name: string) => source.get(name)
      : (name: string) => source[name];
  const out = { ...EMPTY };
  for (const field of ATTRIBUTION_FIELDS) {
    out[field] = normalize(get(ATTRIBUTION_PARAMS[field]));
  }
  if (
    out.referringDomain &&
    opts?.ownHost &&
    isOwnDomain(out.referringDomain, opts.ownHost)
  ) {
    out.referringDomain = null;
  }
  return out;
}

/**
 * Serialise back to the wire names, so anything that has to re-read a
 * snapshot (the cookie stash) goes through `parseAttribution` again rather
 * than growing its own copy of the field-name mapping.
 */
export function toWireParams(a: Attribution): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of ATTRIBUTION_FIELDS) {
    const value = a[field];
    if (value) out[ATTRIBUTION_PARAMS[field]] = value;
  }
  return out;
}

/** True when the snapshot carries nothing worth persisting or forwarding. */
export function isEmptyAttribution(a: Attribution): boolean {
  return ATTRIBUTION_FIELDS.every((field) => a[field] === null);
}

// Matched as substrings of the referring domain, so "www.google.co.uk" and
// "search.brave.com" both land. Deliberately short lists: an unrecognised
// referrer falls through to Referral, which is a correct answer, not a wrong
// one.
const SEARCH_DOMAINS = [
  "google.",
  "bing.",
  "yahoo.",
  "duckduckgo.",
  "ecosia.",
  "baidu.",
  "yandex.",
  "brave.com",
  "perplexity.",
];

const SOCIAL_DOMAINS = [
  "facebook.",
  "instagram.",
  "linkedin.",
  "twitter.",
  "x.com",
  "t.co",
  "tiktok.",
  "reddit.",
  "youtube.",
  "threads.",
  "bsky.",
  "news.ycombinator.com",
];

// utm_source values, matched whole after lowercasing.
const PAID_SEARCH_SOURCES = ["google", "bing", "yahoo", "duckduckgo", "adwords"];
const PAID_SOCIAL_SOURCES = [
  "facebook",
  "instagram",
  "linkedin",
  "twitter",
  "x",
  "tiktok",
  "reddit",
];

// utm_medium values that mean an unpaid social post, matched whole. Same set
// the analytics vendor uses for its Organic Social bucket. Needed because our
// own /r/<slug> share links tag `social`, and Reddit does not reliably send a
// referrer — without this the links minted to make Reddit measurable would
// attribute as "Other".
const SOCIAL_MEDIUMS = [
  "social",
  "social-network",
  "social-media",
  "sm",
  "social network",
  "social media",
];

const PAID_MEDIUMS = ["cpc", "ppc", "paid", "paidsearch", "paid_search", "cpm", "cpv", "retargeting"];
const EMAIL_MEDIUMS = ["email", "e-mail", "newsletter"];

function matchesDomain(domain: string, needles: string[]): boolean {
  return needles.some((needle) => domain.includes(needle));
}

/**
 * Derive an acquisition channel from the entry snapshot.
 *
 * The labels match the analytics vendor's channel taxonomy so the two can be
 * compared, but the value is computed here — the vendor derives its own at
 * ingestion time from the session, and a session row is subject to a
 * retention window while a column on the user record is not. Treat this as
 * our durable copy, not as a mirror guaranteed to agree case for case.
 */
export function deriveChannel(a: Attribution): string {
  const source = (a.utmSource ?? "").toLowerCase();
  const medium = (a.utmMedium ?? "").toLowerCase();
  const domain = (a.referringDomain ?? "").toLowerCase();

  // Ad-platform click ids are the strongest signal available and survive a
  // missing or malformed utm set, which is why autotagging is worth more
  // than tagging discipline.
  if (a.gclid || a.gadSource) return "Paid Search";

  if (PAID_MEDIUMS.includes(medium)) {
    if (PAID_SOCIAL_SOURCES.includes(source)) return "Paid Social";
    if (PAID_SEARCH_SOURCES.includes(source)) return "Paid Search";
    return "Paid Other";
  }

  if (EMAIL_MEDIUMS.includes(medium) || source === "email") return "Email";

  if (SOCIAL_MEDIUMS.includes(medium)) return "Organic Social";

  if (domain) {
    if (matchesDomain(domain, SEARCH_DOMAINS)) return "Organic Search";
    if (matchesDomain(domain, SOCIAL_DOMAINS)) return "Organic Social";
    return "Referral";
  }

  if (source || medium) return "Other";
  return "Direct";
}

/**
 * Analytics properties that put a server-side event on the browser session
 * that produced it. `$session_id` is the whole point of this module: without
 * it the event is an orphan with respect to acquisition.
 */
export function sessionProps(
  a: Attribution | null | undefined
): Record<string, unknown> {
  return a?.sessionId ? { $session_id: a.sessionId } : {};
}

/**
 * Flat event properties for the acquisition snapshot, so "which channel and
 * campaign produced this user" is answerable straight off the event without
 * joining to a session row that may have aged out.
 */
export function acquisitionProps(
  a: Attribution | null | undefined
): Record<string, unknown> {
  if (!a || isEmptyAttribution(a)) return {};
  return {
    acquisition_channel: deriveChannel(a),
    acquisition_utm_source: a.utmSource,
    acquisition_utm_medium: a.utmMedium,
    acquisition_utm_campaign: a.utmCampaign,
    acquisition_gclid: a.gclid,
    acquisition_referring_domain: a.referringDomain,
    acquisition_entry_url: a.entryUrl,
  };
}

/**
 * Person properties for the same snapshot. `$set_once` rather than `$set`:
 * acquisition is a first-touch fact, so a later signup attempt from a
 * different session must not overwrite it.
 */
export function acquisitionSetOnce(
  a: Attribution | null | undefined
): Record<string, unknown> {
  const props = acquisitionProps(a);
  return Object.keys(props).length > 0 ? { $set_once: props } : {};
}
