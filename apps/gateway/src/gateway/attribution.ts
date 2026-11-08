import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";
import type { NextFunction } from "express";
import {
  ATTRIBUTION_PARAMS,
  deriveChannel,
  isEmptyAttribution,
  parseAttribution,
  toWireParams,
  type Attribution,
} from "../lib/attribution";

/**
 * Carrying the browser's attribution snapshot through an OAuth round-trip.
 *
 * Signup and service-connect are redirect flows, not fetches: the browser
 * leaves for the provider's consent screen and comes back to a different
 * route, so query parameters set on the way in are gone by the time the
 * callback runs. A short-lived first-party cookie is the only thing that
 * survives the round-trip, and `sameSite: lax` is what lets it ride along on
 * the provider's top-level GET redirect back to us.
 */
const COOKIE = "dtr_attr";

/** Long enough for a slow consent screen, short enough that a snapshot can't
 *  linger and get stamped on an unrelated flow days later. */
const COOKIE_TTL_MS = 15 * 60 * 1000;

/**
 * The first-touch entry of a visitor, recorded by the server on the page
 * load that brought them in (SCRUM-88): its campaign tags and the external
 * site that referred it. Never overwritten, so the first landing that
 * carried a signal is the one kept, as the analytics SDK keeps its own.
 */
const ENTRY_COOKIE = "dtr_entry";
const ENTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The analytics SDK's own first-party cookie, `ph_<project key>_posthog`. */
const ANALYTICS_COOKIE = /^ph_.+_posthog$/;

/** The SDK ends a session after this long without activity. */
const SESSION_IDLE_MS = 30 * 60 * 1000;

/** Campaign tags as a landing URL carries them, by the field each feeds. */
const CAMPAIGN_QUERY = {
  utm_source: "utmSource",
  utm_medium: "utmMedium",
  utm_campaign: "utmCampaign",
  gclid: "gclid",
  gad_source: "gadSource",
} as const;

type WireBag = Record<string, string>;

/** The fields that say where a visit came from. With `entryUrl` they
 * describe the visit; the session and person ids only identify it. */
const SOURCE_FIELDS = ["utmSource", "utmMedium", "utmCampaign", "gclid", "gadSource", "referringDomain"] as const;
const ENTRY_FIELDS = [...SOURCE_FIELDS, "entryUrl"] as const;

const hasSource = (a: Attribution) => SOURCE_FIELDS.some((f) => a[f] !== null);

/**
 * One page load's acquisition signals as wire params: the URL's own campaign
 * tags, the referrer's host, and the URL itself as the entry. Empty unless
 * there is a tag or a referrer, because a bare URL says nothing about where
 * the visitor came from. A same-site referrer is dropped later, by the parse.
 */
export function entrySignals(entryUrl: string | undefined, referrer: string | null | undefined): WireBag {
  const out: WireBag = {};
  let url: URL | null = null;
  try {
    url = entryUrl ? new URL(entryUrl) : null;
  } catch {
    url = null;
  }
  for (const [name, field] of Object.entries(CAMPAIGN_QUERY)) {
    const value = url?.searchParams.get(name);
    if (value) out[ATTRIBUTION_PARAMS[field]] = value;
  }
  if (referrer && referrer !== "$direct") {
    try {
      out[ATTRIBUTION_PARAMS.referringDomain] = new URL(referrer).host;
    } catch {
      // Not a URL: no referring domain.
    }
  }
  if (Object.keys(out).length === 0) return out;
  if (url) out[ATTRIBUTION_PARAMS.entryUrl] = url.toString();
  return out;
}

/**
 * What the analytics SDK's cookie says, read on the server so it holds on any
 * navigation, not only a decorated click: the distinct id, the session id
 * while that session is still live, and the first-touch entry the SDK
 * recorded (`$initial_person_info`, its entry URL and referrer). A session
 * past its idle timeout or begun on another UTC day is left out, because a
 * stale session id is confidently wrong.
 */
export function analyticsCookieSignals(cookies: Record<string, unknown> | undefined, now: number): WireBag {
  const name = Object.keys(cookies ?? {}).find((k) => ANALYTICS_COOKIE.test(k));
  const raw = name ? cookies?.[name] : undefined;
  if (typeof raw !== "string") return {};
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return {};
    parsed = value as Record<string, unknown>;
  } catch {
    return {};
  }
  const out: WireBag = {};
  const info = parsed.$initial_person_info as { u?: unknown; r?: unknown } | undefined;
  if (info && typeof info === "object") {
    Object.assign(
      out,
      entrySignals(typeof info.u === "string" ? info.u : undefined, typeof info.r === "string" ? info.r : null)
    );
  }
  if (typeof parsed.distinct_id === "string") out[ATTRIBUTION_PARAMS.distinctId] = parsed.distinct_id;
  const session = parsed.$sesid;
  if (Array.isArray(session)) {
    const [lastActivity, sessionId, startedAt] = session as unknown[];
    const live =
      typeof lastActivity === "number" &&
      typeof startedAt === "number" &&
      now - lastActivity <= SESSION_IDLE_MS &&
      new Date(startedAt).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10);
    if (live && typeof sessionId === "string") out[ATTRIBUTION_PARAMS.sessionId] = sessionId;
  }
  return out;
}

function storedEntry(cookies: Record<string, unknown> | undefined): WireBag {
  const raw = cookies?.[ENTRY_COOKIE];
  if (typeof raw !== "string") return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" ? (value as WireBag) : {};
  } catch {
    return {};
  }
}

function requestUrl(req: Request, secure: boolean): string {
  return `${secure ? "https" : "http"}://${req.get("host") ?? req.hostname}${req.originalUrl}`;
}

