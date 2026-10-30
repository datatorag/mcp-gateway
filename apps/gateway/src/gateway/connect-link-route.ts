/**
 * The connect link's routes (SCRUM-466).
 *
 * GET  /connect/<token>         the page; spends nothing, because chat clients
 *                               and link unfurlers fetch URLs on their own
 * POST /connect/<token>         spends the link, leaves its id in a one-shot
 *                               cookie, and hands over to the provider's
 *                               own connect start
 * GET  /connect/done            where a link-started connect ends
 * GET  /connect/resume/<id>     restarts a connect after "Sign in to continue"
 *
 * Who the connect is for is decided by the provider's routes in `auth.ts`
 * (the session, or with none the link this browser spent). This file only
 * refuses a browser signed in as somebody else, before anything is spent.
 *
 * The consent captures are served from `/connect/*.webp` too, so a path that
 * is not a link's token falls through to them.
 */
import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { users, type Database } from "@datatorag-mcp/db";
import { liveWebSessionUserId } from "../lib/web-session";
import { signInHref } from "../lib/sign-in";
import { OAUTH_STATE_TTL_MS, sameOriginRequest } from "./oauth/csrf";
import {
  claimConnectLink,
  CONNECT_LINK_COOKIE,
  CONNECT_LINK_TOKEN,
  peekConnectLink,
  type ConnectLink,
} from "./connect-links";
import { CONNECT_START, isDuplicateProvider, type DuplicateProvider } from "./connect-duplicate";
import { maskEmail } from "./connected-accounts";
import { getConnectableService } from "../app/dashboard/connections/service-registry";
import { renderConnectInterstitial } from "./connect-interstitial";
import {
  renderConnectDone,
  renderConnectLinkExpired,
  renderConnectLinkOtherAccount,
  renderConnectLinkPage,
} from "./connect-link-page";

/** Where a link-started connect is sent when it ends, carrying `connected`
 * or `connect_error` from `postConnectDestination`. */
export const CONNECT_DONE_PATH = "/connect/done";

/** The connect start for a provider, returning to the done page. */
export function connectStartFromLink(provider: DuplicateProvider): string {
  const start = CONNECT_START[provider];
  return `${start}${start.includes("?") ? "&" : "?"}next=${encodeURIComponent(CONNECT_DONE_PATH)}`;
}

function baseHeaders(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  // The token is in this page's URL: never in a Referer.
  res.setHeader("Referrer-Policy", "no-referrer");
}

function serviceName(provider: string): string {
  return getConnectableService(provider)?.name ?? provider;
}

export function createConnectLinkRouter(db: Database, opts: { baseUrl: string }): Router {
  const router = Router();
  const secure = opts.baseUrl.startsWith("https");

  /** The link, live and for a provider we connect, or null. */
  async function liveLink(token: string): Promise<(ConnectLink & { provider: DuplicateProvider }) | null> {
    const link = await peekConnectLink(db, token);
    return link && isDuplicateProvider(link.provider) ? (link as ConnectLink & { provider: DuplicateProvider }) : null;
  }

  /** True when the browser is signed in as a user other than the link's. */
  async function signedInAsSomeoneElse(req: Request, link: ConnectLink): Promise<boolean> {
    const sessionUserId = await liveWebSessionUserId(db, req.cookies?.dtrmcp_session);
    return sessionUserId !== null && sessionUserId !== link.userId;
  }

  router.get(CONNECT_DONE_PATH, (req, res) => {
    baseHeaders(res);
    const connected = req.query.connected;
    const ok = typeof connected === "string" && isDuplicateProvider(connected) && req.query.connect_error === undefined;
    // The names a partial grant left out come from our own redirect, but the
    // query is anyone's to write: capped, and escaped by the page.
    const missing =
      ok && req.query.partial === connected && typeof req.query.missing === "string"
        ? req.query.missing.split(",").slice(0, 12).map((m) => m.slice(0, 40))
        : [];
    res.status(200).type("html").send(renderConnectDone(ok ? serviceName(connected as string) : null, missing));
  });

  router.get("/connect/resume/:provider", async (req, res) => {
    baseHeaders(res);
    const provider = req.params.provider;
    if (!isDuplicateProvider(provider)) {
      res.status(404).type("html").send(renderConnectLinkExpired());
      return;
    }
    if (!(await liveWebSessionUserId(db, req.cookies?.dtrmcp_session))) {
      res.redirect(signInHref(`/connect/resume/${provider}`));
      return;
    }
    res.redirect(connectStartFromLink(provider));
  });

  router.get("/connect/:token", async (req, res, next) => {
    const token = req.params.token;
    if (!CONNECT_LINK_TOKEN.test(token)) {
      next();
      return;
    }
    baseHeaders(res);
    const link = await liveLink(token);
    if (!link) {
      res.status(410).type("html").send(renderConnectLinkExpired());
      return;
    }
    if (await signedInAsSomeoneElse(req, link)) {
      res.status(403).type("html").send(renderConnectLinkOtherAccount());
      return;
    }
    const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, link.userId)).limit(1);
    const masked = maskEmail(owner?.email ?? "");
    const action = `/connect/${token}`;
    const service = serviceName(link.provider);
    const html =
      link.provider === "google-workspace"
        ? renderConnectInterstitial(null, undefined, {}, {
            action,
            lead: `${service} will be added to the DataToRAG account signed in as ${masked}.`,
          })
        : renderConnectLinkPage({ provider: link.provider, service, maskedSignIn: masked, action });
    res.status(200).type("html").send(html);
  });

  router.post("/connect/:token", async (req, res, next) => {
    const token = req.params.token;
    if (!CONNECT_LINK_TOKEN.test(token)) {
      next();
      return;
    }
    baseHeaders(res);
    if (!sameOriginRequest(req.headers.origin, opts.baseUrl)) {
      res.status(403).end();
      return;
    }
    // Refused before the claim, so the right person can still use the link.
    const peeked = await liveLink(token);
    if (!peeked) {
      res.status(410).type("html").send(renderConnectLinkExpired());
      return;
    }
    if (await signedInAsSomeoneElse(req, peeked)) {
      res.status(403).type("html").send(renderConnectLinkOtherAccount());
      return;
    }
    const link = await claimConnectLink(db, token);
    if (!link || !isDuplicateProvider(link.provider)) {
      res.status(410).type("html").send(renderConnectLinkExpired());
      return;
    }
    res.cookie(CONNECT_LINK_COOKIE, link.id, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: OAUTH_STATE_TTL_MS,
    });
    res.redirect(303, connectStartFromLink(link.provider));
  });

  return router;
}
