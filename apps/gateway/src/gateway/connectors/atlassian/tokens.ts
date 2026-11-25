/**
 * Atlassian's token calls: the refresh, and the one revoke request a
 * disconnect sends. Atlassian documents no revoke, so that request is an
 * attempt: it is sent, and only its status is recorded.
 */
import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { serviceConnections } from "@datatorag-mcp/db";
import { credentialsFor } from "../credentials";
import { classifyRefreshFailure, refreshSucceededFields } from "../../refresh-failure";
import { refusedRefresh, sealedFor, UNEXPECTED, type ConnectionRef, type RefreshOutcome, type RevokeTokens } from "../../service-token";
import { ATLASSIAN_REVOKE_URL, ATLASSIAN_TOKEN_URL } from "./oauth";

/**
 * Refresh an Atlassian access token.
 * Atlassian uses rotating refresh tokens: the response includes a new
 * refresh_token that must replace the old one.
 */
export async function refreshAtlassianToken(
  db: Database,
  conn: ConnectionRef,
  refreshToken: string
): Promise<RefreshOutcome> {
  const { clientId, clientSecret } = credentialsFor("atlassian");
  if (!clientId || !clientSecret) return null;

  let res: Response;
  try {
    res = await fetch(ATLASSIAN_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });
  } catch (err) {
    return { failure: classifyRefreshFailure(null, err) };
  }
  if (!res.ok) return refusedRefresh(res);

  try {
    const data = (await res.json()) as {
      access_token?: unknown;
      refresh_token?: string;
      expires_in?: number;
    };
    if (typeof data.access_token !== "string") return UNEXPECTED;

    // An expiry only for a positive number of seconds, as for every connector.
    const expiresAt =
      typeof data.expires_in === "number" && data.expires_in > 0 ? new Date(Date.now() + data.expires_in * 1000) : null;

    // Atlassian rotates refresh tokens: store the new one
    const rotated = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
    };
    await db
      .update(serviceConnections)
      .set({
        ...sealedFor(conn, rotated),
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
        ...refreshSucceededFields(),
      })
      .where(eq(serviceConnections.id, conn.id));

    return { token: data.access_token };
  } catch {
    return UNEXPECTED;
  }
}

/** As long as Google's revoke is given (`lib/google-revoke.ts`). */
export const ATLASSIAN_REVOKE_TIMEOUT_MS = 5000;

/**
 * What became of an Atlassian disconnect's revoke request: the HTTP status
 * as a string, or a fixed word when there was no HTTP answer. `no_token`:
 * the connection held nothing to send. `not_configured`: no client
 * credentials, so nothing was sent. `skipped_shared` is the caller's, for an
 * account another user also holds.
 */
export type AtlassianRevokeOutcome =
  | `${number}`
  | "timeout"
  | "network_error"
  | "no_token"
  | "not_configured"
  | "skipped_shared";

/**
 * Send ONE revoke request for an Atlassian connection and say what status
 * came back. An experiment: the address is advertised by Atlassian's
 * discovery document (see `ATLASSIAN_REVOKE_URL`) and nothing documents what
 * it does, so a 200 here is NOT evidence that the grant ended, and nothing
 * may rely on it.
 *
 * The request is RFC 7009 with `client_secret_post`: a form body holding the
 * refresh token when there is one, else the access token, its
 * `token_type_hint`, and the client id and secret the refresh uses. The
 * token is in the body, never the address. Redirects are not followed, so a
 * token is never sent to an address this file does not name.
 *
 * Only the status leaves this function. The response's body and headers are
 * never read, and an error is reduced to one of two words, never its message.
 * Never throws, and takes at most `timeoutMs`.
 */
export async function attemptAtlassianRevoke(
  tokens: RevokeTokens,
  timeoutMs: number = ATLASSIAN_REVOKE_TIMEOUT_MS
): Promise<AtlassianRevokeOutcome> {
  try {
    const hint = tokens.refreshToken ? "refresh_token" : "access_token";
    const token = tokens.refreshToken || tokens.accessToken;
    if (!token) return "no_token";
    const { clientId, clientSecret } = credentialsFor("atlassian");
    if (!clientId || !clientSecret) return "not_configured";

    const res = await fetch(ATLASSIAN_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token,
        token_type_hint: hint,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Unread, and let go of so the connection is not held open for it.
    void res.body?.cancel().catch(() => {});
    return `${res.status}`;
  } catch (err) {
    return err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network_error";
  }
}
