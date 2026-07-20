import type { Request, RequestHandler } from "express";
import { createRateLimiter } from "@/gateway/usage/rate-limit";

// Per-IP limits for the OAuth endpoints (register / authorize / token / revoke).
// Tokens are 256-bit random and unguessable, so this is volumetric-abuse
// defense — open dynamic-client-registration spam, authorize/token flooding —
// not a cryptographic control. Limits are generous enough for a shared-NAT
// office doing occasional connects (a full setup is ~4 calls) while capping
// automated abuse. Tune here if a legitimate client ever trips it.
const oauthMinuteLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
const oauthHourLimiter = createRateLimiter({ limit: 600, windowMs: 60 * 60_000 });

if (typeof setInterval !== "undefined") {
  setInterval(() => {
    oauthMinuteLimiter.sweep();
    oauthHourLimiter.sweep();
  }, 5 * 60_000).unref?.();
}

// Client IP for bucketing. Production is fronted by Cloudflare, which sets
// `CF-Connecting-IP` to the authoritative client IP and overwrites any
// client-supplied value — so it cannot be spoofed. We deliberately do NOT trust
// `X-Forwarded-For`: Cloudflare *appends* the real IP to it, leaving any
// client-sent leftmost entry attacker-controlled, and the origin is also
// reachable directly on :80 where XFF is fully forgeable. When CF-Connecting-IP
// is absent (a direct-to-origin hit, or local dev) we fall back to the real TCP
// peer — never a client-supplied header, which would let an attacker evade the
// cap or pin it onto a victim's IP.
function getClientIp(req: Request): string {
  const cf = req.headers["cf-connecting-ip"];
  const cfIp = Array.isArray(cf) ? cf[0] : cf;
  if (cfIp) return cfIp.trim();
  return req.socket?.remoteAddress ?? "0.0.0.0";
}

/**
 * Express middleware: rate-limit OAuth traffic per client IP. Mount on the
 * `/oauth` prefix so it fails fast before body parsing and route handlers.
 */
export const oauthRateLimit: RequestHandler = (req, res, next) => {
  const ip = getClientIp(req);
  const minute = oauthMinuteLimiter.check(ip);
  const hour = oauthHourLimiter.check(ip);
  if (!minute.ok || !hour.ok) {
    const retryAfterMs = Math.max(minute.retryAfterMs, hour.retryAfterMs);
    res
      .status(429)
      .set("Retry-After", String(Math.ceil(retryAfterMs / 1000)))
      .json({ error: "rate_limit" });
    return;
  }
  next();
};
