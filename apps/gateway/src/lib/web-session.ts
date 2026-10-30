import { randomBytes } from "node:crypto";
import type { Response } from "express";
import { and, eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens } from "@datatorag-mcp/db";
import { hashToken } from "@datatorag-mcp/auth";
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
        // SCRUM-443 release 2: matched by hash; the raw value is no longer read.
        eq(oauthAccessTokens.tokenHash, hashToken(rawToken)),
        eq(oauthAccessTokens.clientId, WEB_SESSION_CLIENT_ID),
        ...liveTokenConditions()
      )
    )
    .limit(1);
  return token?.userId ?? null;
}

/** A web session lives this long. */
export const WEB_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Mints a dashboard session for a user and sets its cookie. The Google
 * sign-in and a connect link that has proved who the user is (SCRUM-466) are
 * the only two callers; nothing else makes a session.
 */
export async function createWebSession(db: Database, res: Response, userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + WEB_SESSION_TTL_MS);
  await db.insert(oauthAccessTokens).values({
    token,
    // SCRUM-443 release 1: the hash beside the raw value; reads use the hash.
    tokenHash: hashToken(token),
    clientId: WEB_SESSION_CLIENT_ID,
    userId,
    scope: null,
    expiresAt,
  });
  res.cookie("dtrmcp_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}
