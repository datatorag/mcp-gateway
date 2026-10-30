import type { Request } from "express";

/**
 * The client's IP for an Express request. Production is fronted by
 * Cloudflare, which sets `CF-Connecting-IP` to the authoritative client IP and
 * overwrites any client-supplied value, so it cannot be spoofed. We
 * deliberately do NOT trust `X-Forwarded-For`: Cloudflare *appends* the real
 * IP to it, leaving any client-sent leftmost entry attacker-controlled, and
 * the origin is also reachable directly on :80 where XFF is fully forgeable.
 * When CF-Connecting-IP is absent (a direct-to-origin hit, or local dev) we
 * fall back to the real TCP peer, never a client-supplied header.
 *
 * Shared by the OAuth rate limiter and the /mcp auth-failure event
 * (SCRUM-464), so both read the same address the same way.
 */
export function requestClientIp(req: Request): string {
  const cf = req.headers["cf-connecting-ip"];
  const cfIp = Array.isArray(cf) ? cf[0] : cf;
  if (cfIp) return cfIp.trim();
  return req.socket?.remoteAddress ?? "0.0.0.0";
}
