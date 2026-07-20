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
