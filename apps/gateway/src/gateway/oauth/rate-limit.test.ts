import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { oauthRateLimit } from "./rate-limit";

// SEC-5: per-IP rate limit on the OAuth endpoints. Production is behind
// Cloudflare, so the client is keyed off the un-spoofable CF-Connecting-IP
// header (never the client-appendable X-Forwarded-For). The limiters are
// module-level singletons, so each test uses a distinct IP to avoid bleed.

const MINUTE_LIMIT = 60;

function mockRes() {
  const res = {
    status: vi.fn(() => res),
    set: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

// Build a request with arbitrary headers + an optional TCP peer address.
function reqWith(headers: Record<string, string>, remoteAddress?: string): Request {
  return { headers, socket: { remoteAddress } } as unknown as Request;
}

function hit(req: Request) {
  const res = mockRes();
  const next = vi.fn() as unknown as NextFunction;
  oauthRateLimit(req, res, next);
  return { res, next };
}

const cf = (ip: string) => reqWith({ "cf-connecting-ip": ip });

describe("oauthRateLimit middleware", () => {
  it("calls next() while under the per-minute limit", () => {
    for (let i = 0; i < MINUTE_LIMIT; i++) {
      const { res, next } = hit(cf("203.0.113.1"));
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it("429s with Retry-After once the per-minute limit is exceeded", () => {
    for (let i = 0; i < MINUTE_LIMIT; i++) hit(cf("203.0.113.2"));
    const { res, next } = hit(cf("203.0.113.2")); // one past the limit
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith("Retry-After", expect.any(String));
    expect(res.json).toHaveBeenCalledWith({ error: "rate_limit" });
  });

  it("buckets per client IP — exhausting one IP doesn't block another", () => {
    for (let i = 0; i < MINUTE_LIMIT + 5; i++) hit(cf("203.0.113.3")); // exhaust A
    const { res, next } = hit(cf("203.0.113.4")); // fresh IP B
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("ignores a spoofed X-Forwarded-For — one CF client can't evade the cap by rotating XFF", () => {
    // Same real client (CF-Connecting-IP), a different forged XFF each request.
    for (let i = 0; i < MINUTE_LIMIT; i++) {
      hit(reqWith({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": `10.0.0.${i}` }));
    }
    // The real client is now capped regardless of the (forged) XFF value.
    const { res, next } = hit(
      reqWith({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "10.9.9.9" })
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("does not let a spoofed X-Forwarded-For pin the cap onto a victim IP", () => {
    // A request with NO CF header (direct-to-origin) carrying a victim's IP in
    // XFF must bucket by the real TCP peer, not the forged header — so the
    // victim (198.51.100.7 above) stays unblocked from a different peer.
    const { res, next } = hit(
      reqWith({ "x-forwarded-for": "198.51.100.7" }, "203.0.113.50")
    );
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("falls back to the TCP peer when CF-Connecting-IP is absent (direct-to-origin)", () => {
    for (let i = 0; i < MINUTE_LIMIT; i++) hit(reqWith({}, "203.0.113.99"));
    const { res, next } = hit(reqWith({}, "203.0.113.99"));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
