import { and, eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens } from "@datatorag-mcp/db";
import { liveTokenConditions } from "./token-liveness";

/** The client id every dashboard sign-in is stored under. A web session and an
 * MCP access token share `oauth_access_tokens`; this is what tells them apart. */
export const WEB_SESSION_CLIENT_ID = "web";

/**
 * The user a dashboard session cookie belongs to, or null (SCRUM-374).
 *
 * The one lookup every reader of the cookie uses: the Next routes through
 * `getSessionUserId`, and the Express connect routes in `gateway/auth.ts`. It
 * matches a WEB session that is live. An MCP client's access token set as the
 * cookie, or a session revoked at logout, or one past its expiry, is no
 * session. Kept apart from `session.ts`, which imports `next/headers`, so the
 * Express server can use it.
 */
export async function liveWebSessionUserId(
  db: Database,
  rawToken: string | null | undefined
): Promise<string | null> {
  if (!rawToken) return null;
  const [token] = await db
    .select({ userId: oauthAccessTokens.userId })
    .from(oauthAccessTokens)
    .where(
      and(
        eq(oauthAccessTokens.token, rawToken),
        eq(oauthAccessTokens.clientId, WEB_SESSION_CLIENT_ID),
        ...liveTokenConditions()
      )
    )
    .limit(1);
  return token?.userId ?? null;
}
