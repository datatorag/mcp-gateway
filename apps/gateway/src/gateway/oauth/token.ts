import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router } from "express";
import type { Request, Response } from "express";
import { eq, and, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import {
  oauthAuthorizationCodes,
  oauthAccessTokens,
  oauthRefreshTokens,
} from "@datatorag-mcp/db";
import { hashApiKey, safeStringEqual } from "@datatorag-mcp/auth";
import { getPosthog } from "../../lib/posthog-server.js";
import { EVENTS } from "../../lib/analytics.js";

// PR3 drops ACCESS_TOKEN_TTL_MS to 60*60*1000 (1h) once refresh path is stable.
const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;

type RefreshResult =
  | { kind: "invalid" }
  | { kind: "expired"; row: typeof oauthRefreshTokens.$inferSelect }
  | { kind: "replay"; row: typeof oauthRefreshTokens.$inferSelect }
  | {
      kind: "ok";
      row: typeof oauthRefreshTokens.$inferSelect;
      newAccessToken: string;
      newRefreshToken: string;
      newRefreshId: string;
    };

/**
 * OAuth2 Token Endpoint
 *
 * POST /oauth/token — exchange authorization code for access token,
 * or rotate a refresh token. Requires PKCE for authorization_code.
 */
export function createTokenRouter(db: Database): Router {
  const router = Router();

  router.post("/oauth/token", async (req, res) => {
    const {
      grant_type,
      code,
      redirect_uri,
      client_id,
      code_verifier,
    } = req.body ?? {};

    if (grant_type === "refresh_token") {
      await handleRefreshGrant(db, req, res);
      return;
    }

    if (grant_type !== "authorization_code") {
      res.status(400).json({
        error: "unsupported_grant_type",
        error_description: "Supported grants: authorization_code, refresh_token",
      });
      return;
    }

    if (!code || !redirect_uri || !client_id || !code_verifier) {
      res.status(400).json({
        error: "invalid_request",
        error_description:
          "code, redirect_uri, client_id, and code_verifier are required",
      });
      return;
    }

    const [authCode] = await db
      .select()
      .from(oauthAuthorizationCodes)
      .where(
        and(
          eq(oauthAuthorizationCodes.code, code),
          isNull(oauthAuthorizationCodes.usedAt)
        )
      )
      .limit(1);

    if (!authCode) {
      res.status(400).json({
        error: "invalid_grant",
        error_description: "Invalid or already used authorization code",
      });
      return;
    }

    if (authCode.expiresAt < new Date()) {
      res.status(400).json({
        error: "invalid_grant",
        error_description: "Authorization code has expired",
      });
      return;
    }

    const clientMatches = safeStringEqual(authCode.clientId, client_id);
    const redirectMatches = safeStringEqual(authCode.redirectUri, redirect_uri);
    if (!clientMatches || !redirectMatches) {
      res.status(400).json({
        error: "invalid_grant",
        error_description: "client_id or redirect_uri mismatch",
      });
      return;
    }

    const computedChallenge = createHash("sha256")
      .update(code_verifier)
      .digest("base64url");

    if (!safeStringEqual(computedChallenge, authCode.codeChallenge ?? "")) {
      res.status(400).json({
        error: "invalid_grant",
        error_description: "PKCE code_verifier does not match code_challenge",
      });
      return;
    }

    await db
      .update(oauthAuthorizationCodes)
      .set({ usedAt: new Date() })
      .where(eq(oauthAuthorizationCodes.id, authCode.id));

    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = randomBytes(32).toString("base64url");
    const refreshTokenHash = hashApiKey(refreshToken);
    const now = Date.now();
    const familyId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(oauthAccessTokens).values({
        token: accessToken,
        clientId: client_id,
        userId: authCode.userId,
        scope: authCode.scope,
        expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
      });
      await tx.insert(oauthRefreshTokens).values({
        tokenHash: refreshTokenHash,
        clientId: client_id,
        userId: authCode.userId,
        scope: authCode.scope,
        expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
        familyId,
      });
    });

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: authCode.scope ?? "mcp:tools",
    });
  });

  return router;
}

async function handleRefreshGrant(
  db: Database,
  req: Request,
  res: Response
): Promise<void> {
  const { refresh_token, client_id } = req.body ?? {};

  if (!refresh_token || !client_id) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "refresh_token and client_id are required",
    });
    return;
  }

  const hash = hashApiKey(refresh_token);

  try {
    const result: RefreshResult = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.tokenHash, hash))
        .for("update")
        .limit(1);

      if (!row || !safeStringEqual(row.clientId, client_id)) {
        return { kind: "invalid" };
      }
      if (row.expiresAt < new Date()) {
        return { kind: "expired", row };
      }
      if (row.revokedAt) {
        await tx
          .update(oauthRefreshTokens)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(oauthRefreshTokens.familyId, row.familyId),
              isNull(oauthRefreshTokens.revokedAt)
            )
          );
        return { kind: "replay", row };
      }

      const newAccessToken = randomBytes(32).toString("base64url");
      const newRefreshToken = randomBytes(32).toString("base64url");
      const now = Date.now();

      await tx.insert(oauthAccessTokens).values({
        token: newAccessToken,
        clientId: row.clientId,
        userId: row.userId,
        scope: row.scope,
        expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
      });
      const [inserted] = await tx
        .insert(oauthRefreshTokens)
        .values({
          tokenHash: hashApiKey(newRefreshToken),
          clientId: row.clientId,
          userId: row.userId,
          scope: row.scope,
          expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
          familyId: row.familyId,
        })
        .returning({ id: oauthRefreshTokens.id });
      await tx
        .update(oauthRefreshTokens)
        .set({ revokedAt: new Date(), replacedByTokenId: inserted.id })
        .where(eq(oauthRefreshTokens.id, row.id));

      return {
        kind: "ok",
        row,
        newAccessToken,
        newRefreshToken,
        newRefreshId: inserted.id,
      };
    });

    const ph = getPosthog();

    switch (result.kind) {
      case "invalid":
        res.status(400).json({
          error: "invalid_grant",
          error_description: "Unknown or mismatched refresh token",
        });
        return;
      case "expired":
        ph?.capture({
          distinctId: result.row.userId,
          event: EVENTS.OAUTH_REFRESH_EXPIRED,
          properties: { clientId: result.row.clientId },
        });
        res.status(400).json({
          error: "invalid_grant",
          error_description: "Refresh token expired",
        });
        return;
      case "replay":
        ph?.capture({
          distinctId: result.row.userId,
          event: EVENTS.OAUTH_REFRESH_REPLAY,
          properties: {
            clientId: result.row.clientId,
            familyId: result.row.familyId,
          },
        });
        res.status(400).json({
          error: "invalid_grant",
          error_description: "Refresh token revoked",
        });
        return;
      case "ok":
        ph?.capture({
          distinctId: result.row.userId,
          event: EVENTS.OAUTH_REFRESH_SUCCEEDED,
          properties: {
            clientId: result.row.clientId,
            familyId: result.row.familyId,
            newRefreshId: result.newRefreshId,
          },
        });
        res.json({
          access_token: result.newAccessToken,
          token_type: "Bearer",
          expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
          refresh_token: result.newRefreshToken,
          scope: result.row.scope ?? "mcp:tools",
        });
        return;
    }
  } catch (err) {
    // Surfacing the error to the client would leak DB internals — keep it generic.
    res.status(500).json({ error: "server_error" });
    throw err;
  }
}
