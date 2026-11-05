/**
 * Google Workspace's token calls: the refresh (Google does not rotate the
 * refresh token) and the revoke on disconnect.
 */
import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { serviceConnections } from "@datatorag-mcp/db";
import { revokeGoogleToken } from "@/lib/google-revoke";
import { credentialsFor } from "../credentials";
import { classifyRefreshFailure, refreshSucceededFields } from "../../refresh-failure";
import { refusedRefresh, sealedFor, UNEXPECTED, type ConnectionRef, type RefreshOutcome, type RevokeTokens } from "../../service-token";
import { GOOGLE_TOKEN_URL } from "./oauth";

/**
 * Refresh a Google access token using the stored refresh token.
 */
export async function refreshGoogleToken(
  db: Database,
  conn: ConnectionRef,
  refreshToken: string
): Promise<RefreshOutcome> {
  const { clientId, clientSecret } = credentialsFor("google-workspace");
  if (!clientId || !clientSecret) return null;

  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch (err) {
    return { failure: classifyRefreshFailure(null, err) };
  }
  if (!res.ok) return refusedRefresh(res);

  try {
    const data = (await res.json()) as {
      access_token?: unknown;
      expires_in?: number;
    };
    if (typeof data.access_token !== "string") return UNEXPECTED;

    // An expiry only for a positive number of seconds, as for every connector.
    const expiresAt =
      typeof data.expires_in === "number" && data.expires_in > 0 ? new Date(Date.now() + data.expires_in * 1000) : null;

    await db
      .update(serviceConnections)
      .set({
        accessToken: data.access_token,
        ...sealedFor(conn, { accessToken: data.access_token }),
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

/** Revoking the REFRESH token kills a Google grant including its derived
 * access tokens, so prefer it and fall back to the access token. */
export async function revokeGoogleGrant(tokens: RevokeTokens): Promise<boolean> {
  const token = tokens.refreshToken ?? tokens.accessToken;
  if (!token) return false;
  return revokeGoogleToken(token);
}
