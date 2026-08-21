import { eq, and } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { serviceConnections, connectedAccounts } from "@datatorag-mcp/db";
import { revokeGoogleToken } from "@/lib/google-revoke";

/** Mapping from plugin slug to the service connection it needs. */
export const PLUGIN_SERVICE_MAP: Record<string, string> = {
  "gws-mcp": "google-workspace",
  "atlassian-mcp": "atlassian",
};

/** Reverse mapping: service name to plugin slug. */
export const SERVICE_PLUGIN_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(PLUGIN_SERVICE_MAP).map(([slug, service]) => [service, slug])
);

/**
 * Refresh a Google access token using the stored refresh token.
 */
async function refreshGoogleToken(
  db: Database,
  connectionId: string,
  refreshToken: string
): Promise<string | null> {
  const clientId = process.env.GOOGLE_GWS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GWS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    await db
      .update(serviceConnections)
      .set({
        accessToken: data.access_token,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(serviceConnections.id, connectionId));

    return data.access_token;
  } catch {
    return null;
  }
}

/**
 * Refresh an Atlassian access token.
 * Atlassian uses rotating refresh tokens — the response includes a new
 * refresh_token that must replace the old one.
 */
async function refreshAtlassianToken(
  db: Database,
  connectionId: string,
  refreshToken: string
): Promise<string | null> {
  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    // Atlassian rotates refresh tokens — store the new one
    await db
      .update(serviceConnections)
      .set({
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? refreshToken,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(serviceConnections.id, connectionId));

    return data.access_token;
  } catch {
    return null;
  }
}

/** Service-specific refresh function lookup. */
const REFRESH_FN: Record<
  string,
  (db: Database, connId: string, rt: string) => Promise<string | null>
> = {
  "google-workspace": refreshGoogleToken,
  atlassian: refreshAtlassianToken,
};

/** Service-specific upstream revocation, beside REFRESH_FN because this is
 * the same dispatch: per-provider OAuth mechanics keyed by service. A
 * provider with no entry simply has no upstream revocation yet — adding one
 * is a row here, not another branch at the call sites.
 *
 * Atlassian is absent deliberately: its revocation story is its own piece of
 * work and guessing at it would be worse than the honest gap. */
const REVOKE_FN = new Map<string, (token: string) => Promise<boolean>>([
  ["google-workspace", revokeGoogleToken],
]);

/** Tell the provider to drop a connection's grant before we forget it
 * locally.
 *
 * Deleting only our rows leaves the grant live upstream, where a previously
 * leaked refresh token keeps working. Revoking the REFRESH token kills the
 * whole grant including derived access tokens, so prefer it and fall back to
 * the access token.
 *
 * Strictly best effort, and deliberately never throws: a user who clicked
 * disconnect must never stay connected because a provider was slow or down.
 * The caller deletes regardless of what this returns. */
export async function revokeUpstream(
  service: string,
  tokens: { accessToken?: string | null; refreshToken?: string | null }
): Promise<boolean> {
  // A Map, not an object literal: `service` reaches here from a query
  // parameter, and a plain object would resolve "__proto__" or "constructor"
  // to something that is not a revoke function.
  const revoke = REVOKE_FN.get(service);
  if (!revoke) return false;
  const token = tokens.refreshToken ?? tokens.accessToken;
  if (!token) return false;
  return revoke(token);
}

/** A token together with the ACCOUNT it belongs to.
 *
 * The account half exists for usage attribution (SCRUM-78): when
 * the caller names no account, the gateway still resolves one — the default —
 * and discarding that identity left every agent-surface usage row with a null
 * `account_email`, which is exactly the field metered billing would bill on.
 * Whoever resolves the token is the only party that knows which account it
 * came from, so it says so here. `accountEmail` is null only on the legacy
 * un-migrated path, where the row genuinely has no account attached. */
export type ResolvedServiceToken = {
  token: string;
  accountEmail: string | null;
  /** The granted-scopes string of the resolved connection row (SCRUM-136).
   * Travels with the token because the scope check must judge the account
   * the call will actually run as, not "the" connection. Null on legacy rows
   * that never stored one. */
  scopes: string | null;
};

/**
 * Get a valid access token for a user's service connection, together with the
 * account it was resolved for.
 * Routes through connected_accounts when available, with fallback to direct lookup.
 * Refreshes if expired and refresh token is available.
 */
export async function resolveServiceToken(
  db: Database,
  userId: string,
  service: string,
  accountEmail?: string
): Promise<ResolvedServiceToken | null> {
  // Route through connected_accounts via single join
  const accountConditions = [
    eq(connectedAccounts.userId, userId),
    eq(connectedAccounts.connectorType, service),
  ];

  if (accountEmail) {
    accountConditions.push(eq(connectedAccounts.accountEmail, accountEmail));
  } else {
    accountConditions.push(eq(connectedAccounts.isDefault, true));
  }

  type ConnRow = {
    id: string;
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
    scopes: string | null;
    /** Null only on the legacy path, where no connected_accounts row exists
     * and there is genuinely no account identity to report. */
    accountEmail: string | null;
  };

  let conn: ConnRow | undefined = (
    await db
      .select({
        id: serviceConnections.id,
        accessToken: serviceConnections.accessToken,
        refreshToken: serviceConnections.refreshToken,
        tokenExpiresAt: serviceConnections.tokenExpiresAt,
        scopes: serviceConnections.scopes,
        accountEmail: connectedAccounts.accountEmail,
      })
      .from(connectedAccounts)
      .innerJoin(
        serviceConnections,
        eq(connectedAccounts.serviceConnectionId, serviceConnections.id)
      )
      .where(and(...accountConditions))
      .limit(1)
  )[0];

  // Fallback: direct lookup for un-migrated rows (no explicit account requested)
  if (!conn && !accountEmail) {
    const [legacy] = await db
      .select({
        id: serviceConnections.id,
        accessToken: serviceConnections.accessToken,
        refreshToken: serviceConnections.refreshToken,
        tokenExpiresAt: serviceConnections.tokenExpiresAt,
        scopes: serviceConnections.scopes,
      })
      .from(serviceConnections)
      .where(
        and(
          eq(serviceConnections.userId, userId),
          eq(serviceConnections.service, service)
        )
      )
      .limit(1);
    if (legacy) conn = { ...legacy, accountEmail: null };
  }

  if (!conn) return null;
  const resolvedEmail = conn.accountEmail;

  const isExpired =
    conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() < Date.now();

  if (!isExpired)
    return {
      token: conn.accessToken,
      accountEmail: resolvedEmail,
      scopes: conn.scopes,
    };

  if (conn.refreshToken) {
    const refreshFn = REFRESH_FN[service];
    if (refreshFn) {
      const newToken = await refreshFn(db, conn.id, conn.refreshToken);
      // A refresh never widens the grant, so the stored scopes still hold.
      if (newToken)
        return { token: newToken, accountEmail: resolvedEmail, scopes: conn.scopes };
    }
  }

  return null;
}

/** The token alone, for call sites that do not report usage. */
export async function getServiceToken(
  db: Database,
  userId: string,
  service: string,
  accountEmail?: string
): Promise<string | null> {
  const resolved = await resolveServiceToken(db, userId, service, accountEmail);
  return resolved?.token ?? null;
}
