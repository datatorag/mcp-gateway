export interface RateLimiterOpts {
  limit: number;
  windowMs: number;
  clock?: () => number;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterMs: number;
}

export interface RateLimiter {
  check(userId: string): RateLimitResult;
}

export function createRateLimiter(opts: RateLimiterOpts): RateLimiter {
  const clock = opts.clock ?? (() => Date.now());
  const buckets = new Map<string, number[]>();

  return {
    check(userId: string): RateLimitResult {
      const now = clock();
      const cutoff = now - opts.windowMs;
      const arr = buckets.get(userId) ?? [];
      const pruned = arr.filter((t) => t > cutoff);
      if (pruned.length >= opts.limit) {
        const oldest = pruned[0];
        const retryAfterMs = Math.max(1, oldest + opts.windowMs - now);
        buckets.set(userId, pruned);
        return { ok: false, retryAfterMs };
      }
      pruned.push(now);
      buckets.set(userId, pruned);
      return { ok: true, retryAfterMs: 0 };
    },
  };
}

export const dashboardApiLimiter = createRateLimiter({
  limit: 120,
  windowMs: 60_000,
});
