/**
 * PostHog's token calls (SCRUM-471): the refresh, under the shared rotating
 * token lock, and the revoke on disconnect. A metadata-document client has
 * no secret: both send the client id, which is the document's URL.
 */
import type { Database } from "@datatorag-mcp/db";
import { envValue } from "@datatorag-mcp/config";
import {
  LOCKED_TOKEN_TIMEOUT_MS,
  refreshRotatingToken,
  type ConnectionRef,
  type RefreshOutcome,
  type RevokeTokens,
} from "../../service-token";
import { posthogClientId, posthogEndpoints, posthogHost } from "./oauth";

/**
 * Refresh a PostHog access token (SCRUM-471), under the rotating-token lock.
 * A metadata-document client has no secret: the form carries the client id,
 * which is the document's URL. PostHog does not rotate this client's refresh
 * token today; the lock costs nothing and keeps a later change on PostHog's
 * side from losing one. The expiry is stored from `expires_in`, never assumed.
 */
export async function refreshPostHogToken(
  db: Database,
  conn: ConnectionRef,
  presentedRefreshToken: string
): Promise<RefreshOutcome> {
  const baseUrl = envValue("GATEWAY_BASE_URL");
  if (!baseUrl) return null;
  return refreshRotatingToken(db, conn, presentedRefreshToken, {
    label: "posthog",
    call: (refreshToken, signal) =>
      fetch(posthogEndpoints(posthogHost()).token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: posthogClientId(baseUrl),
          refresh_token: refreshToken,
        }),
        signal,
      }),
    expiresAt: (data) =>
      typeof data.expires_in === "number" && data.expires_in > 0 ? new Date(Date.now() + data.expires_in * 1000) : null,
  });
}

/** Revoke a PostHog grant (SCRUM-471): the refresh token, which outlives
 * any access token and is valid until revoked, with the access token as the
 * fallback. Never throws. */
export async function revokePostHogGrant(tokens: RevokeTokens): Promise<boolean> {
  const baseUrl = envValue("GATEWAY_BASE_URL");
  const token = tokens.refreshToken ?? tokens.accessToken;
  if (!baseUrl || !token) return false;
  try {
    const res = await fetch(posthogEndpoints(posthogHost()).revoke, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, client_id: posthogClientId(baseUrl) }),
      signal: AbortSignal.timeout(LOCKED_TOKEN_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
