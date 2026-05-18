import { Router } from "express";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthRefreshTokens } from "@datatorag-mcp/db";
import { hashApiKey } from "@datatorag-mcp/auth";
import { getPosthog } from "../../lib/posthog-server.js";
import { EVENTS } from "../../lib/analytics.js";

/**
 * RFC 7009 — OAuth 2.0 Token Revocation
 * Always returns 200 to avoid leaking token validity.
 */
export function createRevokeRouter(db: Database): Router {
  const router = Router();

  router.post("/oauth/revoke", async (req, res) => {
    const { token, client_id } = req.body ?? {};

    if (!token || !client_id) {
      // RFC: still 200, do not leak info to malformed callers.
      res.status(200).send();
      return;
    }

    const hash = hashApiKey(token);

    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.tokenHash, hash))
        .for("update")
        .limit(1);

      if (!row || row.clientId !== client_id) return;

      await tx
        .update(oauthRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(oauthRefreshTokens.familyId, row.familyId),
            isNull(oauthRefreshTokens.revokedAt)
          )
        );

      getPosthog()?.capture({
        distinctId: row.userId,
        event: EVENTS.OAUTH_TOKEN_REVOKED,
        properties: { clientId: row.clientId, familyId: row.familyId },
      });
    });

    res.status(200).send();
  });

  return router;
}
