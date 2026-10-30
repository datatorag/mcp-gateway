import { randomBytes } from "node:crypto";
import { Router } from "express";
import { eq, and, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens, users } from "@datatorag-mcp/db";
import { nonceMatches, OAUTH_STATE_TTL_MS, sameOriginRequest } from "./oauth/csrf";
import { createWebSession, liveWebSessionUserId } from "../lib/web-session";
import { signInHref } from "../lib/sign-in";
import { stashAttribution, takeAttribution } from "./attribution";
import { connectedElsewhere, upsertServiceAccount } from "./connected-accounts";
import { CONNECT_START, isDuplicateProvider, renderConnectDuplicate, type DuplicateProvider } from "./connect-duplicate";
import { EVENTS, PROVIDERS } from "../lib/analytics";
import {
  trackConnectDuplicate,
  trackConnectLinkEvent,
  trackConnectRefused,
  trackLogin,
  trackOAuthCompleted,
} from "./track";
import { findOrCreateGoogleUser, onNewUser } from "./signup";
import { skillSlugFromPath } from "../lib/skills";
import { parseAttribution, toWireParams } from "../lib/attribution";
import {
  postLoginDestination,
  resolveNextPath,
} from "./post-login-destination";
import {
  CONNECT_ERROR_CONNECTED_ELSEWHERE,
  CONNECT_ERROR_NO_SERVICES,
  CONNECT_ERROR_NOT_LAUNCHED,
  postConnectDestination,
} from "./post-connect-destination";
import { googleConnectRefusedUrl, renderConnectInterstitial } from "./connect-interstitial";
import { GWS_SCOPE_LIST, grantedServiceCount, scopeDelta, serviceGrantStates } from "./scope-grant";
import { NOTION_AUTHORIZE_URL, NOTION_TOKEN_URL, notionBasicAuth } from "./notion-oauth";
import { hashToken } from "@datatorag-mcp/auth";
import { isServiceLaunched } from "./service-launch";
import { cleanWorkspaceName } from "./untrusted-text";
import { dropLinksForUser } from "./file-download";
import {
  CONNECT_LINK_COOKIE,
  dropConnectLinksQuietly,
  spentConnectLink,
  type ConnectLink,
} from "./connect-links";
import { renderConnectLinkConfirm } from "./connect-link-page";

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

/** The Notion connect flow's one-shot CSRF nonce (SCRUM-366). Its own cookie,
 * like every sibling, so concurrent connects cannot consume each other's. */
const NOTION_CONNECT_NONCE_COOKIE = "notion_connect_nonce";

/** Which Google account a refused connect was attempted with (SCRUM-410), so
 * the retry can go straight to Google's consent screen for that account and
 * skip the account chooser, which read to users as being made to sign in all
 * over again. An email address, so it lives in an httpOnly cookie and never
 * in a URL. Short-lived, used by the retry link alone, and cleared by every
 * connect that starts, whether or not it used it. It is a hint to Google and
 * nothing else: no decision here ever reads it. */
const GWS_CONNECT_HINT_COOKIE = "gws_connect_hint";

/** The email in an id_token's payload, unverified. Good enough for a hint
 * that only preselects an account on Google's own screen; never for
 * identity, which this file takes from the session and from userinfo. */
export function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: unknown };
    return isPlausibleEmail(claims.email) ? claims.email : null;
  } catch {
    return null;
  }
}

function isPlausibleEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value);
}

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
 * GET /auth/atlassian/connect(/callback) — Jira + Confluence
 * GET /auth/notion/connect(/callback)    — one Notion workspace per grant
 */
/** The fields of Notion's token response this file reads. */
type NotionTokenResponse = {
  access_token?: unknown;
  refresh_token?: string | null;
  workspace_id?: unknown;
  workspace_name?: unknown;
  owner?: { type?: string; user?: { person?: { email?: unknown } } };
};

