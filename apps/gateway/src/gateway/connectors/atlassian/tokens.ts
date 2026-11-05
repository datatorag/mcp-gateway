/**
 * Atlassian's token call: the refresh. Atlassian is not told to drop a grant
 * on disconnect, so there is no revoke.
 */
import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { serviceConnections } from "@datatorag-mcp/db";
import { credentialsFor } from "../credentials";
import { classifyRefreshFailure, refreshSucceededFields } from "../../refresh-failure";
import { refusedRefresh, sealedFor, UNEXPECTED, type ConnectionRef, type RefreshOutcome } from "../../service-token";
import { ATLASSIAN_TOKEN_URL } from "./oauth";

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
        ...rotated,
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
