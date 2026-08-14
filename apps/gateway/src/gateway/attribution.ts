import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";
import {
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
 * Record the snapshot the browser appended to the inbound redirect. No-ops
 * when nothing usable arrived, so a visitor with the analytics SDK blocked
 * doesn't get a pointless empty cookie.
 */
export function stashAttribution(req: Request, res: Response, secure: boolean): void {
  const attribution = parseAttribution(req.query as Record<string, unknown>, {
    ownHost: req.hostname,
  });
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
