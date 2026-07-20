import { randomBytes } from "node:crypto";
import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthClients, oauthAuthorizationCodes, users } from "@datatorag-mcp/db";
import { safeStringEqual } from "@datatorag-mcp/auth";
import { nonceMatches, OAUTH_STATE_TTL_MS } from "./csrf";

// A redirect_uri is valid only if it's one the client registered. Shared by
// /authorize (up front) and /callback (re-checked, since `state` is user-supplied).
function redirectUriRegistered(
  registeredUris: string[] | undefined,
  redirectUri: string
): boolean {
  return (
    registeredUris?.some((uri) => safeStringEqual(uri, redirectUri)) ?? false
  );
}

/**
 * OAuth2 Authorization Endpoint (MCP clients only)
 *
 * GET /oauth/authorize — validate client, redirect to Google
 * GET /oauth/callback — Google callback, issue auth code to MCP client
 */
export function createAuthorizeRouter(
  db: Database,
  config: {
    googleClientId: string;
    googleClientSecret: string;
    baseUrl: string;
  }
): Router {
  const router = Router();

  router.get("/oauth/authorize", async (req, res) => {
    const {
      client_id,
      redirect_uri,
      response_type,
      code_challenge,
      code_challenge_method,
      state,
      scope,
    } = req.query as Record<string, string>;

    if (response_type !== "code") {
      res.status(400).json({
        error: "unsupported_response_type",
        error_description: "Only 'code' response type is supported",
      });
      return;
    }

    if (!client_id || !redirect_uri || !code_challenge) {
      res.status(400).json({
        error: "invalid_request",
        error_description:
          "client_id, redirect_uri, and code_challenge are required",
      });
      return;
    }

    // Look up registered MCP client
    const [client] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, client_id))
      .limit(1);

    if (!client) {
      res.status(400).json({
        error: "invalid_client",
        error_description: "Unknown client_id",
      });
      return;
    }

    if (!redirectUriRegistered(client.redirectUris as string[], redirect_uri)) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "redirect_uri not registered for this client",
      });
      return;
    }

    // CSRF: bind the Google round-trip to the browser that began it. The nonce
    // lives in an httpOnly cookie and is echoed inside `state`; the callback
    // requires the two to match, so an attacker can't hand a victim a crafted
    // /oauth/authorize link and have the resulting auth code land bound to the
    // victim's Google identity but redeemable by the attacker.
    const nonce = randomBytes(16).toString("base64url");

    // Store OAuth params in state and redirect to Google
    const oauthState = Buffer.from(
      JSON.stringify({
        client_id,
        redirect_uri,
        code_challenge,
        code_challenge_method: code_challenge_method || "S256",
        state,
        scope,
        nonce,
      })
    ).toString("base64url");

    res.cookie("mcp_oauth_nonce", nonce, {
      httpOnly: true,
      secure: config.baseUrl.startsWith("https"),
      sameSite: "lax",
      path: "/",
      maxAge: OAUTH_STATE_TTL_MS,
    });

    const googleAuthUrl = new URL(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    googleAuthUrl.searchParams.set("client_id", config.googleClientId);
    googleAuthUrl.searchParams.set(
      "redirect_uri",
      `${config.baseUrl}/oauth/callback`
    );
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", "openid email profile");
    googleAuthUrl.searchParams.set("state", oauthState);
    googleAuthUrl.searchParams.set("prompt", "select_account");

    res.redirect(googleAuthUrl.toString());
  });

  // Google OAuth callback for MCP clients
  router.get("/oauth/callback", async (req, res) => {
    const { code: googleCode, state: oauthState } = req.query as Record<
      string,
      string
    >;

    // Consume the one-shot nonce cookie up front, on every terminal path — a
    // nonce must never survive a failed callback to be replayed within its TTL.
    const cookieNonce = req.cookies?.mcp_oauth_nonce as string | undefined;
    res.clearCookie("mcp_oauth_nonce", { path: "/" });

    if (!googleCode || !oauthState) {
      res.status(400).send("Missing code or state from Google");
      return;
    }

    let params: {
      client_id: string;
      redirect_uri: string;
      code_challenge: string;
      code_challenge_method: string;
      state?: string;
      scope?: string;
      nonce?: string;
    };
    try {
      params = JSON.parse(Buffer.from(oauthState, "base64url").toString());
    } catch {
      res.status(400).send("Invalid state parameter");
      return;
    }

    // CSRF: the state nonce must match the httpOnly cookie from /authorize.
    if (!nonceMatches(cookieNonce, params.nonce)) {
      res.status(400).send("Invalid or expired authorization request");
      return;
    }

    // Re-validate redirect_uri against the registered client — `state` is
    // user-supplied and must never be trusted to point the auth code anywhere.
    const [client] = await db
      .select({ redirectUris: oauthClients.redirectUris })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, params.client_id))
      .limit(1);
    if (
      !redirectUriRegistered(
        client?.redirectUris as string[] | undefined,
        params.redirect_uri
      )
    ) {
      res.status(400).send("redirect_uri not registered for this client");
      return;
    }

    // Exchange Google auth code for tokens
    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: googleCode,
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          redirect_uri: `${config.baseUrl}/oauth/callback`,
          grant_type: "authorization_code",
        }),
      }
    );

    if (!tokenResponse.ok) {
      res.status(500).send("Failed to exchange Google auth code");
      return;
    }

    const googleTokens = (await tokenResponse.json()) as {
      id_token?: string;
      access_token: string;
    };

    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${googleTokens.access_token}` },
      }
    );

    if (!userInfoResponse.ok) {
      res.status(500).send("Failed to fetch Google user info");
      return;
    }

    const googleUser = (await userInfoResponse.json()) as {
      email: string;
      name?: string;
      picture?: string;
    };

    // Find or create user
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, googleUser.email))
      .limit(1);

    if (!user) {
      [user] = await db
        .insert(users)
        .values({
          email: googleUser.email,
          name: googleUser.name ?? null,
          emailVerified: true,
          avatarUrl: googleUser.picture ?? null,
        })
        .returning();
    }

    // Issue authorization code to the MCP client
    const authCode = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await db.insert(oauthAuthorizationCodes).values({
      code: authCode,
      clientId: params.client_id,
      userId: user.id,
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge,
      codeChallengeMethod: params.code_challenge_method,
      scope: params.scope ?? null,
      expiresAt,
    });

    const redirectUrl = new URL(params.redirect_uri);
    redirectUrl.searchParams.set("code", authCode);
    if (params.state) {
      redirectUrl.searchParams.set("state", params.state);
    }

    res.redirect(redirectUrl.toString());
  });

  return router;
}
