/**
 * The connect round trip, once, for every connector that supplies a
 * `ConnectorOAuth`: the start route and its callback.
 *
 * The start: who is connecting (a live web session, or a connect link spent
 * in this browser), whether the service is offered to them and configured,
 * the attribution and return path parked, a one-shot nonce in a cookie and in
 * `state`, the duplicate acknowledgement armed for that nonce, then the
 * provider's authorize URL.
 *
 * The callback: every one-shot cookie consumed before anything can answer,
 * then the nonce, the code, the user, offered and configured again (either
 * can change during the round trip), the exchange, the identity, the link and
 * duplicate checks, the account stored, the completion recorded, and the
 * return. A rejection asks the provider nothing it does not have to.
 */
import { randomBytes } from "node:crypto";
import type { Router, Request, Response } from "express";
import type { Database } from "@datatorag-mcp/db";
import { nonceMatches } from "../oauth/csrf";
import { pkcePair } from "./pkce";
import { oneShotCookie, SESSION_COOKIE } from "@/lib/cookies";
import { stashAttribution, takeAttribution } from "../attribution";
import { upsertServiceAccount } from "../connected-accounts";
import { trackOAuthCompleted } from "../track";
import { skillSlugFromPath } from "../../lib/skills";
import { CONNECT_ERROR_NOT_CONFIGURED, CONNECT_ERROR_NOT_LAUNCHED, postConnectDestination } from "../post-connect-destination";
import { serviceOfferedTo } from "../service-launch";
import { CONNECT_LINK_COOKIE, type ConnectLink } from "../connect-links";
import type { DuplicateProvider } from "../connect-duplicate";
import type { ConnectConfig, ConnectContext, ConnectIdentity, ConnectorOAuth, ConnectTokens } from "./connector-oauth";

type ConnectUser = { userId: string; link: ConnectLink | null; viaLink: boolean };

/** The auth router's shared steps, handed in so each runs exactly as it does
 * for the connectors still in `auth.ts`. */
export interface ConnectFlowDeps {
  db: Database;
  config: ConnectConfig;
  cookiesAreSecure: boolean;
  connectUser(sessionToken: unknown, linkToken: unknown, provider: DuplicateProvider): Promise<ConnectUser | null>;
  armDuplicateAck(req: Request, res: Response, provider: DuplicateProvider, nonce: string): void;
  takeDuplicateAck(req: Request, res: Response): string | undefined;
  takeConnectLink(req: Request, res: Response): string | undefined;
  stashConnectNext(req: Request, res: Response): void;
  takeConnectNext(req: Request, res: Response): unknown;
  refusedUnconfirmed(res: Response, who: ConnectUser, provider: DuplicateProvider, accountEmail: string, emailVerified: boolean): Promise<boolean>;
  refusedAsDuplicate(
    res: Response,
    opts: {
      userId: string;
      provider: DuplicateProvider;
      accountEmail: string;
      externalAccountId: string | null;
      acknowledged: boolean;
      requestedPath: unknown;
    }
  ): Promise<boolean>;
  connected(who: ConnectUser, provider: DuplicateProvider): void;
  connectEntry(requestedPath: unknown): "agent" | "connect";
}

/** A positive number of seconds from now, else no expiry. */
function expiryFrom(expiresIn: unknown): Date | null {
  return typeof expiresIn === "number" && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
}

/** The exchange, never throwing: null for a refusal, a failed call, or an
 * answer without a string access token. */
async function exchanged(
  oauth: ConnectorOAuth,
  code: string,
  ctx: ConnectContext,
  codeVerifier: string | undefined
): Promise<ConnectTokens | null> {
  let raw: Record<string, unknown> | null;
  try {
    raw = await oauth.exchange(code, ctx, codeVerifier);
  } catch {
    return null;
  }
  if (!raw || typeof raw.access_token !== "string") return null;
  return {
    accessToken: raw.access_token,
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : undefined,
    expiresIn: raw.expires_in,
    scope: typeof raw.scope === "string" ? raw.scope : undefined,
    raw,
  };
}

