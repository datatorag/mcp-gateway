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
import {
  postLoginDestination,
  resolveNextPath,
} from "./post-login-destination";
import { postConnectDestination } from "./post-connect-destination";
import { GWS_SCOPE_LIST, scopeDelta } from "./scope-grant";
import { getEnv } from "@datatorag-mcp/config";

/** Where the requested route (`?next=` on the login URL) survives the trip
 * through Google's consent screen, which loses the query string — the same
 * mechanism attribution already uses. httpOnly, short-lived, and holding
 * only an already-validated same-origin path; the callback validates AGAIN
 * on the way out (inside postLoginDestination), because the redirect is the
 * moment an open redirect becomes real. */
const NEXT_COOKIE = "dtr_next";

/** The Google Workspace connect flow's one-shot CSRF nonce (SCRUM-86), the
 * sibling of `atl_connect_nonce` and the plugin flow's `dtr_connect_nonce`.
 * Its own cookie per flow, so concurrent connects cannot consume each
 * other's binding. */
const GWS_CONNECT_NONCE_COOKIE = "gws_connect_nonce";

/** The dashboard LOGIN flow's one-shot CSRF nonce (SCRUM-124). Login was the
 * one OAuth-initiating flow here that bound nothing: it built the Google URL
 * with no `state` and the callback exchanged any code arriving on the
 * redirect, so an attacker could complete Google auth as themselves, withhold
 * the callback, and hand the URL to a victim, whose browser would then plant a
 * session cookie bound to the ATTACKER's account. A subsequent Workspace
 * connect would store the victim's Gmail and Drive tokens under the attacker's
 * user, readable through /mcp. Its own cookie, like every sibling flow, so
 * concurrent flows cannot consume each other's binding. */
const LOGIN_NONCE_COOKIE = "login_state_nonce";

/** Where the service-CONNECT flows park the validated return path (SCRUM-78):
 * the agent offers an inline Connect control, and the OAuth round trip has to
 * land back in that conversation rather than on the connections page. A
 * SEPARATE cookie from both `dtr_next` and the CSRF nonce above — the return
 * path and the CSRF binding are independent concerns, and a login `next` may
 * be parked at the same time, so no two of these may consume each other. */
const CONNECT_NEXT_COOKIE = "dtr_connect_next";

