import { randomBytes } from "node:crypto";
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens, users } from "@datatorag-mcp/db";
import { nonceMatches, OAUTH_STATE_TTL_MS } from "./oauth/csrf";
import {
  persistAcquisition,
  stashAttribution,
  takeAttribution,
} from "./attribution";
import { upsertServiceAccount } from "./connected-accounts";
import { PROVIDERS } from "../lib/analytics";
import {
  trackLogin,
  trackOAuthCompleted,
  trackSignup,
} from "./track";
import { sendWelcomeEmail } from "./lifecycle";
import { notifySignup } from "./signup-alert";
import { postLoginDestination } from "./post-login-destination";
import { getEnv } from "@datatorag-mcp/config";

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

  const cookiesAreSecure = config.baseUrl.startsWith("https");

  // --- Dashboard login (minimal scopes) ---

  router.get("/auth/google", (req, res) => {
    // The browser appends its session id and entry snapshot to this link at
    // click time; park them where the callback can read them, since the trip
    // through Google's consent screen loses the query string.
    stashAttribution(req, res, cookiesAreSecure);

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
    // Read before any early return so a failed exchange still clears the
    // stash rather than leaving it to attach to a later, unrelated flow.
    const attribution = takeAttribution(req, res);

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
      // Durable copy first: a session id joins only while the analytics
      // session row survives its retention window, a column on the user does
      // not expire.
      await persistAcquisition(db, user.id, attribution);
      trackSignup(user.id, user.email, user.name, attribution);
      void sendWelcomeEmail({
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        plan: user.plan,
      });
      void notifySignup(db, {
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      });
    } else {
      trackLogin(user.id, user.email, attribution);
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

    // Where EVERY login lands, behind a flag that defaults OFF. The flag used
    // to select a destination for new signups only, so it could not reach a
    // returning user at all; it now decides the surface for everyone, and the
    // same rule applies to both (per HQ decision, see SCRUM-70).
    //
    // The Agent shipped and had to be rolled back twice: the page rendered but
    // never became interactive, and the cause is still unidentified. Routing
    // people there is the part that exposed them, so that is the part the flag
    // switches off - the route itself is harmless while nobody is routed to
    // it, and stays reachable by direct URL so the failure can be observed
    // deliberately instead of by a stranger. With the flag off, every
    // destination is exactly what it was before the Agent existed.
    //
    // ?signup=1 lets the destination fire the Google Ads signup conversion
    // client-side (gtag lives in the browser, not this server callback), and
    // ?welcome=1 is how the Agent tells "landed here" from "navigated here".
    // Both destinations handle the conversion param; see useSignupConversion.
    // Which arm carries which param is the load-bearing part - the table and
    // the reasoning live with postLoginDestination.
    //
    // The `next` parameter proxy.ts sets on the login URL is still not honoured
    // here. Carrying a destination through the OAuth state needs same-origin
    // validation on the way out, and done casually it is an open redirect -
    // more so now that a login has a fixed destination worth overriding.
    res.redirect(
      postLoginDestination({
        agentDefaultView: getEnv().AGENT_DEFAULT_VIEW === "on",
        isNewUser,
      })
    );
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

    stashAttribution(req, res, cookiesAreSecure);

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
    const attribution = takeAttribution(req, res);

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

    await trackOAuthCompleted(
      db,
      session.userId,
      PROVIDERS.GOOGLE_WORKSPACE,
      accountEmail,
      attribution
    );

    res.redirect(`/dashboard/connections?connected=${PROVIDERS.GOOGLE_WORKSPACE}`);
  });

  // --- Atlassian connection (Jira + Confluence) ---

  /** Jira stays on classic scopes; Confluence must be granular.
   *
   * Atlassian's classic Confluence scopes are not accepted by the Confluence
   * v2 REST API — a v2 call made with a classic grant fails
   * `401 Unauthorized; scope does not match`, not 403, so it reads like an
   * auth bug rather than a scope one. The connector calls v2 for every
   * Confluence operation except CQL search, which is why searching worked
   * while reading a page did not: `search:confluence` is already granular and
   * the v1 search endpoint accepted it.
   *
   * Each scope below is the one required by an endpoint the connector
   * actually calls. Adding a Confluence tool that hits a new v2 resource
   * needs its scope added here AND every user to reconnect, because a grant
   * is fixed at consent time.
   *
   * Jira is deliberately untouched: its tools call `/rest/api/3`, which the
   * classic Jira scopes cover, and Atlassian's guidance is to prefer classic
   * where it works.
   */
  const ATLASSIAN_SCOPES = [
    // Jira — /rest/api/3/*
    "read:jira-work",
    "write:jira-work",
    "read:jira-user",
    // Confluence — /wiki/api/v2/*
    "read:space:confluence", // GET /spaces (space key -> id lookup)
    "read:page:confluence", // GET /pages/{id}, GET /spaces/{id}/pages
    "write:page:confluence", // POST /pages, PUT /pages/{id}
    "delete:page:confluence", // DELETE /pages/{id}
    "read:comment:confluence", // GET /pages/{id}/{footer,inline}-comments
    "write:comment:confluence", // POST /footer-comments
    "read:attachment:confluence", // GET /pages/{id}/attachments
    // Confluence — /wiki/rest/api/search (v1; no v2 equivalent for CQL)
    "search:confluence",
    "read:me",
    "offline_access",
  ].join(" ");

  router.get("/auth/atlassian/connect", (req, res) => {
    const sessionToken = req.cookies?.dtrmcp_session;
    if (!sessionToken) {
      res.redirect("/auth/login");
      return;
    }

    // CSRF: use a random nonce as `state` (never the session token — that would
    // leak a live bearer credential into the URL, referrer, and Atlassian's
    // logs). The nonce is echoed back and matched against an httpOnly cookie.
    stashAttribution(req, res, cookiesAreSecure);

    const nonce = randomBytes(16).toString("base64url");
    res.cookie("atl_connect_nonce", nonce, {
      httpOnly: true,
      secure: config.baseUrl.startsWith("https"),
      sameSite: "lax",
      path: "/",
      maxAge: OAUTH_STATE_TTL_MS,
    });

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
    url.searchParams.set("state", nonce);

    res.redirect(url.toString());
  });

  router.get("/auth/atlassian/connect/callback", async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    // Identity comes from the session cookie only — never from `state`.
    const sessionToken = req.cookies?.dtrmcp_session as string | undefined;
    const cookieNonce = req.cookies?.atl_connect_nonce as string | undefined;
    res.clearCookie("atl_connect_nonce", { path: "/" });
    const attribution = takeAttribution(req, res);

    if (!sessionToken) {
      res.redirect("/auth/login");
      return;
    }

    // CSRF: the echoed state must match the nonce cookie from initiation.
    if (!nonceMatches(cookieNonce, state)) {
      res.redirect("/dashboard/connections?error=invalid_state");
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

    await trackOAuthCompleted(
      db,
      session.userId,
      PROVIDERS.ATLASSIAN,
      accountEmail,
      attribution
    );

    res.redirect(`/dashboard/connections?connected=${PROVIDERS.ATLASSIAN}`);
  });

  return router;
}
