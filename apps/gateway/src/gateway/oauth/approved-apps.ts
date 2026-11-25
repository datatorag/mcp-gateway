import { and, eq, gt, inArray, isNull, max, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens, oauthClients, oauthConsents, oauthRefreshTokens } from "@datatorag-mcp/db";
import { cleanClientName } from "../untrusted-text";
import { redirectHost } from "./consent";
import { INTERNAL_CLIENT_IDS } from "./grants";

/** One client a user approved, as the Connections page lists it. */
export type ApprovedApp = {
  clientId: string;
  /** The name the client registered with, which it chose itself and nobody
   * verified: cleaned and capped, to be shown as text. Null when it gave none. */
  name: string | null;
  /** The hosts of its registered redirect addresses, as the approval page
   * shows one: the URL parser's ASCII (punycode) form. */
  redirectHosts: string[];
  /** When the user approved it. Null when there is no approval row: a
   * registration approved before the approval page existed. */
  approvedAt: string | null;
  /** When it was last issued a token: the newest of its access and refresh
   * tokens for this user, live or not. */
  lastTokenAt: string | null;
};

const newest = (a: Date | null, b: Date | null): Date | null => (a && b ? (a > b ? a : b) : (a ?? b));

function hostsOf(redirectUris: unknown): string[] {
  if (!Array.isArray(redirectUris)) return [];
  const hosts = new Set<string>();
  for (const uri of redirectUris) {
    if (typeof uri !== "string") continue;
    try {
      hosts.add(redirectHost(uri));
    } catch {
      // A stored address that no longer parses names no host.
    }
  }
  return [...hosts];
}

/**
 * The clients this user approved: every client id with an approval row OR a
 * token that is live (not revoked, not expired), except DataToRAG's own
 * (`INTERNAL_CLIENT_IDS`). One entry per client id, never merged by name: a
 * client that registers again is a new client, and merging would let a
 * look-alike sit behind a real one. Newest activity first.
 */
export async function listApprovedApps(db: Database, userId: string): Promise<ApprovedApp[]> {
  const now = new Date();
  const [approvals, access, refresh] = await Promise.all([
    db
      .select({ clientId: oauthConsents.clientId, approvedAt: oauthConsents.createdAt })
      .from(oauthConsents)
      .where(eq(oauthConsents.userId, userId)),
    db
      .select({
        clientId: oauthAccessTokens.clientId,
        last: max(oauthAccessTokens.createdAt),
        live: sql<boolean>`bool_or(${and(isNull(oauthAccessTokens.revokedAt), gt(oauthAccessTokens.expiresAt, now))})`,
      })
      .from(oauthAccessTokens)
      .where(eq(oauthAccessTokens.userId, userId))
      .groupBy(oauthAccessTokens.clientId),
    db
      .select({
        clientId: oauthRefreshTokens.clientId,
        last: max(oauthRefreshTokens.createdAt),
        live: sql<boolean>`bool_or(${and(isNull(oauthRefreshTokens.revokedAt), gt(oauthRefreshTokens.expiresAt, now))})`,
      })
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.userId, userId))
      .groupBy(oauthRefreshTokens.clientId),
  ]);

  const approvedAt = new Map(approvals.map((a) => [a.clientId, a.approvedAt]));
  const lastTokenAt = new Map<string, Date | null>();
  const live = new Set<string>();
  for (const row of [...access, ...refresh]) {
    lastTokenAt.set(row.clientId, newest(lastTokenAt.get(row.clientId) ?? null, row.last));
    if (row.live) live.add(row.clientId);
  }

  const clientIds = [...new Set([...approvedAt.keys(), ...live])].filter((id) => !INTERNAL_CLIENT_IDS.has(id));
  if (clientIds.length === 0) return [];

  const registered = await db
    .select({
      clientId: oauthClients.clientId,
      clientName: oauthClients.clientName,
      redirectUris: oauthClients.redirectUris,
    })
    .from(oauthClients)
    .where(inArray(oauthClients.clientId, clientIds));
  const byId = new Map(registered.map((c) => [c.clientId, c]));

  const at = (app: { approvedAt: Date | null; lastTokenAt: Date | null }) =>
    newest(app.approvedAt, app.lastTokenAt)?.getTime() ?? 0;
  return clientIds
    .map((clientId) => ({
      clientId,
      client: byId.get(clientId),
      approvedAt: approvedAt.get(clientId) ?? null,
      lastTokenAt: lastTokenAt.get(clientId) ?? null,
    }))
    .sort((a, b) => at(b) - at(a) || a.clientId.localeCompare(b.clientId))
    .map((app) => ({
      clientId: app.clientId,
      name: cleanClientName(app.client?.clientName),
      redirectHosts: hostsOf(app.client?.redirectUris),
      approvedAt: app.approvedAt?.toISOString() ?? null,
      lastTokenAt: app.lastTokenAt?.toISOString() ?? null,
    }));
}
