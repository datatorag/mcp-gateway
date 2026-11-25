import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens, oauthAuthorizationCodes, oauthConsents, oauthRefreshTokens } from "@datatorag-mcp/db";
import { WEB_SESSION_CLIENT_ID } from "@/lib/web-session";
import { dropConnectLinksQuietly } from "../connect-links";
import { dropLinksForUser } from "../file-download";
import { closeLiveSessionsForUser } from "../mcp-session";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Revoke every live access token for one grant, scoped to (userId, clientId).
 *
 * Both revocation triggers — the explicit /oauth/revoke call and refresh-token
 * replay detection — must kill the access-token half of the grant, or a revoked
 * client keeps a working bearer until its TTL. Scoping to the grant's clientId
 * leaves the "web" dashboard-session tokens untouched. Keeping this in one place
 * means a future revocation trigger can't forget the access-token half.
 */
export async function revokeAccessTokensForClient(
  tx: Tx,
  userId: string,
  clientId: string
): Promise<void> {
  await tx
    .update(oauthAccessTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(oauthAccessTokens.userId, userId),
        eq(oauthAccessTokens.clientId, clientId),
        isNull(oauthAccessTokens.revokedAt)
      )
    );
}

/**
 * The client ids that are DataToRAG's own and are never an app a user
 * approved. Dashboard sign-ins are stored under `"web"` in the same token
 * table as an MCP client's tokens, and the dashboard Agent acts inside that
 * session under the same id (`WEB_OAUTH_CLIENT_ID`); nothing else is minted
 * for it. An explicit list, so a second internal id is a line here and not a
 * condition somebody has to remember.
 */
export const INTERNAL_CLIENT_IDS: ReadonlySet<string> = new Set([WEB_SESSION_CLIENT_ID]);

/** Thrown when a grant to one of DataToRAG's own client ids is named. */
export class InternalClientError extends Error {
  constructor() {
    super("this client id is DataToRAG's own and is not an approved app");
    this.name = "InternalClientError";
  }
}

export type EndedGrant = {
  /** Whether anything was there to end. */
  removed: boolean;
  refreshTokensRevoked: number;
  accessTokensRevoked: number;
  /** Authorization codes issued and not yet exchanged, now spent. */
  codesInvalidated: number;
  approvalRemoved: boolean;
  /** How many of the user's live MCP sessions were closed; 0 when nothing
   * was removed; null when this process has no server to close them. */
  sessionsClosed: number | null;
};

/**
 * End one user's grant to one client: the Connections page's Remove.
 *
 * In one transaction: every refresh token of (user, client) that is not
 * already revoked, in every family (a client that signed in twice holds two),
 * every access token of (user, client) that is not already revoked, every
 * authorization code of (user, client) that is unused and unexpired, and the
 * remembered approval, so the client's next sign-in shows the approval page
 * again. Every statement is scoped by both the user and the client id.
 *
 * The codes are marked used (`usedAt`), the state the token endpoint already
 * refuses: its exchange matches a code only where `usedAt` is null. Without
 * that, a code issued in the ten minutes before Remove could still be
 * exchanged for fresh tokens afterwards.
 *
 * After the commit, and only when something was removed: the user's download
 * and upload links and connect links are dropped, and the user's live MCP
 * sessions are closed, as a revoke at `/oauth/revoke` does. Closing is per
 * user, so the user's other clients re-initialize on their next request
 * with bearers that still work; the removed one cannot.
 *
 * Refuses `INTERNAL_CLIENT_IDS` before anything is read: the dashboard's own
 * session must never be ended from here.
 */
export async function endGrantForClient(db: Database, userId: string, clientId: string): Promise<EndedGrant> {
  if (INTERNAL_CLIENT_IDS.has(clientId)) throw new InternalClientError();

  const counts = await db.transaction(async (tx) => {
    const now = new Date();
    const refresh = await tx
      .update(oauthRefreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(oauthRefreshTokens.userId, userId),
          eq(oauthRefreshTokens.clientId, clientId),
          isNull(oauthRefreshTokens.revokedAt)
        )
      )
      .returning({ id: oauthRefreshTokens.id });
    // The same rows `revokeAccessTokensForClient` revokes, counted.
    const access = await tx
      .update(oauthAccessTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(oauthAccessTokens.userId, userId),
          eq(oauthAccessTokens.clientId, clientId),
          isNull(oauthAccessTokens.revokedAt)
        )
      )
      .returning({ id: oauthAccessTokens.id });
    const codes = await tx
      .update(oauthAuthorizationCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(oauthAuthorizationCodes.userId, userId),
          eq(oauthAuthorizationCodes.clientId, clientId),
          isNull(oauthAuthorizationCodes.usedAt),
          gt(oauthAuthorizationCodes.expiresAt, now)
        )
      )
      .returning({ id: oauthAuthorizationCodes.id });
    const approval = await tx
      .delete(oauthConsents)
      .where(and(eq(oauthConsents.userId, userId), eq(oauthConsents.clientId, clientId)))
      .returning({ id: oauthConsents.id });
    return {
      refreshTokensRevoked: refresh.length,
      accessTokensRevoked: access.length,
      codesInvalidated: codes.length,
      approvalRemoved: approval.length > 0,
    };
  });

  const removed =
    counts.refreshTokensRevoked > 0 ||
    counts.accessTokensRevoked > 0 ||
    counts.codesInvalidated > 0 ||
    counts.approvalRemoved;
  if (!removed) return { removed, ...counts, sessionsClosed: 0 };

  dropLinksForUser(userId);
  await dropConnectLinksQuietly(db, userId);
  const sessionsClosed = await closeLiveSessionsForUser(userId);
  return { removed, ...counts, sessionsClosed };
}
