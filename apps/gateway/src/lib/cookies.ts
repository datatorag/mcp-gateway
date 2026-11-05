import type { CookieOptions } from "express";
import { OAUTH_STATE_TTL_MS } from "@/gateway/oauth/csrf";

/**
 * The browser session's cookie. Its name is what every signed-in browser
 * holds: renaming it would sign everyone out, so it stays exactly this.
 */
export const SESSION_COOKIE = "dtrmcp_session";

/**
 * Options for a cookie that lives for one OAuth round trip: a nonce, a
 * return path, a link or a verifier, set when a flow starts and read once
 * when it comes back. httpOnly and SameSite=Lax, for the same ten minutes as
 * the state it travels with. `path` narrows one that only its own callback
 * should see.
 */
export function oneShotCookie(secure: boolean, path = "/"): CookieOptions {
  return { httpOnly: true, secure, sameSite: "lax", path, maxAge: OAUTH_STATE_TTL_MS };
}
