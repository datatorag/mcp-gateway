import { randomBytes } from "node:crypto";
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens, users } from "@datatorag-mcp/db";
import { upsertServiceAccount } from "./connected-accounts.js";
import { PROVIDERS } from "../lib/analytics.js";
import {
  trackLogin,
  trackOAuthCompleted,
  trackSignup,
} from "./track.js";
import { sendWelcomeEmail } from "./lifecycle.js";

const GWS_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/tasks",
].join(" ");

/**
 * Dashboard authentication and service connection routes.
 *
 * GET /auth/google               — redirect to Google consent screen (login)
 * GET /auth/google/callback      — exchange code, set session cookie
 * GET /auth/google/connect       — redirect to Google with full GWS scopes
 * GET /auth/google/connect/callback — store GWS tokens for user
 */
export function createAuthRouter(
  db: Database,
  config: {
    googleClientId: string;
    googleClientSecret: string;
    gwsClientId: string;
    gwsClientSecret: string;
    atlassianClientId: string;
    atlassianClientSecret: string;
    baseUrl: string;
  }
): Router {
  const router = Router();

  // --- Dashboard login (minimal scopes) ---

  router.get("/auth/google", (_req, res) => {
    const googleAuthUrl = new URL(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    googleAuthUrl.searchParams.set("client_id", config.googleClientId);
    googleAuthUrl.searchParams.set(
      "redirect_uri",
      `${config.baseUrl}/auth/google/callback`
    );
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", "openid email profile");
    googleAuthUrl.searchParams.set("prompt", "select_account");

    res.redirect(googleAuthUrl.toString());
  });

  router.get("/auth/google/callback", async (req, res) => {
    const googleCode = req.query.code as string | undefined;

    if (!googleCode) {
      res.status(400).send("Missing code from Google");
      return;
    }

    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: googleCode,
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          redirect_uri: `${config.baseUrl}/auth/google/callback`,
          grant_type: "authorization_code",
        }),
      }
    );

    if (!tokenResponse.ok) {
      res.status(500).send("Failed to exchange Google auth code");
      return;
    }

    const googleTokens = (await tokenResponse.json()) as {
      access_token: string;
    };

    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${googleTokens.access_token}` } }
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

    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, googleUser.email))
      .limit(1);

    let isNewUser = false;
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
      isNewUser = true;
    }

    if (isNewUser) {
      trackSignup(user.id, user.email, user.name);
      void sendWelcomeEmail({
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        plan: user.plan,
      });
    } else {
      trackLogin(user.id, user.email);
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.insert(oauthAccessTokens).values({
      token,
      clientId: "web",
      userId: user.id,
      scope: null,
      expiresAt,
    });

    res.cookie("dtrmcp_session", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });

    // ?signup=1 lets the dashboard fire the Google Ads signup conversion
    // client-side (gtag lives in the browser, not this server callback).
    res.redirect(isNewUser ? "/dashboard?signup=1" : "/dashboard");
  });

  // --- Logout ---

  router.post("/auth/logout", async (req, res) => {
    const sessionToken = req.cookies?.dtrmcp_session;
    if (sessionToken) {
      await db
        .update(oauthAccessTokens)
        .set({ revokedAt: new Date() })
        .where(eq(oauthAccessTokens.token, sessionToken));
    }
    res.clearCookie("dtrmcp_session", { path: "/" });
    res.redirect("/");
  });

  // --- Google Workspace connection (full scopes) ---

  router.get("/auth/google/connect", (req, res) => {
    // Require session cookie
    const sessionToken = req.cookies?.dtrmcp_session;
    if (!sessionToken) {
      res.redirect("/auth/login");
      return;
    }

    const googleAuthUrl = new URL(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    googleAuthUrl.searchParams.set("client_id", config.gwsClientId);
    googleAuthUrl.searchParams.set(
      "redirect_uri",
      `${config.baseUrl}/auth/google/connect/callback`
    );
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", GWS_SCOPES);
    googleAuthUrl.searchParams.set("access_type", "offline");
    googleAuthUrl.searchParams.set("prompt", "consent select_account");

    res.redirect(googleAuthUrl.toString());
  });

  router.get("/auth/google/connect/callback", async (req, res) => {
    const googleCode = req.query.code as string | undefined;
    const sessionToken = req.cookies?.dtrmcp_session;

    if (!sessionToken) {
      res.redirect("/auth/login");
      return;
    }

    if (!googleCode) {
      res.redirect("/dashboard/connections?error=missing_code");
      return;
    }

    // Resolve userId from session
    const [session] = await db
      .select({ userId: oauthAccessTokens.userId })
      .from(oauthAccessTokens)
      .where(eq(oauthAccessTokens.token, sessionToken))
      .limit(1);

    if (!session) {
      res.redirect("/auth/login");
      return;
    }

    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: googleCode,
          client_id: config.gwsClientId,
          client_secret: config.gwsClientSecret,
          redirect_uri: `${config.baseUrl}/auth/google/connect/callback`,
          grant_type: "authorization_code",
        }),
      }
    );

    if (!tokenResponse.ok) {
      res.redirect("/dashboard/connections?error=token_exchange_failed");
      return;
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    // Fetch the email of the connected Google account
    let accountEmail: string | null = null;
    try {
      const userInfoRes = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
      );
      if (userInfoRes.ok) {
        const userInfo = (await userInfoRes.json()) as { email: string };
        accountEmail = userInfo.email;
      }
    } catch {
      // Fall through — accountEmail stays null
    }

    if (!accountEmail) {
      res.redirect(
        "/dashboard/connections?error=could_not_resolve_account_email"
      );
      return;
    }

    await upsertServiceAccount(
      db,
      session.userId,
      PROVIDERS.GOOGLE_WORKSPACE,
      accountEmail,
      tokens,
      GWS_SCOPES,
      expiresAt
    );

    await trackOAuthCompleted(db, session.userId, PROVIDERS.GOOGLE_WORKSPACE, accountEmail);

    res.redirect(`/dashboard/connections?connected=${PROVIDERS.GOOGLE_WORKSPACE}`);
  });

  // --- Atlassian connection (Jira + Confluence) ---

  const ATLASSIAN_SCOPES = [
    "read:jira-work",
    "write:jira-work",
    "read:jira-user",
    "read:confluence-content.all",
    "write:confluence-content",
    "read:confluence-space.summary",
    "write:confluence-file",
    "search:confluence",
    "readonly:content.attachment:confluence",
    "read:me",
    "offline_access",
  ].join(" ");

  router.get("/auth/atlassian/connect", (req, res) => {
    const sessionToken = req.cookies?.dtrmcp_session;
    if (!sessionToken) {
      res.redirect("/auth/login");
      return;
    }

    const url = new URL("https://auth.atlassian.com/authorize");
    url.searchParams.set("audience", "api.atlassian.com");
    url.searchParams.set("client_id", config.atlassianClientId);
    url.searchParams.set(
      "redirect_uri",
      `${config.baseUrl}/auth/atlassian/connect/callback`
    );
    url.searchParams.set("scope", ATLASSIAN_SCOPES);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", sessionToken);

    res.redirect(url.toString());
  });

  router.get("/auth/atlassian/connect/callback", async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const sessionToken = state ?? req.cookies?.dtrmcp_session;

    if (!sessionToken) {
      res.redirect("/auth/login");
      return;
    }

    if (!code) {
      res.redirect("/dashboard/connections?error=missing_code");
      return;
    }

    const [session] = await db
      .select({ userId: oauthAccessTokens.userId })
      .from(oauthAccessTokens)
      .where(eq(oauthAccessTokens.token, sessionToken))
      .limit(1);

    if (!session) {
      res.redirect("/auth/login");
      return;
    }

    const tokenResponse = await fetch(
      "https://auth.atlassian.com/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: config.atlassianClientId,
          client_secret: config.atlassianClientSecret,
          code,
          redirect_uri: `${config.baseUrl}/auth/atlassian/connect/callback`,
        }),
      }
    );

    if (!tokenResponse.ok) {
      res.redirect("/dashboard/connections?error=token_exchange_failed");
      return;
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    // Fetch the email of the connected Atlassian account
    let accountEmail: string | null = null;
    try {
      const meRes = await fetch("https://api.atlassian.com/me", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as { email: string };
        accountEmail = me.email;
      }
    } catch {
      // Fall through — accountEmail stays null
    }

    if (!accountEmail) {
      res.redirect(
        "/dashboard/connections?error=could_not_resolve_account_email"
      );
      return;
    }

    await upsertServiceAccount(
      db,
      session.userId,
      PROVIDERS.ATLASSIAN,
      accountEmail,
      tokens,
      ATLASSIAN_SCOPES,
      expiresAt
    );

    await trackOAuthCompleted(db, session.userId, PROVIDERS.ATLASSIAN, accountEmail);

    res.redirect(`/dashboard/connections?connected=${PROVIDERS.ATLASSIAN}`);
  });

  return router;
}
