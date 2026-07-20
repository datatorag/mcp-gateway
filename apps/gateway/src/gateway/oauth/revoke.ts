import { Router } from "express";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthRefreshTokens } from "@datatorag-mcp/db";
import { hashApiKey } from "@datatorag-mcp/auth";
import { getPosthog } from "../../lib/posthog-server";
import { EVENTS } from "../../lib/analytics";
import { resolveUserEmail, identityProps } from "../user-email";
import { revokeAccessTokensForClient } from "./grants";

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

      // Revoking the grant must also kill any live access tokens for this
      // client — otherwise an already-issued bearer keeps working for up to its
      // full TTL after the client was revoked.
      await revokeAccessTokensForClient(tx, row.userId, row.clientId);

      const ph = getPosthog();
      if (ph) {
        const email = await resolveUserEmail(db, row.userId);
        ph.capture({
          distinctId: row.userId,
          event: EVENTS.OAUTH_TOKEN_REVOKED,
          properties: {
            clientId: row.clientId,
            familyId: row.familyId,
            ...identityProps(email),
          },
        });
      }
    });

    res.status(200).send();
  });

  return router;
}
