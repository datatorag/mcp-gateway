import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to N requests per window", () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect(rl.check("u1").ok).toBe(true);
    expect(rl.check("u1").ok).toBe(true);
    expect(rl.check("u1").ok).toBe(true);
    const r = rl.check("u1");
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks users independently", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(rl.check("u1").ok).toBe(true);
    expect(rl.check("u2").ok).toBe(true);
    expect(rl.check("u1").ok).toBe(false);
  });

  it("expires old entries so new calls are allowed", () => {
    let now = 1000;
    const rl = createRateLimiter({
      limit: 2,
      windowMs: 1000,
      clock: () => now,
    });
    expect(rl.check("u1").ok).toBe(true);
    expect(rl.check("u1").ok).toBe(true);
    expect(rl.check("u1").ok).toBe(false);
    now = 2500;
    expect(rl.check("u1").ok).toBe(true);
  });

  it("returns accurate retryAfterMs", () => {
    let now = 0;
    const rl = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      clock: () => now,
    });
    rl.check("u1");
    now = 200;
    const r = rl.check("u1");
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBe(800);
  });
});