export function createAuthRouter(
  db: Database,
  config: {
    googleClientId: string;
    googleClientSecret: string;
    gwsClientId: string;
    gwsClientSecret: string;
    atlassianClientId: string;
    atlassianClientSecret: string;
    notionClientId: string;
    notionClientSecret: string;
    baseUrl: string;
    /** After a connect stores its account (SCRUM-466): which link it came
     * from, if any, for the events, the waiting tool call and the client's
     * tool list. Never throws into the callback. */
    onConnected?: (event: { userId: string; provider: DuplicateProvider; link: ConnectLink | null }) => void;
  }
): Router {
  const router = Router();

  const cookiesAreSecure = config.baseUrl.startsWith("https");

  // --- "Connect it here anyway" (SCRUM-363) ---
  //
  // The duplicate page's button is a POST that parks the provider in
  // DUP_ACK_PENDING_COOKIE and restarts the connect. The connect start turns
  // that into DUP_ACK_COOKIE holding the NEW connect's nonce, and the callback
  // skips the duplicate check only when that value equals the nonce it just
  // matched. So the acknowledgement is bound to one connect, cannot be carried
  // by a link (no query parameter skips the check), and is spent either way.
  const DUP_ACK_PENDING_COOKIE = "dtr_dup_ack_pending";
  const DUP_ACK_COOKIE = "dtr_dup_ack";
  const oneShot = {
    httpOnly: true,
    secure: cookiesAreSecure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: OAUTH_STATE_TTL_MS,
  };

  /** At a connect start, after its nonce is minted: arm the acknowledgement
   * for this nonce if the duplicate page asked for this provider; otherwise
   * make sure none survives. */
  function armDuplicateAck(
    req: { cookies?: Record<string, unknown> },
    res: { cookie: (n: string, v: string, o: object) => unknown; clearCookie: (n: string, o: object) => unknown },
    provider: DuplicateProvider,
    nonce: string
  ) {
    const pending = req.cookies?.[DUP_ACK_PENDING_COOKIE];
    res.clearCookie(DUP_ACK_PENDING_COOKIE, { path: "/" });
    if (pending === provider) res.cookie(DUP_ACK_COOKIE, nonce, oneShot);
    else res.clearCookie(DUP_ACK_COOKIE, { path: "/" });
  }

  /** At the top of a callback, with the other one-shot cookies: read and
   * clear the acknowledgement, whatever happens next. */
  function takeDuplicateAck(
    req: { cookies?: Record<string, unknown> },
    res: { clearCookie: (n: string, o: object) => unknown }
  ): string | undefined {
    const value = req.cookies?.[DUP_ACK_COOKIE];
    res.clearCookie(DUP_ACK_COOKIE, { path: "/" });
    return typeof value === "string" ? value : undefined;
  }

  /** Before the upsert: when the account is already held by another
   * DataToRAG user and this connect was not acknowledged, store nothing and
   * answer the warning page. True when the page was sent. */
  async function refusedAsDuplicate(
    res: { status: (c: number) => { type: (t: string) => { send: (b: string) => unknown } } },
    opts: {
      userId: string;
      provider: DuplicateProvider;
      accountEmail: string;
      externalAccountId: string | null;
      acknowledged: boolean;
      requestedPath: unknown;
    }
  ): Promise<boolean> {
    if (opts.acknowledged) return false;
    const elsewhere = await connectedElsewhere(
      db,
      opts.userId,
      opts.provider,
      opts.accountEmail,
      opts.externalAccountId
    );
    if (!elsewhere) return false;
    await trackConnectDuplicate(db, opts.userId, opts.provider, "shown");
    res
      .status(200)
      .type("html")
      .send(
        renderConnectDuplicate({
          provider: opts.provider,
          maskedSignIn: elsewhere.otherSignIn,
          backHref: postConnectDestination({
            requestedPath: opts.requestedPath,
            error: CONNECT_ERROR_CONNECTED_ELSEWHERE,
          }),
          next: resolveNextPath(opts.requestedPath),
        })
      );
    return true;
  }

  // --- Who a connect is for (SCRUM-466) ---
  //
  // The live web session, as always. With none, a connect link this browser
  // spent for this provider within the round trip's lifetime stands in for
  // it, for the connect only: no web session exists until the callback has
  // matched the provider account to the link user's sign-in email
  // (`refusedUnconfirmed`). A link with a session for the same user rides
  // along only to say which link the connect came from.
  type ConnectUser = { userId: string; link: ConnectLink | null; viaLink: boolean };

  async function connectUser(
    sessionToken: unknown,
    linkToken: unknown,
    provider: DuplicateProvider
  ): Promise<ConnectUser | null> {
    const sessionUserId = await liveWebSessionUserId(db, typeof sessionToken === "string" ? sessionToken : undefined);
    const spent = linkToken ? await spentConnectLink(db, linkToken, OAUTH_STATE_TTL_MS) : null;
    const link = spent && spent.provider === provider ? spent : null;
    if (sessionUserId) {
      return { userId: sessionUserId, link: link?.userId === sessionUserId ? link : null, viaLink: false };
    }
    return link ? { userId: link.userId, link, viaLink: true } : null;
  }

  /** At the top of a callback, with the other one-shot cookies. */
  function takeConnectLink(
    req: { cookies?: Record<string, unknown> },
    res: { clearCookie: (n: string, o: object) => unknown }
  ): string | undefined {
    const value = req.cookies?.[CONNECT_LINK_COOKIE];
    res.clearCookie(CONNECT_LINK_COOKIE, { path: "/" });
    return typeof value === "string" ? value : undefined;
  }

  /** A connect that only a link vouches for completes when the provider
   * account is the link user's own sign-in email, and the provider says it
   * verified that email. Then the browser gets that
   * user's web session, and the connect goes on. Otherwise nothing is stored
   * and the page asks for a sign-in, which is what stops a link sent to
   * somebody else from attaching THEIR account to its user. True when the
   * page was sent. */
  async function refusedUnconfirmed(
    res: Parameters<typeof refusedAsDuplicate>[0] & Parameters<typeof createWebSession>[1],
    who: ConnectUser,
    provider: DuplicateProvider,
    accountEmail: string,
    emailVerified: boolean
  ): Promise<boolean> {
    if (!who.viaLink) return false;
    const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, who.userId)).limit(1);
    if (emailVerified && owner && owner.email.toLowerCase() === accountEmail.toLowerCase()) {
      await createWebSession(db, res, who.userId);
      return false;
    }
    res
      .status(200)
      .type("html")
      .send(
        renderConnectLinkConfirm({
          provider,
          signInHref: signInHref(`/connect/resume/${provider}`),
        })
      );
    return true;
  }

  function connected(who: ConnectUser, provider: DuplicateProvider): void {
    void trackConnectLinkEvent(who.userId, EVENTS.CONNECT_COMPLETED, {
      provider,
      path: who.link?.path ?? "website",
      clientName: who.link?.clientName ?? null,
    });
    try {
      config.onConnected?.({ userId: who.userId, provider, link: who.link });
    } catch (err) {
      console.error("[auth] onConnected failed:", err instanceof Error ? err.message : err);
    }
  }

  /** Which half of activation a connect belongs to (SCRUM-96): "agent" when
   * it carried a return path into the agent, "connect" otherwise. */
  function connectEntry(requestedPath: unknown): "agent" | "connect" {
    const next = resolveNextPath(requestedPath);
    return next !== null && /^\/dashboard\/agent(\/|\?|$)/.test(next) ? "agent" : "connect";
  }

  function sameOrigin(req: { headers: Record<string, unknown> }): boolean {
    return sameOriginRequest(req.headers.origin, config.baseUrl);
  }


  router.post("/auth/connect/anyway", async (req, res) => {
    if (!sameOrigin(req)) {
      res.status(403).end();
      return;
    }
    const sessionToken = req.cookies?.dtrmcp_session;
    const sessionUserId = await liveWebSessionUserId(db, sessionToken);
    if (!sessionUserId) {
      res.redirect(303, "/auth/login");
      return;
    }
    const provider = req.query.provider;
    if (!isDuplicateProvider(provider)) {
      res.status(400).end();
      return;
    }
    res.cookie(DUP_ACK_PENDING_COOKIE, provider, oneShot);
    await trackConnectDuplicate(db, sessionUserId, provider, "connected_anyway");
    const start = new URL(CONNECT_START[provider], "http://placeholder.invalid");
    const next = resolveNextPath(req.query.next);
    if (next) start.searchParams.set("next", next);
    res.redirect(303, start.pathname + start.search);
  });

  router.post("/auth/connect/switch-account", async (req, res) => {
    if (!sameOrigin(req)) {
      res.status(403).end();
      return;
    }
    const sessionToken = req.cookies?.dtrmcp_session;
    if (sessionToken) {
      const revoked = await db
        .update(oauthAccessTokens)
        .set({ revokedAt: new Date() })
        .where(eq(oauthAccessTokens.tokenHash, hashToken(sessionToken)))
        .returning({ userId: oauthAccessTokens.userId });
      for (const row of revoked) {
        if (!row.userId) continue;
        dropLinksForUser(row.userId);
        await dropConnectLinksQuietly(db, row.userId);
        const provider = req.query.provider;
        if (isDuplicateProvider(provider)) {
          await trackConnectDuplicate(db, row.userId, provider, "signed_in_other");
        }
      }
    }
    res.clearCookie("dtrmcp_session", { path: "/" });
    res.clearCookie(GWS_CONNECT_HINT_COOKIE, { path: "/" });
    res.clearCookie(DUP_ACK_PENDING_COOKIE, { path: "/" });
    res.clearCookie(DUP_ACK_COOKIE, { path: "/" });
    // Sign-in shows Google's account chooser, where the other login is picked.
    res.redirect(303, "/auth/google");
  });

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
    } else {
      // No return path asked for, so none may be left over. A sign-in begun
      // from a button that names one and then abandoned leaves its cookie
      // behind; with every button on the site starting sign-in (SCRUM-408),
      // the next plain "get started" would land on the earlier button's
      // destination.
      res.clearCookie(NEXT_COOKIE, { path: "/" });
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

    // A sign-in that did not finish comes back to the login page, which says
    // so and offers the button again (SCRUM-408). These three used to answer
    // with a bare line of text and nowhere to go, which mattered less when
    // every sign-in began on the login page and matters now that a button
    // anywhere on the site starts one: closing Google's screen is the most
    // ordinary way for this to happen. The code names the leg for our logs
    // and is never shown.
    if (!googleCode) {
      res.redirect("/auth/login?error=cancelled");
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
      console.error("[auth] sign-in code exchange failed:", tokenResponse.status);
      res.redirect("/auth/login?error=exchange_failed");
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
      console.error("[auth] sign-in profile read failed:", userInfoResponse.status);
      res.redirect("/auth/login?error=profile_failed");
      return;
    }

    const googleUser = (await userInfoResponse.json()) as {
      email: string;
      name?: string;
      picture?: string;
    };

    const { user, isNewUser } = await findOrCreateGoogleUser(db, googleUser);

    if (isNewUser) {
      await onNewUser(db, user, {
        entry: "dashboard",
        attribution,
        skill: skillSlugFromPath(requestedPath),
      });
    } else {
      trackLogin(user.id, user.email, attribution, {
        skill: skillSlugFromPath(requestedPath),
      });
    }

    await createWebSession(db, res, user.id);

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
        isNewUser,
        requestedPath,
      })
    );
  });

  // --- Logout ---

  router.post("/auth/logout", async (req, res) => {
    const sessionToken = req.cookies?.dtrmcp_session;
    if (sessionToken) {
      const revoked = await db
        .update(oauthAccessTokens)
        .set({ revokedAt: new Date() })
        .where(eq(oauthAccessTokens.tokenHash, hashToken(sessionToken)))
        .returning({ userId: oauthAccessTokens.userId });
      // Signing out takes the user's open download links with it (SCRUM-420).
      // And its connect links (SCRUM-466).
      for (const row of revoked) {
        if (!row.userId) continue;
        dropLinksForUser(row.userId);
        await dropConnectLinksQuietly(db, row.userId);
      }
    }
    res.clearCookie("dtrmcp_session", { path: "/" });
    // The account a refused connect was tried with belongs to the person
    // who is signing out; the next person at this browser must not find it
    // preselected on Google's screen.
    res.clearCookie(GWS_CONNECT_HINT_COOKIE, { path: "/" });
    // A "connect it here anyway" marker belongs to this person too
    // (SCRUM-363): the next person at this browser must meet the warning.
    res.clearCookie(DUP_ACK_PENDING_COOKIE, { path: "/" });
    res.clearCookie(DUP_ACK_COOKIE, { path: "/" });
    res.redirect("/");
  });

  // --- Google Workspace connection (full scopes) ---

  router.get("/auth/google/connect", async (req, res) => {
    // Require a live web session (SCRUM-374): an expired or revoked one goes
    // to sign in before the round trip to Google, not after it. Or a connect
    // link spent in this browser (SCRUM-466).
    if (!(await connectUser(req.cookies?.dtrmcp_session, req.cookies?.[CONNECT_LINK_COOKIE], PROVIDERS.GOOGLE_WORKSPACE))) {
      res.redirect("/auth/login");
      return;
    }

    // SCRUM-150: the instruction page before the handoff. Google's granular
    // consent brings the service checkboxes up unticked, and the moment
    // before the redirect is the only lever we hold — held HERE, at the one
    // route every connect control links to, so no render site needs to know
    // it exists. The proceed leg below is byte-identical to the old flow;
    // nothing one-shot (nonce, attribution, next) is stashed for a page view.
    if (req.query.proceed !== "1") {
      const next = typeof req.query.next === "string" ? req.query.next : null;
      // The attribution snapshot on the clicked link, by its known names
      // only, handed on to the proceed leg where `stashAttribution` reads it.
      const carry = toWireParams(parseAttribution(req.query as Record<string, unknown>, { ownHost: req.hostname }));
      // SCRUM-410: the same page in its refused form, where a connect that
      // came back from Google with nothing granted is sent. It names what to
      // tick and its button tries again. "Back" returns to wherever the
      // connect started, still carrying the refusal, so that page can say
      // what happened too. `next` is validated before it is used for either.
      if (req.query.refused === "1") {
        const validNext = resolveNextPath(next);
        res
          .status(200)
          .type("html")
          .send(
            renderConnectInterstitial(validNext, {
              services: serviceGrantStates(PROVIDERS.GOOGLE_WORKSPACE, "").map((s) => s.displayName),
              cancelHref: postConnectDestination({
                requestedPath: validNext,
                error: CONNECT_ERROR_NO_SERVICES,
              }),
            }, carry)
          );
        return;
      }
      res.status(200).type("html").send(renderConnectInterstitial(next, undefined, carry));
      return;
    }

    stashAttribution(req, res, cookiesAreSecure);
    stashConnectNext(req, res);

    // The account hint from a refused attempt is used by the retry link
    // alone, and is gone after ANY connect starts: an ordinary Connect click
    // minutes later must offer the account chooser as it always did.
    const hint = req.query.retry === "1" ? req.cookies?.[GWS_CONNECT_HINT_COOKIE] : undefined;
    res.clearCookie(GWS_CONNECT_HINT_COOKIE, { path: "/" });

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
    armDuplicateAck(req, res, PROVIDERS.GOOGLE_WORKSPACE, nonce);

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
    if (isPlausibleEmail(hint)) {
      // Straight to the consent screen for the account just tried. The
      // screen still offers "use another account".
      googleAuthUrl.searchParams.set("prompt", "consent");
      googleAuthUrl.searchParams.set("login_hint", hint);
    } else {
      googleAuthUrl.searchParams.set("prompt", "consent select_account");
    }
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
    const duplicateAck = takeDuplicateAck(req, res);
    const linkToken = takeConnectLink(req, res);

    if (!sessionToken && !linkToken) {
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

    // SCRUM-374: a live WEB session, not just any row: a revoked or expired
    // session, or an MCP client's token set as the cookie, goes to sign in.
    // With no session, a connect link spent in this browser (SCRUM-466).
    const who = await connectUser(sessionToken, linkToken, PROVIDERS.GOOGLE_WORKSPACE);
    if (!who) {
      res.redirect("/auth/login");
      return;
    }
    const session = { userId: who.userId };

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
      id_token?: string;
    };

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    // SCRUM-149: a consent that granted ZERO services is a failed connect,
    // not a connection. Google's granular consent brings the service
    // checkboxes up unticked, so "Continue" alone comes back with identity
    // scopes only — a grant that can serve no tool ever. Storing it poisoned
    // every downstream surface (the connections page, the lifecycle cron, the
    // follow-up email) and, before SCRUM-145, could hold the default account
    // forever. Nothing is written and the user lands on a distinct error code
    // with a retry path. Gated BEFORE the userinfo fetch: we do not resolve
    // an identity for a connection we refuse.
    //
    // The refusal requires POSITIVE observation: `tokens.scope` present and
    // covering zero services. A response with no scope field stays fail-open
    // and is stored exactly as before — refusing what we could not read would
    // lock out working connections. Google-only by construction: this is the
    // Google callback, and only Google has a per-scope opt-out.
    const grantDelta = scopeDelta(PROVIDERS.GOOGLE_WORKSPACE, tokens.scope ?? null);
    if (
      tokens.scope != null &&
      grantedServiceCount(PROVIDERS.GOOGLE_WORKSPACE, tokens.scope) === 0
    ) {
      void trackConnectRefused(
        db,
        session.userId,
        PROVIDERS.GOOGLE_WORKSPACE,
        attribution
      );
      // SCRUM-410. Three things for the person this just happened to.
      //
      // The note under the connect button comes back, whatever they did
      // with it before: it says to tick every box, and they did not.
      // Best-effort, because a preference must never fail a connect flow.
      try {
        await db
          .update(users)
          .set({ connectHelperDismissedAt: null })
          .where(eq(users.id, session.userId));
      } catch (err) {
        console.error("[auth] could not restore the connect note:", err instanceof Error ? err.message : err);
      }
      // The account they tried is remembered for the retry, so Google goes
      // straight to its consent screen. From the id_token already in hand:
      // still no userinfo call for a connection we refuse.
      const tried = emailFromIdToken(tokens.id_token);
      if (tried) {
        res.cookie(GWS_CONNECT_HINT_COOKIE, tried, {
          httpOnly: true,
          secure: cookiesAreSecure,
          sameSite: "lax",
          path: "/",
          maxAge: OAUTH_STATE_TTL_MS,
        });
      }
      // A connect only a link vouches for keeps that link for the retry, which
      // starts over at the same route (SCRUM-466).
      if (who.viaLink && linkToken) res.cookie(CONNECT_LINK_COOKIE, linkToken, oneShot);
      // And they land on the page that names what to tick, with Try again,
      // carrying the place they started from. That page's "back" link is the
      // destination this used to redirect to, so nothing about where a
      // refusal can end up has been lost.
      res.redirect(googleConnectRefusedUrl(resolveNextPath(requestedPath)));
      return;
    }

    // Fetch the email of the connected Google account
    let accountEmail: string | null = null;
    // Whether Google verified that address: a link with no session trusts
    // only a verified one (SCRUM-466).
    let emailVerified = false;
    try {
      const userInfoRes = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
      );
      if (userInfoRes.ok) {
        const userInfo = (await userInfoRes.json()) as { email: string; verified_email?: unknown };
        accountEmail = userInfo.email;
        emailVerified = userInfo.verified_email === true;
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
    // and Google reports what actually came back in `tokens.scope`. A PARTIAL
    // grant is upserted — the granted subset genuinely works, and the tokens
    // have to live somewhere for it to — but never recorded as clean: the
    // event carries the delta and the redirect names it, so the landing
    // surface can offer re-consent (the connect URL already sends
    // prompt=consent with the full set, so Google re-prompts). The ZERO case
    // never reaches this line — the SCRUM-149 gate above refused it.
    // SCRUM-363: already held by another DataToRAG user? Warn, store nothing.
    // SCRUM-466: a connect only a link vouches for must be the link user's own.
    if (await refusedUnconfirmed(res, who, PROVIDERS.GOOGLE_WORKSPACE, accountEmail, emailVerified)) {
      return;
    }

    if (
      await refusedAsDuplicate(res, {
        userId: session.userId,
        provider: PROVIDERS.GOOGLE_WORKSPACE,
        accountEmail,
        externalAccountId: null,
        acknowledged: nonceMatches(duplicateAck, cookieNonce),
        requestedPath,
      })
    ) {
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
      attribution,
      grantDelta,
      // SCRUM-223: a connect made on a skill's behalf carries its slug, from
      // the same parked `next` the return redirect redeems.
      { skill: skillSlugFromPath(requestedPath), entry: connectEntry(requestedPath) }
    );

    connected(who, PROVIDERS.GOOGLE_WORKSPACE);

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

  router.get("/auth/atlassian/connect", async (req, res) => {
    // A live web session, or a spent connect link, as for Google.
    if (!(await connectUser(req.cookies?.dtrmcp_session, req.cookies?.[CONNECT_LINK_COOKIE], PROVIDERS.ATLASSIAN))) {
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
    armDuplicateAck(req, res, PROVIDERS.ATLASSIAN, nonce);

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
    const duplicateAck = takeDuplicateAck(req, res);
    const linkToken = takeConnectLink(req, res);

    if (!sessionToken && !linkToken) {
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

    // SCRUM-374: a live WEB session, not just any row: a revoked or expired
    // session, or an MCP client's token set as the cookie, goes to sign in.
    // With no session, a connect link spent in this browser (SCRUM-466).
    const who = await connectUser(sessionToken, linkToken, PROVIDERS.ATLASSIAN);
    if (!who) {
      res.redirect("/auth/login");
      return;
    }
    const session = { userId: who.userId };

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
    // As for Google: a link with no session trusts only a verified address.
    let emailVerified = false;
    try {
      const meRes = await fetch("https://api.atlassian.com/me", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as { email: string; email_verified?: unknown };
        accountEmail = me.email;
        emailVerified = me.email_verified === true;
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

    // SCRUM-466: a connect only a link vouches for must be the link user's own.
    if (await refusedUnconfirmed(res, who, PROVIDERS.ATLASSIAN, accountEmail, emailVerified)) {
      return;
    }

    if (
      await refusedAsDuplicate(res, {
        userId: session.userId,
        provider: PROVIDERS.ATLASSIAN,
        accountEmail,
        externalAccountId: null,
        acknowledged: nonceMatches(duplicateAck, cookieNonce),
        requestedPath,
      })
    ) {
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
      attribution,
      undefined,
      { skill: skillSlugFromPath(requestedPath), entry: connectEntry(requestedPath) }
    );

    connected(who, PROVIDERS.ATLASSIAN);

    res.redirect(
      postConnectDestination({ requestedPath, provider: PROVIDERS.ATLASSIAN })
    );
  });

  // --- Notion connection (SCRUM-366) ---
  //
  // The Atlassian pair's shape: session to begin, attribution and `next`
  // parked, a one-shot nonce echoed in `state`, all consumed before any
  // return. No consent interstitial, because Notion has no per-scope opt-out
  // to coach around: the user picks pages, and capabilities are fixed on the
  // registered connection. One grant is one person in one workspace, so the
  // workspace id is stored as the account's external id and its name as the
  // label; a second workspace under the same email is a second account.

  router.get("/auth/notion/connect", async (req, res) => {
    // A live web session, or a spent connect link, as for Google.
    if (!(await connectUser(req.cookies?.dtrmcp_session, req.cookies?.[CONNECT_LINK_COOKIE], PROVIDERS.NOTION))) {
      res.redirect("/auth/login");
      return;
    }

    // The launch gate (SCRUM-366): until the notion-mcp server row is active
    // there are no Notion tools, so nothing is connected. Refused before any
    // cookie is set or Notion is contacted.
    if (!(await isServiceLaunched(db, PROVIDERS.NOTION))) {
      res.redirect(
        postConnectDestination({
          requestedPath: req.query.next,
          error: CONNECT_ERROR_NOT_LAUNCHED,
        })
      );
      return;
    }

    stashAttribution(req, res, cookiesAreSecure);
    stashConnectNext(req, res);

    const nonce = randomBytes(16).toString("base64url");
    res.cookie(NOTION_CONNECT_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: cookiesAreSecure,
      sameSite: "lax",
      path: "/",
      maxAge: OAUTH_STATE_TTL_MS,
    });
    armDuplicateAck(req, res, PROVIDERS.NOTION, nonce);

    const url = new URL(NOTION_AUTHORIZE_URL);
    url.searchParams.set("client_id", config.notionClientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("owner", "user");
    url.searchParams.set(
      "redirect_uri",
      `${config.baseUrl}/auth/notion/connect/callback`
    );
    url.searchParams.set("state", nonce);

    res.redirect(url.toString());
  });

  router.get("/auth/notion/connect/callback", async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    // Identity comes from the session cookie only, never from `state`.
    const sessionToken = req.cookies?.dtrmcp_session as string | undefined;
    const cookieNonce = req.cookies?.[NOTION_CONNECT_NONCE_COOKIE] as string | undefined;
    res.clearCookie(NOTION_CONNECT_NONCE_COOKIE, { path: "/" });
    const attribution = takeAttribution(req, res);
    const requestedPath = takeConnectNext(req, res);
    const duplicateAck = takeDuplicateAck(req, res);
    const linkToken = takeConnectLink(req, res);

    if (!sessionToken && !linkToken) {
      res.redirect("/auth/login");
      return;
    }

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

    // SCRUM-374: a live WEB session, not just any row: a revoked or expired
    // session, or an MCP client's token set as the cookie, goes to sign in.
    // With no session, a connect link spent in this browser (SCRUM-466).
    const who = await connectUser(sessionToken, linkToken, PROVIDERS.NOTION);
    if (!who) {
      res.redirect("/auth/login");
      return;
    }
    const session = { userId: who.userId };

    let tokens: NotionTokenResponse | null = null;
    try {
      const tokenResponse = await fetch(NOTION_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: notionBasicAuth(
            config.notionClientId,
            config.notionClientSecret
          ),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: `${config.baseUrl}/auth/notion/connect/callback`,
        }),
      });
      if (tokenResponse.ok) {
        tokens = (await tokenResponse.json()) as NotionTokenResponse;
      }
    } catch {
      // Falls through as a failed exchange.
    }

    if (!tokens || typeof tokens.access_token !== "string") {
      res.redirect(
        postConnectDestination({ requestedPath, error: "token_exchange_failed" })
      );
      return;
    }

    // The person who authorized, from the token response itself: Notion has
    // no userinfo call to make. Absent when the connection lacks the "user
    // information with email" capability, and then there is no routing key.
    const email = tokens.owner?.user?.person?.email;
    const accountEmail = typeof email === "string" && email !== "" ? email : null;
    if (!accountEmail) {
      res.redirect(
        postConnectDestination({
          requestedPath,
          error: "could_not_resolve_account_email",
        })
      );
      return;
    }

    // Without the workspace id a second workspace under the same email would
    // overwrite the first one's tokens, which is the thing the key exists to
    // prevent, so a grant with none is refused rather than stored keyless.
    const workspaceId =
      typeof tokens.workspace_id === "string" && tokens.workspace_id !== ""
        ? tokens.workspace_id
        : null;
    if (!workspaceId) {
      res.redirect(
        postConnectDestination({
          requestedPath,
          error: "could_not_resolve_workspace",
        })
      );
      return;
    }
    // Set by whoever administers the workspace, and shown to the model and
    // in the dashboard: cleaned and capped before it is stored.
    const workspaceName = cleanWorkspaceName(tokens.workspace_name);

    // SCRUM-466: a connect only a link vouches for must be the link user's own.
    // Notion reports no verified flag; the address is the one its own
    // sign-in uses.
    if (await refusedUnconfirmed(res, who, PROVIDERS.NOTION, accountEmail, true)) {
      return;
    }

    if (
      await refusedAsDuplicate(res, {
        userId: session.userId,
        provider: PROVIDERS.NOTION,
        accountEmail,
        externalAccountId: workspaceId,
        acknowledged: nonceMatches(duplicateAck, cookieNonce),
        requestedPath,
      })
    ) {
      return;
    }

    // No expiry: Notion's token response carries none, and none is invented.
    await upsertServiceAccount(
      db,
      session.userId,
      PROVIDERS.NOTION,
      accountEmail,
      {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? undefined,
      },
      null,
      null,
      { externalAccountId: workspaceId, label: workspaceName }
    );

    await trackOAuthCompleted(
      db,
      session.userId,
      PROVIDERS.NOTION,
      accountEmail,
      attribution,
      undefined,
      { skill: skillSlugFromPath(requestedPath), entry: connectEntry(requestedPath) }
    );

    connected(who, PROVIDERS.NOTION);

    res.redirect(
      postConnectDestination({ requestedPath, provider: PROVIDERS.NOTION })
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