// The list itself lives in scope-grant.ts, next to the code that compares a
// user's grant against it — one list, not a string here and a copy there.
const GWS_SCOPES = GWS_SCOPE_LIST.join(" ");

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

    // Same parking for the requested route (SCRUM-71). Validated BEFORE
    // stashing — an off-origin value never even reaches the cookie jar — and
    // rejected values simply fall back to the normal destination table.
    const next = resolveNextPath(req.query.next);
    if (next !== null) {
      res.cookie(NEXT_COOKIE, next, {
        httpOnly: true,
        secure: cookiesAreSecure,
        sameSite: "lax",
        path: "/",
        maxAge: OAUTH_STATE_TTL_MS,
      });
    }

    // CSRF (SCRUM-124): bind the round trip to the browser that began it, the
    // same one-shot-nonce-as-state pattern every other OAuth-initiating flow
    // here already uses. Without it the callback exchanges ANY code, which is
    // the login-CSRF that lets an attacker seat a victim in the attacker's
    // account. Random, single-use, never the session token.
    const nonce = randomBytes(16).toString("base64url");
    res.cookie(LOGIN_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: cookiesAreSecure,
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
      `${config.baseUrl}/auth/google/callback`
    );
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", "openid email profile");
    googleAuthUrl.searchParams.set("prompt", "select_account");
    googleAuthUrl.searchParams.set("state", nonce);

    res.redirect(googleAuthUrl.toString());
  });

  router.get("/auth/google/callback", async (req, res) => {
    const googleCode = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const cookieNonce = req.cookies?.[LOGIN_NONCE_COOKIE] as string | undefined;
    // One-shot: cleared on EVERY outcome, so a nonce cannot survive a failed
    // callback and be replayed within its TTL.
    res.clearCookie(LOGIN_NONCE_COOKIE, { path: "/" });
    // Read-and-clear the one-shot stashes BEFORE any early return, so the new
    // state-rejection path below cannot leave a cookie behind to attach to a
    // later, unrelated flow — the same one-shot discipline the connect
    // callback already keeps (SCRUM-87/78). The requested route is validated
    // again at redemption inside postLoginDestination regardless.
    const attribution = takeAttribution(req, res);
    const requestedPath = req.cookies?.[NEXT_COOKIE];
    res.clearCookie(NEXT_COOKIE, { path: "/" });

    // CSRF (SCRUM-124): the echoed state must be PRESENT and MATCH the nonce
    // cookie from initiation, BEFORE the code is looked at or exchanged. A
    // missing state is a rejection, never "no binding requested" — falling
    // through on absence would leave the whole guard bypassable by simply
    // omitting the parameter. Exchanging first and rejecting after would still
    // burn the code, so the check gates the exchange, not just the response.
    if (!nonceMatches(cookieNonce, state)) {
      res.redirect("/auth/login?error=invalid_state");
      return;
    }

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
        id: user.id,
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
    // The requested route (`?next=` on the login URL, parked in a cookie at
    // /auth/google) is honoured here — SCRUM-71. The cookie value is treated
    // as untrusted even though we validated it before stashing:
    // postLoginDestination validates it again internally, and rejects to the
    // table below rather than sanitising, because an unvalidated post-login
    // redirect is a phishing primitive (the victim authenticates against OUR
    // real domain and lands on the attacker's).
    res.redirect(
      postLoginDestination({
        agentDefaultView: getEnv().AGENT_DEFAULT_VIEW === "on",
        isNewUser,
        requestedPath,
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
    stashConnectNext(req, res);

    // CSRF (SCRUM-86): bind the round trip to the browser that began it, the
    // same way every other OAuth-initiating flow here already does (Atlassian
    // connect, plugin connect, the gateway's own authorize endpoint). Without
    // `state`, the callback would exchange ANY code arriving on a valid
    // session, which is an account-linking CSRF (threat detail in the private
    // tracker). The nonce is random, one-shot, and never the session token
    // (which must not leak into URLs, referrers, or Google's logs).
    const nonce = randomBytes(16).toString("base64url");
    res.cookie(GWS_CONNECT_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: cookiesAreSecure,
      sameSite: "lax",
      path: "/",
      maxAge: OAUTH_STATE_TTL_MS,
    });

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
    googleAuthUrl.searchParams.set("state", nonce);

    res.redirect(googleAuthUrl.toString());
  });

  router.get("/auth/google/connect/callback", async (req, res) => {
    // INVARIANT — READ THIS BEFORE ADDING AN EARLY RETURN.
    //
    // Three one-shot cookies are consumed at the very top of this handler and
    // MUST run before ANY response is issued, on every path including the
    // rejections: the CSRF nonce clear, `takeAttribution` (SCRUM-87), and
    // `takeConnectNext` (SCRUM-78). Each was added by a different feature, and
    // each is correct only because it sits ABOVE every `res.redirect` below.
    // An early return added above any of them would leave its cookie alive to
    // attach to a LATER, unrelated flow — mis-attributing acquisition or
    // mis-routing a connect for some other user, days later, with no error and
    // nothing pointing back here. Add new early returns BELOW this block, or
    // move a consumer up with it. `auth-callback-ordering.test.ts` pins this
    // by source order so a violation fails the suite instead of shipping quiet.
    const googleCode = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    // Identity comes from the session cookie only — never from `state`.
    const sessionToken = req.cookies?.dtrmcp_session;
    const cookieNonce = req.cookies?.[GWS_CONNECT_NONCE_COOKIE] as
      | string
      | undefined;
    // One-shot: cleared on EVERY outcome, so a nonce cannot survive a failed
    // callback and be replayed within its TTL.
    res.clearCookie(GWS_CONNECT_NONCE_COOKIE, { path: "/" });
    const attribution = takeAttribution(req, res);
    const requestedPath = takeConnectNext(req, res);

    if (!sessionToken) {
      res.redirect("/auth/login");
      return;
    }

    // CSRF (SCRUM-86): the echoed state must match the nonce cookie from
    // initiation — BEFORE the code is looked at and long before any token
    // exchange. A rejected callback must never spend the code it carried:
    // exchanging first and rejecting after would still burn a victim's
    // session into validating an attacker's code.
    //
    // The rejection routes through postConnectDestination like every other
    // failure (SCRUM-78), so a connect started from a thread returns to that
    // thread with its inline error notice rather than a bare page — the parked
    // next was same-origin-validated and already cleared by takeConnectNext
    // above, and an attacker forcing this callback never controls it (it was
    // set on the LEGITIMATE session that began the flow), so honouring it only
    // ever returns the real user to where they actually were. A connect
    // started elsewhere has no parked next and still falls to the connections
    // page — that page's retired-route handling is SCRUM-92, out of scope here.
    if (!nonceMatches(cookieNonce, state)) {
      res.redirect(
        postConnectDestination({ requestedPath, error: "invalid_state" })
      );
      return;
    }

    if (!googleCode) {
      res.redirect(
        postConnectDestination({ requestedPath, error: "missing_code" })
      );
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
      res.redirect(
        postConnectDestination({ requestedPath, error: "token_exchange_failed" })
      );
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
        postConnectDestination({
          requestedPath,
          error: "could_not_resolve_account_email",
        })
      );
      return;
    }

    // SCRUM-136: the consent screen lets the user untick individual scopes,
    // and Google reports what actually came back in `tokens.scope`. The row
    // is upserted EITHER WAY — it is the token store, and the granted subset
    // genuinely works — but a short grant is never recorded as a clean
    // connection: the event carries the delta and the redirect names it, so
    // the landing surface can offer re-consent (the connect URL already sends
    // prompt=consent with the full set, so Google re-prompts).
    const grantDelta = scopeDelta(PROVIDERS.GOOGLE_WORKSPACE, tokens.scope ?? null);

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
      attribution,
      grantDelta
    );

    res.redirect(
      postConnectDestination({
        requestedPath,
        provider: PROVIDERS.GOOGLE_WORKSPACE,
        partialMissing: grantDelta.complete
          ? undefined
          : grantDelta.missing.map((m) => m.displayName),
      })
    );
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
    stashConnectNext(req, res);

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
    const requestedPath = takeConnectNext(req, res);

    if (!sessionToken) {
      res.redirect("/auth/login");
      return;
    }

    // CSRF: the echoed state must match the nonce cookie from initiation.
    if (!nonceMatches(cookieNonce, state)) {
      res.redirect(
        postConnectDestination({ requestedPath, error: "invalid_state" })
      );
      return;
    }

    if (!code) {
      res.redirect(
        postConnectDestination({ requestedPath, error: "missing_code" })
      );
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
      res.redirect(
        postConnectDestination({ requestedPath, error: "token_exchange_failed" })
      );
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
        postConnectDestination({
          requestedPath,
          error: "could_not_resolve_account_email",
        })
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

    res.redirect(
      postConnectDestination({ requestedPath, provider: PROVIDERS.ATLASSIAN })
    );
  });

  /** Park a validated `?next=` for the length of one connect round trip.
   * Validated BEFORE stashing — an off-origin value never reaches the cookie
   * jar — and validated again on the way out inside postConnectDestination. */
  function stashConnectNext(
    req: { query: Record<string, unknown> },
    res: {
      cookie: (name: string, value: string, opts: object) => unknown;
    }
  ): void {
    const next = resolveNextPath(req.query.next);
    if (next === null) return;
    res.cookie(CONNECT_NEXT_COOKIE, next, {
      httpOnly: true,
      secure: cookiesAreSecure,
      sameSite: "lax",
      path: "/",
      maxAge: OAUTH_STATE_TTL_MS,
    });
  }

  /** Read and clear the parked `next`. Always cleared, on every callback
   * outcome, so a stale destination cannot attach itself to a later flow. */
  function takeConnectNext(
    req: { cookies?: Record<string, unknown> },
    res: { clearCookie: (name: string, opts: object) => unknown }
  ): unknown {
    const value = req.cookies?.[CONNECT_NEXT_COOKIE];
    res.clearCookie(CONNECT_NEXT_COOKIE, { path: "/" });
    return value;
  }

  return router;
}
