/**
 * Slack's token calls (SCRUM-454): the refresh, under the shared rotating
 * token lock, and the revoke on disconnect.
 */
import type { Database } from "@datatorag-mcp/db";
import { credentialsFor } from "../credentials";
import { classifySlackRefusal } from "../../refresh-failure";
import { refreshRotatingToken, type ConnectionRef, type RefreshOutcome, type RevokeTokens } from "../../service-token";
import { SLACK_REVOKE_URL, SLACK_TOKEN_TIMEOUT_MS, SLACK_TOKEN_URL } from "./oauth";

/**
 * Refresh a Slack user token (SCRUM-454), under the rotating-token lock.
 *
 * With token rotation on, an access token lasts `expires_in` seconds and each
 * refresh token works once, so the lock is what keeps two concurrent calls
 * from spending it twice. The refresh is `oauth.v2.access` with
 * `grant_type=refresh_token`, form-encoded with the client credentials, and
 * answers HTTP 200 with `ok`; `classifySlackRefusal` decides which `ok: false`
 * codes mean the grant is dead. The expiry is stored from `expires_in`.
 */
export async function refreshSlackToken(
  db: Database,
  conn: ConnectionRef,
  presentedRefreshToken: string
): Promise<RefreshOutcome> {
  const { clientId, clientSecret } = credentialsFor("slack");
  if (!clientId || !clientSecret) return null;
  return refreshRotatingToken(db, conn, presentedRefreshToken, {
    label: "slack",
    call: (refreshToken, signal) =>
      fetch(SLACK_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }).toString(),
        signal,
      }),
    expiresAt: (data) =>
      typeof data.expires_in === "number" && data.expires_in > 0
        ? new Date(Date.now() + data.expires_in * 1000)
        : null,
    // A 429 or a 5xx is a non-2xx; Slack sends its refusals as 200 ok:false.
    refusalIn: (data) => (data.ok === true ? null : classifySlackRefusal(data.error)),
  });
}

/** Revoke a Slack grant (SCRUM-454): `auth.revoke` with the access token as
 * the bearer. True only when Slack answers `ok`. Never throws, and never
 * sends the refresh token. */
export async function revokeSlackGrant(tokens: RevokeTokens): Promise<boolean> {
  if (!tokens.accessToken) return false;
  try {
    const res = await fetch(SLACK_REVOKE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      signal: AbortSignal.timeout(SLACK_TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: unknown };
    return data.ok === true;
  } catch {
    return false;
  }
}
