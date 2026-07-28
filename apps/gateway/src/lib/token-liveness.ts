import { gt, isNull, or } from "drizzle-orm";
import { oauthAccessTokens } from "@datatorag-mcp/db";

/**
 * The one definition of "this access token is live": not revoked and not
 * expired (a NULL expiresAt never expires). Spread into `and(...)` wherever
 * token liveness is checked — session lookup, bearer validation, and the
 * setup-status agent check must never drift apart on this.
 */
export function liveTokenConditions() {
  return [
    isNull(oauthAccessTokens.revokedAt),
    or(
      isNull(oauthAccessTokens.expiresAt),
      gt(oauthAccessTokens.expiresAt, new Date())
    ),
  ];
}

/**
 * Row-level mirror of liveTokenConditions, for call sites that fetch the
 * token row first (e.g. to classify WHY a bearer was rejected). Keep the two
 * definitions in this file in lockstep — they are the same rule in SQL and JS.
 */
export function isTokenLive(row: {
  revokedAt: Date | null;
  expiresAt: Date | null;
}): boolean {
  if (row.revokedAt !== null) return false;
  return row.expiresAt === null || row.expiresAt > new Date();
}
