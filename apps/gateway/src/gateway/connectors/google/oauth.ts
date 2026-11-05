/**
 * Google Workspace's connect for the shared flow: the full Workspace scopes,
 * the consent interstitial before the handoff, the retry hint, the refusal
 * of a consent that granted no service, and the partial-grant report.
 * Sign-in (`/auth/google`) is a different flow and stays in `auth.ts`.
 */
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { users } from "@datatorag-mcp/db";
import { oneShotCookie } from "@/lib/cookies";
import { parseAttribution, toWireParams } from "../../../lib/attribution";
import { CONNECT_LINK_COOKIE } from "../../connect-links";
import { googleConnectRefusedUrl, renderConnectInterstitial } from "../../connect-interstitial";
import { CONNECT_ERROR_NO_SERVICES, postConnectDestination } from "../../post-connect-destination";
import { resolveNextPath } from "../../post-login-destination";
import { GWS_SCOPE_LIST, grantedServiceCount, scopeDelta, serviceGrantStates } from "../../scope-grant";
import { trackConnectRefused } from "../../track";
import type { ConnectorOAuth } from "../../connect/connector-oauth";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

// The list itself lives in scope-grant.ts, next to the code that compares a
// user's grant against it: one list, not a string here and a copy there.
export const GWS_SCOPES = GWS_SCOPE_LIST.join(" ");

/** Which Google account a refused connect was attempted with (SCRUM-410), so
 * the retry can go straight to Google's consent screen for that account and
 * skip the account chooser, which read to users as being made to sign in all
 * over again. An email address, so it lives in an httpOnly cookie and never
 * in a URL. Short-lived, used by the retry link alone, and cleared by every
 * connect that starts, whether or not it used it. It is a hint to Google and
 * nothing else: no decision here ever reads it. */
export const GWS_CONNECT_HINT_COOKIE = "gws_connect_hint";

/** The email in an id_token's payload, unverified. Good enough for a hint
 * that only preselects an account on Google's own screen; never for
 * identity, which comes from the session and from userinfo. */
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

/** SCRUM-150: the instruction page before the handoff. Google's granular
 * consent brings the service checkboxes up unticked, and the moment before
 * the redirect is the only lever we hold, held at the one route every
 * connect control links to, so no render site needs to know it exists.
 * Nothing one-shot (nonce, attribution, next) is stashed for a page view. */
function interstitial(req: Request, res: Response): boolean {
  if (req.query.proceed === "1") return false;
  const next = typeof req.query.next === "string" ? req.query.next : null;
  // The attribution snapshot on the clicked link, by its known names only,
  // handed on to the proceed leg where `stashAttribution` reads it.
  const carry = toWireParams(parseAttribution(req.query as Record<string, unknown>, { ownHost: req.hostname }));
  // SCRUM-410: the same page in its refused form, where a connect that came
  // back from Google with nothing granted is sent. It names what to tick and
  // its button tries again. "Back" returns to wherever the connect started,
  // still carrying the refusal. `next` is validated before it is used.
  if (req.query.refused === "1") {
    const validNext = resolveNextPath(next);
    res
      .status(200)
      .type("html")
      .send(
        renderConnectInterstitial(
          validNext,
          {
            services: serviceGrantStates("google-workspace", "").map((s) => s.displayName),
            cancelHref: postConnectDestination({ requestedPath: validNext, error: CONNECT_ERROR_NO_SERVICES }),
          },
          carry
        )
      );
    return true;
  }
  res.status(200).type("html").send(renderConnectInterstitial(next, undefined, carry));
  return true;
}

