import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens } from "@datatorag-mcp/db";

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
