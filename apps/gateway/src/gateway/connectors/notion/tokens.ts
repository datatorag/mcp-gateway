/**
 * Notion's token calls (SCRUM-366): the refresh, under the shared rotating
 * token lock, and the revoke on disconnect. Both authenticate with HTTP Basic
 * and a JSON body.
 */
import type { Database } from "@datatorag-mcp/db";
import { credentialsFor } from "../credentials";
import {
  LOCKED_TOKEN_TIMEOUT_MS,
  refreshRotatingToken,
  type ConnectionRef,
  type RefreshOutcome,
  type RevokeTokens,
} from "../../service-token";
import { NOTION_REVOKE_URL, NOTION_TOKEN_URL, notionBasicAuth } from "./oauth";

/**
 * Refresh a Notion access token (SCRUM-366), under the rotating-token lock.
 *
 * Reached through REFRESH_FN only when a stored expiry has passed, and
 * Notion rows store none (Notion sends no `expires_in`, and stage 0 has not
 * yet observed one), so this does not run on any call path today.
 */
export async function refreshNotionToken(
  db: Database,
  conn: ConnectionRef,
  presentedRefreshToken: string
): Promise<RefreshOutcome> {
  const { clientId, clientSecret } = credentialsFor("notion");
  if (!clientId || !clientSecret) return null;
  return refreshRotatingToken(db, conn, presentedRefreshToken, {
    label: "notion",
    call: (refreshToken, signal) =>
      fetch(NOTION_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: notionBasicAuth(clientId, clientSecret),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
        signal,
      }),
    // Notion sends no expiry today, and none is invented: one is stored only
    // for a positive number of seconds, as for every connector.
    expiresAt: (data) =>
      typeof data.expires_in === "number" && data.expires_in > 0 ? new Date(Date.now() + data.expires_in * 1000) : null,
  });
}

/** Revoke one Notion token. Never throws. */
async function revokeNotionToken(token: string): Promise<boolean> {
  const { clientId, clientSecret } = credentialsFor("notion");
  if (!clientId || !clientSecret) return false;
  try {
    const res = await fetch(NOTION_REVOKE_URL, {
      method: "POST",
      headers: {
        Authorization: notionBasicAuth(clientId, clientSecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(LOCKED_TOKEN_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Revoke BOTH Notion tokens. Stage 0 saw a revoked token die at once, but
 * not whether revoking one of the pair kills the other, so neither is left
 * to chance. True when either call was accepted. */
export async function revokeNotionGrant(tokens: RevokeTokens): Promise<boolean> {
  const results = await Promise.all(
    [tokens.accessToken, tokens.refreshToken]
      .filter((t): t is string => typeof t === "string" && t !== "")
      .map(revokeNotionToken)
  );
  return results.some(Boolean);
}
