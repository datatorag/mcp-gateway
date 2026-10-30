import type { RequestHandler } from "express";
import { requestClientIp as getClientIp } from "@/gateway/client-ip";
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
