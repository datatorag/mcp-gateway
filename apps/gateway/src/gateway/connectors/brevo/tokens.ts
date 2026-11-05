/**
 * Brevo's token calls (SCRUM-468): the refresh, under the shared rotating
 * token lock, and the revoke on disconnect.
 */
import type { Database } from "@datatorag-mcp/db";
import {
  LOCKED_TOKEN_TIMEOUT_MS,
  refreshRotatingToken,
  type ConnectionRef,
  type RefreshOutcome,
  type RevokeTokens,
} from "../../service-token";
import { BREVO_REVOKE_URL, BREVO_TOKEN_URL, brevoClientCredentials } from "./oauth";

/**
 * Refresh a Brevo access token (SCRUM-468), under the rotating-token lock:
 * Brevo's access tokens last an hour, and a refresh may hand back a new
 * refresh token, which replaces the stored one.
 */
export async function refreshBrevoToken(
  db: Database,
  conn: ConnectionRef,
  presentedRefreshToken: string
): Promise<RefreshOutcome> {
  const creds = brevoClientCredentials();
  if (!creds) return null;
  return refreshRotatingToken(db, conn, presentedRefreshToken, {
    label: "brevo",
    call: (refreshToken, signal) =>
      fetch(BREVO_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          refresh_token: refreshToken,
        }),
        signal,
      }),
    expiresAt: (data) =>
      typeof data.expires_in === "number" ? new Date(Date.now() + data.expires_in * 1000) : null,
  });
}

/** Revoke both Brevo tokens, as Notion's are: which of the pair kills the
 * grant is not documented. True when either call was accepted. Never throws. */
export async function revokeBrevoGrant(tokens: RevokeTokens): Promise<boolean> {
  const creds = brevoClientCredentials();
  if (!creds) return false;
  const results = await Promise.all(
    [tokens.accessToken, tokens.refreshToken]
      .filter((t): t is string => typeof t === "string" && t !== "")
      .map(async (token) => {
        try {
          const res = await fetch(BREVO_REVOKE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token, client_id: creds.clientId, client_secret: creds.clientSecret }),
            signal: AbortSignal.timeout(LOCKED_TOKEN_TIMEOUT_MS),
          });
          return res.ok;
        } catch {
          return false;
        }
      })
  );
  return results.some(Boolean);
}
