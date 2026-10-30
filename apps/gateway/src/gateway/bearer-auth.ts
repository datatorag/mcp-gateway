import { eq } from "drizzle-orm";
import type { RequestHandler } from "express";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens } from "@datatorag-mcp/db";
import { hashToken } from "@datatorag-mcp/auth";
import { isTokenLive } from "@/lib/token-liveness";
import { WEB_SESSION_CLIENT_ID } from "@/lib/web-session";
import { classifyAuthFailure, type AuthFailureReason } from "./mcp-analytics";

/**
 * The bearer on /mcp is an OAuth access token and nothing else (SCRUM-451).
 *
 * API keys were a second way in (SCRUM-245) and are gone: every client this
 * product supports connects with OAuth, and a second credential was a second
 * surface to secure for no client that needed it. A value in the old key
 * format is now an unknown token like any other, refused with the same
 * challenge.
 */

export type BearerAuth =
  | { ok: true; userId: string; clientId: string }
  | { ok: false; reason: AuthFailureReason; userId: string | null };

/**
 * Resolves a bearer to an identity, or to a classified refusal. The row is
 * fetched without liveness conditions so a refusal names the owner where the
 * row exists (a revoked or expired token still says whose it was) and the
 * failure event attributes; acceptance is exactly isTokenLive.
 */
export async function resolveBearer(db: Database, rawToken: string): Promise<BearerAuth> {
  const [token] = await db
    .select({
      userId: oauthAccessTokens.userId,
      clientId: oauthAccessTokens.clientId,
      revokedAt: oauthAccessTokens.revokedAt,
      expiresAt: oauthAccessTokens.expiresAt,
    })
    .from(oauthAccessTokens)
    // SCRUM-443 release 2: matched by hash; the raw value is no longer read.
    .where(eq(oauthAccessTokens.tokenHash, hashToken(rawToken)))
    .limit(1);
  // A dashboard session shares the table but is not a bearer (SCRUM-374): the
  // cookie that carries it is httpOnly and same-site, and a bearer has neither
  // protection, so a session token copied out of a browser does not open /mcp.
  if (token?.clientId === WEB_SESSION_CLIENT_ID) {
    return { ok: false, reason: "wrong_token_kind", userId: token.userId };
  }
  if (token && isTokenLive(token)) {
    return { ok: true, userId: token.userId, clientId: token.clientId };
  }
  return { ok: false, reason: classifyAuthFailure(token), userId: token?.userId ?? null };
}

/** What the /mcp gate found, for the handler after it. */
export type McpAuthState =
  /** `authorization` says why there is no bearer (SCRUM-464): no header at
   * all, or one that is not `Bearer <token>`. */
  | { header: "missing"; authorization: "absent" | "not_bearer" }
  | { header: "present"; auth: BearerAuth; emptyToken: boolean };

/**
 * The bearer check on /mcp, run BEFORE the body is parsed (SCRUM-437).
 *
 * A tool call can carry a file as base64, so an authenticated caller's body
 * may be far larger than the parser's default. That larger limit is for an
 * authenticated caller only: a request with no bearer, or one that fails, is
 * parsed exactly as before, at the default limit, so it can still say which
 * client it was when it is refused. The handler reads the outcome from
 * `res.locals.mcpAuth` and does not validate again.
 */
export function mcpBearerGate(
  validate: (rawToken: string) => Promise<BearerAuth>,
  parsers: { authed: RequestHandler; unauthed: RequestHandler }
): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    let state: McpAuthState;
    if (!header?.startsWith("Bearer ")) {
      state = { header: "missing", authorization: header === undefined ? "absent" : "not_bearer" };
    } else {
      try {
        state = {
          header: "present",
          auth: await validate(header.slice(7)),
          emptyToken: header.slice(7).trim() === "",
        };
      } catch (err) {
        next(err);
        return;
      }
    }
    res.locals.mcpAuth = state;
    const parse = state.header === "present" && state.auth.ok ? parsers.authed : parsers.unauthed;
    parse(req, res, next);
  };
}