export function mountConnectFlow(router: Router, oauth: ConnectorOAuth, deps: ConnectFlowDeps): void {
  const { db, config, cookiesAreSecure } = deps;
  const provider = oauth.provider;
  const callbackPath = `${oauth.path}/callback`;
  const ctx: ConnectContext = { config, redirectUri: `${config.baseUrl}${callbackPath}` };
  oauth.extraRoutes?.(router, config);

  /** True when the service may not be connected now, after answering. */
  async function refusedNotOffered(res: Response, userId: string, requestedPath: unknown): Promise<boolean> {
    if (oauth.gated && !(await serviceOfferedTo(db, provider, userId))) {
      if (oauth.notOffered === "404") res.status(404).end();
      else res.redirect(postConnectDestination({ requestedPath, error: CONNECT_ERROR_NOT_LAUNCHED }));
      return true;
    }
    if (!oauth.isConfigured(config)) {
      res.redirect(postConnectDestination({ requestedPath, error: CONNECT_ERROR_NOT_CONFIGURED }));
      return true;
    }
    return false;
  }

  router.get(oauth.path, async (req, res) => {
    const who = await deps.connectUser(req.cookies?.[SESSION_COOKIE], req.cookies?.[CONNECT_LINK_COOKIE], provider);
    if (!who) {
      res.redirect("/auth/login");
      return;
    }
    // Refused before any cookie is set or the provider is contacted.
    if (await refusedNotOffered(res, who.userId, req.query.next)) return;

    stashAttribution(req, res, cookiesAreSecure);
    deps.stashConnectNext(req, res);

    const nonce = randomBytes(16).toString("base64url");
    res.cookie(oauth.nonceCookie, nonce, oneShotCookie(cookiesAreSecure));
    const pkce = oauth.pkce ? pkcePair() : null;
    if (oauth.pkce && pkce) res.cookie(oauth.pkce.cookie, pkce.verifier, oneShotCookie(cookiesAreSecure, oauth.pkce.cookiePath));
    deps.armDuplicateAck(req, res, provider, nonce);

    res.redirect(oauth.authorizeUrl(ctx, nonce, pkce?.challenge).toString());
  });

  router.get(callbackPath, async (req, res) => {
    // Every one-shot cookie is consumed here, before anything can answer, so
    // none survives a rejection to attach itself to a later flow.
    // `auth-callback-ordering.test.ts` pins this by source order.
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    // Identity comes from the session cookie or a spent link, never `state`.
    const sessionToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const cookieNonce = req.cookies?.[oauth.nonceCookie] as string | undefined;
    res.clearCookie(oauth.nonceCookie, { path: "/" });
    const verifier = oauth.pkce ? (req.cookies?.[oauth.pkce.cookie] as string | undefined) : undefined;
    if (oauth.pkce) res.clearCookie(oauth.pkce.cookie, { path: oauth.pkce.cookiePath });
    const attribution = takeAttribution(req, res);
    const requestedPath = deps.takeConnectNext(req, res);
    const duplicateAck = deps.takeDuplicateAck(req, res);
    const linkToken = deps.takeConnectLink(req, res);

    if (!sessionToken && !linkToken) {
      res.redirect("/auth/login");
      return;
    }
    if (!nonceMatches(cookieNonce, state) || (oauth.pkce && !verifier)) {
      res.redirect(postConnectDestination({ requestedPath, error: "invalid_state" }));
      return;
    }
    if (!code) {
      res.redirect(postConnectDestination({ requestedPath, error: "missing_code" }));
      return;
    }
    const who = await deps.connectUser(sessionToken, linkToken, provider);
    if (!who) {
      res.redirect("/auth/login");
      return;
    }
    if (await refusedNotOffered(res, who.userId, requestedPath)) return;

    const tokens = await exchanged(oauth, code, ctx, verifier);
    if (!tokens) {
      res.redirect(postConnectDestination({ requestedPath, error: "token_exchange_failed" }));
      return;
    }

    let identity: ConnectIdentity | { error: string } | null;
    try {
      identity = await oauth.identify(tokens, ctx);
    } catch {
      identity = null;
    }
    if (identity && "error" in identity) {
      res.redirect(postConnectDestination({ requestedPath, error: identity.error }));
      return;
    }
    if (!identity || !identity.email) {
      res.redirect(postConnectDestination({ requestedPath, error: "could_not_resolve_account_email" }));
      return;
    }

    // A connect only a link vouches for must be the link user's own.
    if (await deps.refusedUnconfirmed(res, who, provider, identity.email, identity.emailVerified)) return;
    if (
      await deps.refusedAsDuplicate(res, {
        userId: who.userId,
        provider,
        accountEmail: identity.email,
        externalAccountId: identity.externalAccountId,
        acknowledged: nonceMatches(duplicateAck, cookieNonce),
        requestedPath,
      })
    ) {
      return;
    }

    await upsertServiceAccount(
      db,
      who.userId,
      provider,
      identity.email,
      {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        ...(oauth.storesGrantedScope && tokens.scope !== undefined ? { scope: tokens.scope } : {}),
      },
      oauth.scopes,
      expiryFrom(tokens.expiresIn),
      {
        ...(identity.externalAccountId !== null ? { externalAccountId: identity.externalAccountId } : {}),
        label: identity.label,
      }
    );

    await trackOAuthCompleted(db, who.userId, provider, identity.email, attribution, undefined, {
      skill: skillSlugFromPath(requestedPath),
      entry: deps.connectEntry(requestedPath),
    });
    deps.connected(who, provider);

    res.redirect(postConnectDestination({ requestedPath, provider }));
  });
}
