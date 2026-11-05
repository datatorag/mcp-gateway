import { randomBytes } from "node:crypto";
import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens, users } from "@datatorag-mcp/db";
import { nonceMatches, OAUTH_STATE_TTL_MS, sameOriginRequest } from "./oauth/csrf";
import { oneShotCookie, SESSION_COOKIE } from "@/lib/cookies";
import { createWebSession, liveWebSessionUserId } from "../lib/web-session";
import { signInHref } from "../lib/sign-in";
import { stashAttribution, takeAttribution } from "./attribution";
import { connectedElsewhere } from "./connected-accounts";
import { CONNECT_START, isDuplicateProvider, renderConnectDuplicate, type DuplicateProvider } from "./connect-duplicate";
import { EVENTS } from "../lib/analytics";
import { trackConnectDuplicate, trackConnectLinkEvent, trackLogin } from "./track";
import { findOrCreateGoogleUser, onNewUser } from "./signup";
import { skillSlugFromPath } from "../lib/skills";
import {
  postLoginDestination,
  resolveNextPath,
} from "./post-login-destination";
import { CONNECT_ERROR_CONNECTED_ELSEWHERE, postConnectDestination } from "./post-connect-destination";
import { mountConnectFlow, type ConnectFlowDeps } from "./connect/mount-connect-flow";
import { GWS_CONNECT_HINT_COOKIE } from "./connectors/google/oauth";
import { CONNECTOR_OAUTH } from "./connectors/connect-flows";
import { hashToken } from "@datatorag-mcp/auth";
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


/**
 * Dashboard authentication and service connection routes.
 *
 * GET /auth/google               — redirect to Google consent screen (login)
 * GET /auth/google/callback      — exchange code, set session cookie
 * GET /auth/google/connect       — redirect to Google with full GWS scopes
 * GET /auth/google/connect/callback — store GWS tokens for user
 * GET /auth/atlassian/connect(/callback) — Jira + Confluence
 * GET /auth/notion/connect(/callback)    — one Notion workspace per grant
 * GET /auth/slack/connect(/callback)     — the company Slack workspace, admins only
 * GET /auth/posthog/connect(/callback)   — one PostHog project per grant, admins only
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
    notionClientId: string;
    notionClientSecret: string;
    /** Brevo's private app (SCRUM-468). Empty when not configured: Brevo is
     * then not offered. Optional so a test router can leave it out. */
    brevoClientId?: string;
    brevoClientSecret?: string;
    /** SCRUM-454. Empty strings mean not configured: the Slack connect then
     * refuses before anything is set or sent. */
    slackClientId?: string;
    slackClientSecret?: string;
    /** The one Slack workspace allowed to connect. */
    slackTeamId?: string;
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
  const oneShot = oneShotCookie(cookiesAreSecure);

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
    const sessionToken = req.cookies?.[SESSION_COOKIE];
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
    const sessionToken = req.cookies?.[SESSION_COOKIE];
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
    res.clearCookie(SESSION_COOKIE, { path: "/" });
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
      res.cookie(NEXT_COOKIE, next, oneShotCookie(cookiesAreSecure));
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
    res.cookie(LOGIN_NONCE_COOKIE, nonce, oneShotCookie(cookiesAreSecure));

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
    const sessionToken = req.cookies?.[SESSION_COOKIE];
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
    res.clearCookie(SESSION_COOKIE, { path: "/" });
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

  // --- Connectors on the shared connect flow ---
  //
  // Each moved connector's start route and callback, from its ConnectorOAuth
  // and this router's shared steps (connect/mount-connect-flow.ts).
  const connectFlowDeps: ConnectFlowDeps = {
    db,
    config,
    cookiesAreSecure,
    connectUser,
    armDuplicateAck,
    takeDuplicateAck,
    takeConnectLink,
    stashConnectNext,
    takeConnectNext,
    refusedUnconfirmed,
    refusedAsDuplicate,
    connected,
    connectEntry,
  };
  for (const oauth of Object.values(CONNECTOR_OAUTH)) mountConnectFlow(router, oauth, connectFlowDeps);

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
    res.cookie(CONNECT_NEXT_COOKIE, next, oneShotCookie(cookiesAreSecure));
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