/** Paths that are not a landing: the server's own flows, the API, assets
 *  and the signed-in dashboard. A provider's redirect back (to a callback, or
 *  on into the dashboard, which keeps the provider's referrer) would otherwise
 *  read as a referral from the provider, and a connect link or a file link
 *  carries its credential in the path, which must never become an entry URL.
 *  Case-insensitive, as the routes are. */
const NOT_A_LANDING = /^\/(auth|oauth|api|_next|mcp|files|connect|dashboard|\.well-known)(\/|$)/i;

/**
 * Record the first landing that carried an acquisition signal (SCRUM-88).
 * Runs on page loads, before any click, so a visitor who never makes the
 * decorated click (a middle click, a new tab, a link copied into the same
 * browser, the analytics SDK blocked) still arrives at signup with where they
 * came from. Kept for 30 days and never overwritten.
 */
export function captureEntry(secure: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const isPage =
      (req.method === "GET" || req.method === "HEAD") &&
      !NOT_A_LANDING.test(req.path) &&
      (req.get("sec-fetch-dest") === "document" || (req.get("accept") ?? "").includes("text/html"));
    if (isPage && !(req.cookies as Record<string, unknown> | undefined)?.[ENTRY_COOKIE]) {
      const signals = entrySignals(requestUrl(req, secure), req.get("referer"));
      const entry = parseAttribution(signals, { ownHost: req.hostname });
      // The entry URL alone is no signal: what is kept must say where from.
      if (hasSource(entry)) {
        res.cookie(ENTRY_COOKIE, JSON.stringify(toWireParams(entry)), {
          httpOnly: true,
          secure,
          sameSite: "lax",
          path: "/",
          maxAge: ENTRY_TTL_MS,
        });
      }
    }
    next();
  };
}

/**
 * Record the snapshot for the flow this request starts. The browser's own
 * decoration, appended at click time, is the precise source and wins field
 * by field. Under it, so a navigation that skipped the decoration still
 * carries one (SCRUM-88): the analytics SDK's cookie, then the entry this
 * server recorded at the visitor's first landing, then this request's own
 * campaign tags and referrer. No-ops when nothing usable arrived.
 */
export function stashAttribution(req: Request, res: Response, secure: boolean): void {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const ownHost = req.hostname;
  // Each source normalised on its own first, so a same-site referrer is gone
  // before a source is judged to have said anything.
  const own = parseAttribution(entrySignals(requestUrl(req, secure), req.get("referer")), { ownHost });
  const sources = [
    parseAttribution(req.query as Record<string, unknown>, { ownHost }),
    parseAttribution(analyticsCookieSignals(cookies, Date.now()), { ownHost }),
    parseAttribution(storedEntry(cookies), { ownHost }),
    // This request names its own URL as an entry only when it also says
    // where it came from; a same-site link into the flow says nothing.
    hasSource(own) ? own : parseAttribution(null),
  ];
  // The entry fields describe one visit, so they come together from the
  // first source that has any; the session and person ids are each the
  // first one present.
  const entry = sources.find((a) => ENTRY_FIELDS.some((f) => a[f] !== null)) ?? null;
  const attribution: Attribution = {
    ...(entry ?? parseAttribution(null)),
    sessionId: sources.find((a) => a.sessionId)?.sessionId ?? null,
    distinctId: sources.find((a) => a.distinctId)?.distinctId ?? null,
  };
  if (isEmptyAttribution(attribution)) return;
  // Stored under the wire names so reading it back is the same parse as a
  // fresh query string — one mapping, not two that can drift.
  res.cookie(COOKIE, JSON.stringify(toWireParams(attribution)), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_TTL_MS,
  });
}

/**
 * Read and clear the stashed snapshot. Always clears, even on a malformed
 * payload, so a bad cookie can't stick to every later flow in the browser.
 * Returns null when there was nothing to read.
 */
export function takeAttribution(req: Request, res: Response): Attribution | null {
  const raw = (req.cookies as Record<string, unknown> | undefined)?.[COOKIE];
  if (typeof raw !== "string" || !raw) return null;
  // Clear before parsing, so even a malformed payload is gone and cannot
  // attach itself to every later flow in this browser.
  res.clearCookie(COOKIE, { path: "/" });
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    // Re-normalise rather than trusting the cookie: it round-tripped through
    // the client, so it gets the same truncation, sentinel and same-origin
    // handling as a fresh query string (covers cookies stashed before the
    // same-origin filter existed).
    const attribution = parseAttribution(parsed as Record<string, unknown>, {
      ownHost: req.hostname,
    });
    return isEmptyAttribution(attribution) ? null : attribution;
  } catch {
    return null;
  }
}

/**
 * Persist the first-touch acquisition snapshot on the user record. Called
 * once, at signup. Never throws — a failed attribution write must not break
 * the login the user is in the middle of.
 */
export async function persistAcquisition(
  db: Database,
  userId: string,
  attribution: Attribution | null
): Promise<void> {
  if (!attribution || isEmptyAttribution(attribution)) return;
  try {
    await db
      .update(users)
      .set({
        acquisitionSessionId: attribution.sessionId,
        acquisitionDistinctId: attribution.distinctId,
        acquisitionChannel: deriveChannel(attribution),
        acquisitionUtmSource: attribution.utmSource,
        acquisitionUtmMedium: attribution.utmMedium,
        acquisitionUtmCampaign: attribution.utmCampaign,
        acquisitionGclid: attribution.gclid,
        acquisitionReferringDomain: attribution.referringDomain,
        acquisitionEntryUrl: attribution.entryUrl,
      })
      .where(eq(users.id, userId));
  } catch (err) {
    console.warn(`[attribution] persist failed for user=${userId}`, err);
  }
}