export const GOOGLE_CONNECT: ConnectorOAuth = {
  provider: "google-workspace",
  path: "/auth/google/connect",
  nonceCookie: "gws_connect_nonce",
  scopes: GWS_SCOPES,
  // Google reports what the consent actually granted in `scope`.
  storesGrantedScope: true,
  // Offered to everyone, with no launch gate.
  gated: false,
  notOffered: "redirect",
  isConfigured: (config) => Boolean(config.gwsClientId && config.gwsClientSecret),
  interceptStart: interstitial,

  authorizeUrl(ctx, nonce, _codeChallenge, start) {
    // The account hint from a refused attempt is used by the retry link
    // alone, and is gone after ANY connect starts: an ordinary Connect click
    // minutes later must offer the account chooser as it always did.
    const hint = start?.req.query.retry === "1" ? start.req.cookies?.[GWS_CONNECT_HINT_COOKIE] : undefined;
    start?.res.clearCookie(GWS_CONNECT_HINT_COOKIE, { path: "/" });

    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.searchParams.set("client_id", ctx.config.gwsClientId!);
    url.searchParams.set("redirect_uri", ctx.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GWS_SCOPES);
    url.searchParams.set("access_type", "offline");
    if (isPlausibleEmail(hint)) {
      // Straight to the consent screen for the account just tried. The
      // screen still offers "use another account".
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("login_hint", hint);
    } else {
      url.searchParams.set("prompt", "consent select_account");
    }
    url.searchParams.set("state", nonce);
    return url;
  },

  async exchange(code, ctx) {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: ctx.config.gwsClientId!,
        client_secret: ctx.config.gwsClientSecret!,
        redirect_uri: ctx.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  },

  // SCRUM-149: a consent that granted ZERO services is a failed connect, not
  // a connection. Google's granular consent brings the service checkboxes up
  // unticked, so "Continue" alone comes back with identity scopes only, a
  // grant that can serve no tool ever. Nothing is written and the user lands
  // on a page that names what to tick, with a retry. Decided before the
  // userinfo call: no identity is resolved for a connection that is refused.
  //
  // The refusal requires POSITIVE observation: `scope` present and covering
  // zero services. A response with no scope field is stored as before;
  // refusing what could not be read would lock out working connections.
  async refuseGrant(tokens, call) {
    if (tokens.scope == null || grantedServiceCount("google-workspace", tokens.scope) !== 0) return false;
    void trackConnectRefused(call.db, call.userId, "google-workspace", call.attribution);
    // SCRUM-410. The note under the connect button comes back, whatever they
    // did with it before: it says to tick every box, and they did not.
    // Best-effort, because a preference must never fail a connect flow.
    try {
      await call.db.update(users).set({ connectHelperDismissedAt: null }).where(eq(users.id, call.userId));
    } catch (err) {
      console.error("[auth] could not restore the connect note:", err instanceof Error ? err.message : err);
    }
    // The account they tried is remembered for the retry, so Google goes
    // straight to its consent screen. From the id_token already in hand.
    const tried = emailFromIdToken(tokens.raw.id_token);
    if (tried) call.res.cookie(GWS_CONNECT_HINT_COOKIE, tried, oneShotCookie(call.cookiesAreSecure));
    // A connect only a link vouches for keeps that link for the retry, which
    // starts over at the same route (SCRUM-466).
    if (call.viaLink && call.linkToken) call.res.cookie(CONNECT_LINK_COOKIE, call.linkToken, oneShotCookie(call.cookiesAreSecure));
    call.res.redirect(googleConnectRefusedUrl(resolveNextPath(call.requestedPath)));
    return true;
  },

  // SCRUM-136: the consent screen lets the user untick individual scopes. A
  // PARTIAL grant is stored, since the granted subset works, but never
  // recorded as clean: the event carries the delta and the redirect names
  // what is missing, so the landing surface can offer re-consent.
  grantReport(tokens) {
    const delta = scopeDelta("google-workspace", tokens.scope ?? null);
    return { delta, partialMissing: delta.complete ? undefined : delta.missing.map((m) => m.displayName) };
  },

  async identify(tokens) {
    const res = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    if (!res.ok) return null;
    const info = (await res.json()) as { email?: unknown; verified_email?: unknown };
    if (typeof info.email !== "string" || info.email === "") return null;
    // Whether Google verified that address: a link with no session trusts
    // only a verified one (SCRUM-466). No label: the account's name is the
    // user's own, and a reconnect leaves it as it is.
    return { email: info.email, emailVerified: info.verified_email === true, externalAccountId: null };
  },
};
